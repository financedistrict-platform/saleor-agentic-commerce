import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { SaleorCheckout } from "@financedistrict/saleor-agentic-commerce-core"
import {
  AGENT_0408,
  buildRoutes,
  CHECKOUT_ID,
  checkoutTemplate,
  params,
  TEST_SESSION_SECRET,
  ucpRequest,
} from "./__tests__/harness.js"

const SESSION_URL = "https://store.test/api/ucp/checkout-sessions/" + CHECKOUT_ID
const SESSION_KEY = "agentic_commerce__session"

type Routes = ReturnType<typeof buildRoutes>["routes"]
type Call = (routes: Routes, secret: string | null) => Promise<Response>

const SESSION_ROUTES: [string, Call][] = [
  [
    "GET",
    (routes, secret) =>
      routes.checkoutSession.GET(ucpRequest(SESSION_URL, { agent: AGENT_0408, sessionSecret: secret }), params({ id: CHECKOUT_ID })),
  ],
  [
    "PUT",
    (routes, secret) =>
      routes.checkoutSession.PUT(
        ucpRequest(SESSION_URL, { agent: AGENT_0408, method: "PUT", body: { buyer: { email: "eve@example.com" } }, sessionSecret: secret }),
        params({ id: CHECKOUT_ID }),
      ),
  ],
  [
    "complete",
    (routes, secret) =>
      routes.checkoutSessionComplete.POST(
        ucpRequest(SESSION_URL + "/complete", {
          agent: AGENT_0408,
          body: { payment: { instruments: [{ handler_id: "x", credential: { token: "t" }, selected: true }] } },
          sessionSecret: secret,
        }),
        params({ id: CHECKOUT_ID }),
      ),
  ],
  [
    "cancel",
    (routes, secret) =>
      routes.checkoutSessionCancel.POST(ucpRequest(SESSION_URL + "/cancel", { agent: AGENT_0408, body: {}, sessionSecret: secret }), params({ id: CHECKOUT_ID })),
  ],
]

function withoutSession(checkout: SaleorCheckout): SaleorCheckout {
  return { ...checkout, privateMetadata: checkout.privateMetadata.filter((item) => item.key !== SESSION_KEY) }
}

function withGarbledSession(checkout: SaleorCheckout): SaleorCheckout {
  return {
    ...checkout,
    privateMetadata: checkout.privateMetadata.map((item) => (item.key === SESSION_KEY ? { key: SESSION_KEY, value: "garbage" } : item)),
  }
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body = await response.json()
  return body.messages?.[0]?.code ?? body.code
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(SESSION_ROUTES)("checkout session %s ownership", (_name, call) => {
  it("answers 401 session_secret_required without the header and writes nothing", async () => {
    const { routes, saleor } = buildRoutes({ checkouts: [checkoutTemplate()] })
    const response = await call(routes, null)
    const text = await response.text()

    expect(response.status).toBe(401)
    const body = JSON.parse(text)
    expect(body.messages?.[0]?.code ?? body.code).toBe("session_secret_required")
    expect(text).not.toContain("@")
    expect(saleor.writes).toEqual([])
  })

  it("answers 404 checkout_not_found for a wrong secret and writes nothing", async () => {
    const { routes, saleor } = buildRoutes({ checkouts: [checkoutTemplate()] })
    const response = await call(routes, "wrong-secret")

    expect(response.status).toBe(404)
    expect(await errorCode(response)).toBe("checkout_not_found")
    expect(saleor.writes).toEqual([])
  })

  it("answers 404 checkout_not_found when the checkout has no stored hash", async () => {
    const { routes, saleor } = buildRoutes({ checkouts: [withoutSession(checkoutTemplate())] })
    const response = await call(routes, TEST_SESSION_SECRET)

    expect(response.status).toBe(404)
    expect(await errorCode(response)).toBe("checkout_not_found")
    expect(saleor.writes).toEqual([])
  })

  it("answers 404 checkout_not_found when the stored hash is malformed", async () => {
    const { routes, saleor } = buildRoutes({ checkouts: [withGarbledSession(checkoutTemplate())] })
    const response = await call(routes, TEST_SESSION_SECRET)

    expect(response.status).toBe(404)
    expect(await errorCode(response)).toBe("checkout_not_found")
    expect(saleor.writes).toEqual([])
  })

  it("lets the right secret through", async () => {
    const { routes } = buildRoutes({ checkouts: [checkoutTemplate()] })
    const response = await call(routes, TEST_SESSION_SECRET)

    expect(response.status).not.toBe(401)
    expect(response.status).not.toBe(404)
  })
})

describe("checkout session ownership order", () => {
  it("checks the secret before reading the body", async () => {
    const { routes, saleor } = buildRoutes({ checkouts: [checkoutTemplate()] })
    const request = new Request(SESSION_URL, {
      method: "PUT",
      headers: { "content-type": "application/json", "UCP-Agent": 'profile="' + AGENT_0408 + '"', "UCP-Session-Secret": "wrong" },
      body: "{",
    })
    const response = await routes.checkoutSession.PUT(request, params({ id: CHECKOUT_ID }))

    expect(response.status).toBe(404)
    expect(saleor.writes).toEqual([])
  })

  it("checks the secret before the version pin", async () => {
    const checkout = checkoutTemplate()
    checkout.privateMetadata = [...checkout.privateMetadata, { key: "ucp_version", value: JSON.stringify("1999-01-01") }]
    const { routes } = buildRoutes({ checkouts: [checkout] })
    const response = await routes.checkoutSession.GET(
      ucpRequest(SESSION_URL, { agent: AGENT_0408, sessionSecret: "wrong-secret" }),
      params({ id: CHECKOUT_ID }),
    )

    expect(response.status).toBe(404)
    expect(await errorCode(response)).toBe("checkout_not_found")
  })
})

const OPEN = ["discovery", "discoveryVersion", "checkoutSessions", "catalogSearch", "catalogLookup"]
const GUARDED = ["checkoutSession", "checkoutSessionComplete", "checkoutSessionCancel", "order"]

describe("route coverage", () => {
  it("every UCP route is either open or guarded by the session secret", async () => {
    const { routes } = buildRoutes({ checkouts: [checkoutTemplate()] })
    expect(Object.keys(routes).sort()).toEqual([...OPEN, ...GUARDED].sort())

    for (const key of GUARDED) {
      const handlers = (routes as unknown as Record<string, Record<string, (r: Request, c: unknown) => Promise<Response>>>)[key]
      for (const [method, handler] of Object.entries(handlers)) {
        const response = await handler(
          ucpRequest(SESSION_URL, { agent: AGENT_0408, method, body: method === "GET" ? undefined : {}, sessionSecret: null }),
          params({ id: CHECKOUT_ID }),
        )
        expect(response.status, `${key}.${method}`).toBe(401)
      }
    }
  })
})
