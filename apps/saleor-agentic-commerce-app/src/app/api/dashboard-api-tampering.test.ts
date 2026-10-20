import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { NextRequest } from "next/server"
import type { GlobalConfig, PaymentHandlerEntry } from "@/lib/metadata-keys"

const SALEOR_API_URL = "https://shop.example/graphql/"
const APP_ID = "app-123"
const APP_TOKEN = "app-token"
const STORED_PRISM_KEY = "prism-live-key"
const STORED_ACP_KEY = "acp_stored"
const VALID_JWT = "valid.dashboard.jwt"

const state = vi.hoisted(() => ({
  global: {} as Record<string, unknown>,
  handlers: {} as Record<string, unknown>,
  managers: 0,
}))

const aplGet = vi.hoisted(() => vi.fn())
const verifyJWT = vi.hoisted(() => vi.fn())

vi.mock("@/lib/saleor-app", () => ({ saleorApp: { apl: { get: aplGet } } }))
vi.mock("@saleor/app-sdk/auth", () => ({ verifyJWT }))
vi.mock("@/lib/config-manager", () => ({
  ConfigManager: class {
    constructor() {
      state.managers += 1
    }
    async getGlobalConfig() {
      return { ...state.global }
    }
    async getAllChannelConfigs() {
      return {}
    }
    async getChannels() {
      return []
    }
    async getAllPaymentHandlers() {
      return JSON.parse(JSON.stringify(state.handlers))
    }
    async getPaymentHandler(id: string) {
      return state.handlers[id] ? JSON.parse(JSON.stringify(state.handlers[id])) : null
    }
    async saveGlobalConfig(partial: Record<string, unknown>) {
      for (const [k, v] of Object.entries(partial)) {
        if (v !== undefined) state.global[k] = v
      }
    }
    async saveChannelConfig() {}
    async savePaymentHandler(id: string, entry: unknown) {
      state.handlers[id] = entry
    }
  },
}))

const { GET: getConfig, POST: postConfig } = await import("./config/route")
const { POST: testConnection } = await import("./payment-handlers/test-connection/route")
const { GET: getPublicConfig } = await import("./config-public/route")
const { POST: registerHandler } = await import("./handlers/register/route")

const PRISM_ENTRY: PaymentHandlerEntry = {
  enabled: true,
  channels: null,
  config: { apiUrl: "https://prism-gw.fd.xyz", apiKey: STORED_PRISM_KEY },
  manifest: {
    id: "xyz.fd.prism_payment",
    name: "xyz.fd.prism_payment",
    version: "2026-10-07",
    configSchema: {
      type: "object",
      properties: {
        apiUrl: { type: "string", format: "uri" },
        apiKey: { type: "string", format: "password" },
      },
    },
  },
}

const STORED_GLOBAL: GlobalConfig = {
  enabled: true,
  storeName: "Shop",
  storeDescription: "",
  ucpEnabled: true,
  acpEnabled: true,
  acpApiKey: STORED_ACP_KEY,
}

function request(
  path: string,
  init: { method?: string; body?: unknown; jwt?: string | null; saleorApiUrl?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (init.jwt) headers["authorization-bearer"] = init.jwt
  headers["saleor-api-url"] = init.saleorApiUrl ?? SALEOR_API_URL
  return new NextRequest(`https://app.example${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

const fetchSpy = vi.fn()

beforeEach(() => {
  state.global = { ...STORED_GLOBAL }
  state.handlers = { "xyz.fd.prism_payment": JSON.parse(JSON.stringify(PRISM_ENTRY)) }
  state.managers = 0
  aplGet.mockReset()
  aplGet.mockImplementation(async (url: string) =>
    url === SALEOR_API_URL ? { saleorApiUrl: SALEOR_API_URL, appId: APP_ID, token: APP_TOKEN } : undefined,
  )
  verifyJWT.mockReset()
  verifyJWT.mockImplementation(async ({ token }: { token: string }) => {
    if (token !== VALID_JWT) throw new Error("JWT verification failed")
  })
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("dashboard API tampering — config and test-connection fail closed", () => {
  it("rejects GET /api/config that only names a registered saleorApiUrl", async () => {
    const res = await getConfig(request("/api/config"))
    expect(res.status).toBe(401)
    expect(state.managers).toBe(0)
  })

  it("rejects a valid dashboard token sent for an install that is not registered", async () => {
    const res = await getConfig(
      request("/api/config", { jwt: VALID_JWT, saleorApiUrl: "https://attacker.example/graphql/" }),
    )
    expect(res.status).toBe(401)
    expect(verifyJWT).not.toHaveBeenCalled()
    expect(state.managers).toBe(0)
  })

  it("rejects with 401 when the APL lookup throws for an unknown install", async () => {
    aplGet.mockRejectedValue(new Error("Unknown saleorApiUrl"))
    const configRes = await getConfig(
      request("/api/config", { jwt: VALID_JWT, saleorApiUrl: "https://attacker.example/graphql/" }),
    )
    const probeRes = await testConnection(
      request("/api/payment-handlers/test-connection", {
        method: "POST",
        jwt: VALID_JWT,
        saleorApiUrl: "https://attacker.example/graphql/",
        body: { handlerId: "xyz.fd.prism_payment", apiUrl: "http://169.254.169.254", apiKey: "k" },
      }),
    )
    expect(configRes.status).toBe(401)
    expect(probeRes.status).toBe(401)
    expect(verifyJWT).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(state.managers).toBe(0)
  })

  it("rejects GET /api/config with a forged dashboard token", async () => {
    const res = await getConfig(request("/api/config", { jwt: "forged.jwt" }))
    expect(res.status).toBe(401)
    expect(state.managers).toBe(0)
  })

  it("verifies the dashboard token against the registered install and requires MANAGE_APPS", async () => {
    await getConfig(request("/api/config", { jwt: VALID_JWT }))
    expect(verifyJWT).toHaveBeenCalledWith({
      token: VALID_JWT,
      appId: APP_ID,
      saleorApiUrl: SALEOR_API_URL,
      requiredPermissions: ["MANAGE_APPS"],
    })
  })

  it("never returns the Prism API key or the ACP key in plain text", async () => {
    const res = await getConfig(request("/api/config", { jwt: VALID_JWT }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(STORED_PRISM_KEY)
    expect(text).not.toContain(STORED_ACP_KEY)
  })

  it("rejects POST /api/config that repoints the Prism URL without a dashboard token", async () => {
    const res = await postConfig(
      request("/api/config", {
        method: "POST",
        body: {
          paymentHandlers: {
            "xyz.fd.prism_payment": {
              ...PRISM_ENTRY,
              config: { apiUrl: "https://attacker.example", apiKey: "x" },
            },
          },
        },
      }),
    )
    expect(res.status).toBe(401)
    expect((state.handlers["xyz.fd.prism_payment"] as PaymentHandlerEntry).config.apiUrl).toBe(
      "https://prism-gw.fd.xyz",
    )
  })

  it("rejects POST /api/config that enables the dummy handler without a dashboard token", async () => {
    const res = await postConfig(
      request("/api/config", {
        method: "POST",
        body: {
          paymentHandlers: {
            "xyz.fd.dummy_payment": { enabled: true, channels: null, config: {} },
          },
        },
      }),
    )
    expect(res.status).toBe(401)
    expect(state.handlers["xyz.fd.dummy_payment"]).toBeUndefined()
  })

  it("keeps stored secrets when the dashboard saves back the redacted values", async () => {
    const got = await (await getConfig(request("/api/config", { jwt: VALID_JWT }))).json()
    const res = await postConfig(
      request("/api/config", {
        method: "POST",
        jwt: VALID_JWT,
        body: { global: got.global, paymentHandlers: got.paymentHandlers },
      }),
    )
    expect(res.status).toBe(200)
    expect(state.global.acpApiKey).toBe(STORED_ACP_KEY)
    expect((state.handlers["xyz.fd.prism_payment"] as PaymentHandlerEntry).config.apiKey).toBe(
      STORED_PRISM_KEY,
    )
  })

  it("stores a new secret when the dashboard sends one", async () => {
    const res = await postConfig(
      request("/api/config", {
        method: "POST",
        jwt: VALID_JWT,
        body: { global: { acpApiKey: "acp_rotated" } },
      }),
    )
    expect(res.status).toBe(200)
    expect(state.global.acpApiKey).toBe("acp_rotated")
  })

  it("rejects test-connection without a dashboard token and makes no outbound call", async () => {
    const res = await testConnection(
      request("/api/payment-handlers/test-connection", {
        method: "POST",
        body: { handlerId: "xyz.fd.prism_payment", apiUrl: "http://169.254.169.254", apiKey: "k" },
      }),
    )
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("test-connection uses the stored key when the dashboard sends the redacted value", async () => {
    const got = await (await getConfig(request("/api/config", { jwt: VALID_JWT }))).json()
    const redacted = got.paymentHandlers["xyz.fd.prism_payment"].config.apiKey
    await testConnection(
      request("/api/payment-handlers/test-connection", {
        method: "POST",
        jwt: VALID_JWT,
        body: { handlerId: "xyz.fd.prism_payment", apiUrl: "https://prism-gw.fd.xyz", apiKey: redacted },
      }),
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ "x-api-key": STORED_PRISM_KEY })
  })
})

const API_DIR = fileURLToPath(new URL(".", import.meta.url))

const ROUTES_AUTHENTICATED_OUTSIDE_THE_DASHBOARD = [
  "config-public",
  "handlers/register",
  "manifest",
  "register",
  "webhooks/fulfillment-created",
  "webhooks/order-cancelled",
  "webhooks/order-created",
  "webhooks/order-updated",
]

function apiRoutes(): string[] {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
    .map((file) => file.split(sep))
    .filter((parts) => parts.at(-1) === "route.ts")
    .map((parts) => parts.slice(0, -1).join("/"))
    .sort()
}

const DASHBOARD_ROUTES = apiRoutes().filter(
  (route) => !ROUTES_AUTHENTICATED_OUTSIDE_THE_DASHBOARD.includes(route),
)

describe("dashboard API tampering — every dashboard route requires a verified dashboard token", () => {
  it("lists only existing routes as authenticated outside the dashboard", () => {
    expect(apiRoutes()).toEqual(expect.arrayContaining(ROUTES_AUTHENTICATED_OUTSIDE_THE_DASHBOARD))
    expect(DASHBOARD_ROUTES).toEqual(expect.arrayContaining(["config", "payment-handlers/test-connection"]))
  })

  it.each(DASHBOARD_ROUTES)("/api/%s guards every handler with getAuthContext", (route) => {
    const source = readFileSync(join(API_DIR, route, "route.ts"), "utf8")
    const handlers = source.match(/export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? []
    const guards = source.match(/await getAuthContext\(request(, \["[A-Z_]+"\])?\)/g) ?? []
    expect(handlers.length).toBeGreaterThan(0)
    expect(guards.length).toBe(handlers.length)
    expect(source).not.toMatch(/export const (GET|POST|PUT|PATCH|DELETE)\b/)
  })
})

function publicConfigRequest(token: string | null = "storefront-service-token"): NextRequest {
  const headers: Record<string, string> = { "saleor-api-url": SALEOR_API_URL }
  if (token) headers.authorization = `Bearer ${token}`
  return new NextRequest("https://app.example/api/config-public", { headers })
}

function installedApp(): void {
  fetchSpy.mockImplementation(
    async () =>
      new Response(JSON.stringify({ data: { app: { id: "storefront-app", name: "Storefront" } } }), { status: 200 }),
  )
}

describe("config-public tampering — another installed app's token never receives a secret", () => {
  it("does not return the Prism API key", async () => {
    installedApp()

    const res = await getPublicConfig(publicConfigRequest())
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).not.toContain(STORED_PRISM_KEY)
  })

  it("does not return the ACP API key", async () => {
    installedApp()

    const res = await getPublicConfig(publicConfigRequest())
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).not.toContain(STORED_ACP_KEY)
  })

  it("still returns the non-secret handler settings the storefront needs", async () => {
    installedApp()

    const body = await (await getPublicConfig(publicConfigRequest())).json()

    expect(body.paymentHandlers).toHaveLength(1)
    expect(body.paymentHandlers[0].handlerId).toBe("xyz.fd.prism_payment")
    expect(body.paymentHandlers[0].config.apiUrl).toBe("https://prism-gw.fd.xyz")
    expect(body.paymentHandlers[0].config).not.toHaveProperty("apiKey")
    expect(body).not.toHaveProperty("acpApiKey")
  })

  it("drops every secret-looking handler field, whether named so or marked in the manifest", async () => {
    const entry = state.handlers["xyz.fd.prism_payment"] as PaymentHandlerEntry
    entry.config = { ...entry.config, webhookSecret: "whsec_value", accessToken: "tok_value", merchantPassword: "pw_value", signer: "manifest-marked", note: "plain" }
    entry.manifest = {
      ...entry.manifest!,
      configSchema: {
        type: "object",
        properties: {
          apiUrl: { type: "string", format: "uri" },
          apiKey: { type: "string", format: "password" },
          signer: { type: "string", writeOnly: true },
        },
      },
    }
    installedApp()

    const res = await getPublicConfig(publicConfigRequest())
    const text = await res.text()

    expect(text).not.toContain("whsec_value")
    expect(text).not.toContain("tok_value")
    expect(text).not.toContain("pw_value")
    expect(text).not.toContain("manifest-marked")
    expect(JSON.parse(text).paymentHandlers[0].config.note).toBe("plain")
  })

  it("rejects a request without credentials", async () => {
    const res = await getPublicConfig(publicConfigRequest(null))

    expect(res.status).toBe(401)
  })

  it("rejects a token that does not resolve to an installed app", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: { app: null } }), { status: 200 }))

    const res = await getPublicConfig(publicConfigRequest("stolen-user-token"))

    expect(res.status).toBe(401)
  })
})

const UNKNOWN_SALEOR_API_URL = "https://attacker.example/graphql/"

function callerRequest(
  path: string,
  init: { method?: string; token?: string; saleorApiUrl?: string; body?: unknown } = {},
): NextRequest {
  return new NextRequest(`https://app.example${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${init.token ?? "storefront-service-token"}`,
      "saleor-api-url": init.saleorApiUrl ?? SALEOR_API_URL,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

function registerRequest(manifestId: string, token?: string, saleorApiUrl?: string): NextRequest {
  return callerRequest("/api/handlers/register", {
    method: "POST",
    token,
    saleorApiUrl,
    body: { manifest: { id: manifestId, name: manifestId, version: "2026-10-19", displayName: `from ${token ?? "default"}` } },
  })
}

describe("storefront caller auth — an unknown Saleor URL is refused before any outbound call", () => {
  it("config-public answers 401 and never fetches the unknown URL", async () => {
    installedApp()

    const res = await getPublicConfig(callerRequest("/api/config-public", { saleorApiUrl: UNKNOWN_SALEOR_API_URL }))

    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(state.managers).toBe(0)
  })

  it("handler register answers 401 and never fetches the unknown URL", async () => {
    installedApp()

    const res = await registerHandler(registerRequest("xyz.fd.new_payment", undefined, UNKNOWN_SALEOR_API_URL))

    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(state.managers).toBe(0)
  })

  it("answers 401 when the APL lookup throws, without any outbound call", async () => {
    installedApp()
    aplGet.mockRejectedValue(new Error("Unknown saleorApiUrl"))

    const publicRes = await getPublicConfig(callerRequest("/api/config-public", { saleorApiUrl: UNKNOWN_SALEOR_API_URL }))
    const registerRes = await registerHandler(registerRequest("xyz.fd.new_payment", undefined, UNKNOWN_SALEOR_API_URL))

    expect(publicRes.status).toBe(401)
    expect(registerRes.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("still validates the caller token against a known Saleor URL", async () => {
    installedApp()

    const publicRes = await getPublicConfig(callerRequest("/api/config-public"))
    const registerRes = await registerHandler(registerRequest("xyz.fd.new_payment"))

    expect(publicRes.status).toBe(200)
    expect(registerRes.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchSpy.mock.calls) {
      expect(url).toBe(SALEOR_API_URL)
      expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer storefront-service-token" })
    }
  })
})

const APP_A_TOKEN = "app-a-token"
const APP_B_TOKEN = "app-b-token"
const APP_IDS_BY_TOKEN: Record<string, string> = { [APP_A_TOKEN]: "app-A", [APP_B_TOKEN]: "app-B" }

function installedApps(): void {
  fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
    const token = String((init.headers as Record<string, string>).Authorization).replace("Bearer ", "")
    const id = APP_IDS_BY_TOKEN[token]
    return new Response(JSON.stringify({ data: { app: id ? { id, name: id } : null } }), { status: 200 })
  })
}

function storedPrism(): PaymentHandlerEntry {
  return JSON.parse(JSON.stringify(state.handlers["xyz.fd.prism_payment"]))
}

describe("handler register tampering — a handler id belongs to the app that registered it first", () => {
  beforeEach(() => {
    installedApps()
  })

  it("refuses another app that registers an id already owned, leaving the entry unchanged", async () => {
    delete state.handlers["xyz.fd.prism_payment"]
    const first = await registerHandler(registerRequest("xyz.fd.prism_payment", APP_A_TOKEN))
    expect(first.status).toBe(200)
    const entry = state.handlers["xyz.fd.prism_payment"] as PaymentHandlerEntry
    entry.enabled = true
    entry.channels = ["default-channel"]
    const before = storedPrism()

    const res = await registerHandler(registerRequest("xyz.fd.prism_payment", APP_B_TOKEN))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("handler_owned_by_other_app")
    expect(storedPrism()).toEqual(before)
    expect(storedPrism().manifest?.displayName).toBe(`from ${APP_A_TOKEN}`)
  })

  it("lets the owning app register its own id again", async () => {
    delete state.handlers["xyz.fd.prism_payment"]
    await registerHandler(registerRequest("xyz.fd.prism_payment", APP_A_TOKEN))

    const res = await registerHandler(registerRequest("xyz.fd.prism_payment", APP_A_TOKEN))

    expect(res.status).toBe(200)
    expect((await res.json()).created).toBe(false)
    expect(storedPrism().ownerAppId).toBe("app-A")
  })

  it("lets the first valid app claim an entry stored without an owner, then refuses others", async () => {
    const claim = await registerHandler(registerRequest("xyz.fd.prism_payment", APP_B_TOKEN))

    expect(claim.status).toBe(200)
    expect(storedPrism()).toMatchObject({
      ownerAppId: "app-B",
      enabled: PRISM_ENTRY.enabled,
      channels: PRISM_ENTRY.channels,
      config: PRISM_ENTRY.config,
    })

    const before = storedPrism()
    const res = await registerHandler(registerRequest("xyz.fd.prism_payment", APP_A_TOKEN))

    expect(res.status).toBe(403)
    expect(storedPrism()).toEqual(before)
  })

  it("keeps the owner when the dashboard saves the handler back without it or with another one", async () => {
    await registerHandler(registerRequest("xyz.fd.prism_payment", APP_A_TOKEN))
    const { ownerAppId: _owner, ...withoutOwner } = storedPrism()

    for (const submitted of [withoutOwner, { ...withoutOwner, ownerAppId: "app-B" }]) {
      const res = await postConfig(
        request("/api/config", {
          method: "POST",
          jwt: VALID_JWT,
          body: { paymentHandlers: { "xyz.fd.prism_payment": submitted } },
        }),
      )
      expect(res.status).toBe(200)
      expect(storedPrism().ownerAppId).toBe("app-A")
    }

    const res = await registerHandler(registerRequest("xyz.fd.prism_payment", APP_B_TOKEN))
    expect(res.status).toBe(403)
  })
})
