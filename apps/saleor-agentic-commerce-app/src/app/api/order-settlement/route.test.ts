import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { NextRequest } from "next/server"

const SALEOR_API_URL = "https://shop.example/graphql/"
const PRISM_URL = "https://prism.test/api/v2/merchant/payments/0xabc/settlement"
const PRISM_KEY = "prism-key"
const VALID_JWT = "valid.dashboard.jwt"
const APPS_ONLY_JWT = "apps-only.dashboard.jwt"
const GRANTED_PERMISSIONS: Record<string, string[] | undefined> = {
  [VALID_JWT]: ["MANAGE_APPS", "MANAGE_ORDERS"],
  [APPS_ONLY_JWT]: ["MANAGE_APPS"],
}

const state = vi.hoisted(() => ({
  handler: null as unknown,
  transactions: [] as { name: string; pspReference: string | null }[],
  prism: (() => new Response("{}")) as () => Response | Promise<Response>,
}))

const aplGet = vi.hoisted(() => vi.fn())
const verifyJWT = vi.hoisted(() => vi.fn())

vi.mock("@/lib/saleor-app", () => ({ saleorApp: { apl: { get: aplGet } } }))
vi.mock("@saleor/app-sdk/auth", () => ({ verifyJWT }))
vi.mock("@/lib/config-manager", () => ({
  ConfigManager: class {
    async getPaymentHandler() {
      return state.handler
    }
  },
}))

const { GET } = await import("./route")

const CONFIRMED_BODY = {
  transaction: "0xabc",
  network: "eip155:84532",
  asset: "USDC",
  status: "confirmed",
  gross: "100.00",
  fee: "1.50",
  cashback: "5.00",
  net: "93.50",
}

const PRISM_TRANSACTION = { name: "Finance District Prism", pspReference: "0xabc" }

function defaultHandler(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    channels: null,
    config: { apiUrl: "https://prism.test", apiKey: PRISM_KEY },
    ...overrides,
  }
}

function request(jwt: string | null = VALID_JWT): NextRequest {
  const headers: Record<string, string> = { "saleor-api-url": SALEOR_API_URL }
  if (jwt) headers["authorization-bearer"] = jwt
  return new NextRequest("https://app.example/api/order-settlement?orderId=T3JkZXI6MQ==", { headers })
}

function prismJson(body: unknown, status = 200) {
  state.prism = () => new Response(JSON.stringify(body), { status })
}

const fetchSpy = vi.fn()

function prismCalls() {
  return fetchSpy.mock.calls.filter(([url]) => String(url).startsWith("https://prism.test"))
}

beforeEach(() => {
  state.handler = defaultHandler()
  state.transactions = [PRISM_TRANSACTION]
  prismJson(CONFIRMED_BODY)
  aplGet.mockReset()
  aplGet.mockResolvedValue({ appId: "app-123", saleorApiUrl: SALEOR_API_URL, token: "app-token" })
  verifyJWT.mockReset()
  verifyJWT.mockImplementation(
    async ({ token, requiredPermissions }: { token: string; requiredPermissions?: string[] }) => {
      const granted = GRANTED_PERMISSIONS[token]
      if (!granted) throw new Error("JWT verification failed")
      if (!(requiredPermissions ?? []).every((p) => granted.includes(p))) {
        throw new Error("JWT verification failed: permissions are not sufficient")
      }
    }
  )
  fetchSpy.mockReset()
  fetchSpy.mockImplementation(async (url: string) => {
    if (String(url) === SALEOR_API_URL) {
      return new Response(
        JSON.stringify({
          data: { order: { channel: { slug: "default" }, transactions: state.transactions } },
        })
      )
    }
    return state.prism()
  })
  vi.stubGlobal("fetch", fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("GET /api/order-settlement", () => {
  it("returns the confirmed summary and calls Prism with the stored key", async () => {
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      state: "confirmed",
      net: "93.50",
      cashback: "5.00",
      fee: "1.50",
      asset: "USDC",
    })
    const calls = prismCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(PRISM_URL)
    expect(calls[0][1].headers).toEqual({ "X-API-Key": PRISM_KEY })
  })

  it("returns pending while the payment is broadcasted", async () => {
    prismJson({ ...CONFIRMED_BODY, status: "broadcasted" })
    const res = await GET(request())
    expect(await res.json()).toEqual({ state: "pending" })
  })

  it("returns unavailable when Prism answers 500", async () => {
    prismJson({ error: "boom" }, 500)
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: "unavailable" })
  })

  it("returns unavailable when the Prism request fails", async () => {
    state.prism = () => {
      throw new Error("network down")
    }
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: "unavailable" })
  })

  it("returns unavailable without calling Prism when the handler excludes the order channel", async () => {
    state.handler = defaultHandler({ channels: ["other"] })
    const res = await GET(request())
    expect(await res.json()).toEqual({ state: "unavailable" })
    expect(prismCalls()).toHaveLength(0)
  })

  it("returns unavailable without calling Prism when the handler has no key", async () => {
    state.handler = defaultHandler({ config: { apiUrl: "https://prism.test", apiKey: "" } })
    const res = await GET(request())
    expect(await res.json()).toEqual({ state: "unavailable" })
    expect(prismCalls()).toHaveLength(0)
  })

  it("returns none when the order has no Prism transaction", async () => {
    state.transactions = [{ name: "Other PSP", pspReference: "ref-1" }]
    const res = await GET(request())
    expect(await res.json()).toEqual({ state: "none" })
    expect(prismCalls()).toHaveLength(0)
  })

  it("rejects a request without a dashboard token", async () => {
    const res = await GET(request(null))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects in one verification a staff token that lacks MANAGE_ORDERS without calling Saleor or Prism", async () => {
    const res = await GET(request(APPS_ONLY_JWT))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(aplGet).toHaveBeenCalledTimes(1)
    expect(verifyJWT).toHaveBeenCalledTimes(1)
  })

  it("never puts the Prism key in a response body", async () => {
    const bodies = [
      await (await GET(request())).text(),
      await (await GET(request(null))).text(),
    ]
    prismJson({ error: PRISM_KEY }, 500)
    bodies.push(await (await GET(request())).text())
    for (const body of bodies) expect(body).not.toContain(PRISM_KEY)
  })
})
