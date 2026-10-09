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
    const guards = source.match(/await getAuthContext\(request\)/g) ?? []
    expect(handlers.length).toBeGreaterThan(0)
    expect(guards.length).toBe(handlers.length)
    expect(source).not.toMatch(/export const (GET|POST|PUT|PATCH|DELETE)\b/)
  })
})
