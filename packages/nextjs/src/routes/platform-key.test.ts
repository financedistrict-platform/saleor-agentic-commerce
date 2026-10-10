import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  ACP_AUTH,
  ACP_KEY,
  AGENT_UNKNOWN,
  buildRoutes,
  CHECKOUT_ID,
  params,
  ucpRequest,
} from "./__tests__/harness.js"

const SESSIONS = "https://store.test/api/ucp/checkout-sessions"
const SEARCH = "https://store.test/api/ucp/catalog/search"
const ORDER = "https://store.test/api/ucp/orders/T3JkZXI6MQ=="
const CREATE_BODY = { line_items: [{ item: { id: "v1" }, quantity: 1 }] }

function searchSpy(instance: ReturnType<typeof buildRoutes>["instance"]) {
  const searchProducts = vi.fn(async () => ({ ok: false as const, error: "down" }))
  instance.saleorClient.searchProducts = searchProducts as unknown as typeof instance.saleorClient.searchProducts
  return searchProducts
}

async function expectKeyNotFound(response: Response) {
  expect(response.status).toBe(401)
  const body = await response.json()
  expect(body.ucp.status).toBe("error")
  expect(body.messages[0].code).toBe("key_not_found")
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("UCP X-API-Key validation", () => {
  it("serves requests without the header exactly as before", async () => {
    const { routes, instance, saleor } = buildRoutes()
    const search = searchSpy(instance)

    const created = await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { body: CREATE_BODY }))
    const searched = await routes.catalogSearch.POST(ucpRequest(SEARCH, { body: { query: "x" } }))

    expect(created.status).toBe(201)
    expect(saleor.checkouts.size).toBe(1)
    expect(searched.status).toBe(422)
    expect((await searched.json()).messages[0].code).toBe("catalog_search_failed")
    expect(search).toHaveBeenCalledTimes(1)
  })

  it("proceeds with the configured key and answers like a request without one", async () => {
    const { routes, instance } = buildRoutes()
    searchSpy(instance)

    const bare = await routes.catalogSearch.POST(ucpRequest(SEARCH, { body: { query: "x" } }))
    const keyed = await routes.catalogSearch.POST(ucpRequest(SEARCH, { body: { query: "x" }, apiKey: ACP_KEY }))
    const created = await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { body: CREATE_BODY, apiKey: ACP_KEY }))

    expect(keyed.status).toBe(bare.status)
    expect(await keyed.json()).toEqual(await bare.json())
    expect(created.status).toBe(201)
  })

  it("accepts the configured key padded with whitespace", async () => {
    const { routes } = buildRoutes()

    const created = await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { body: CREATE_BODY, apiKey: `  ${ACP_KEY}  ` }))

    expect(created.status).toBe(201)
  })

  it("rejects a wrong key on every guarded route before reaching Saleor", async () => {
    const { routes, instance, saleor } = buildRoutes()
    const search = searchSpy(instance)
    const apiKey = "not-the-key"
    const before = saleor.checkouts.size

    await expectKeyNotFound(await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { body: CREATE_BODY, apiKey })))
    await expectKeyNotFound(await routes.checkoutSession.GET(ucpRequest(`${SESSIONS}/${CHECKOUT_ID}`, { apiKey }), params({ id: CHECKOUT_ID })))
    await expectKeyNotFound(await routes.order.GET(ucpRequest(ORDER, { apiKey, sessionSecret: "secret" }), params({ id: "T3JkZXI6MQ==" })))
    await expectKeyNotFound(await routes.catalogSearch.POST(ucpRequest(SEARCH, { body: { query: "x" }, apiKey })))

    expect(saleor.checkouts.size).toBe(before)
    expect(search).not.toHaveBeenCalled()
  })

  it("names the recovery in the error message", async () => {
    const { routes } = buildRoutes()

    const response = await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { body: CREATE_BODY, apiKey: "nope" }))

    expect((await response.json()).messages[0]).toMatchObject({
      type: "error",
      code: "key_not_found",
      severity: "recoverable",
      content: "The X-API-Key is not the key configured for this store. Remove the header or ask the store owner for the current key.",
    })
  })

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("rejects any presented key when the store key is %s", async (_label, acpApiKey) => {
    const { routes, saleor } = buildRoutes({ config: { acpApiKey } })
    const before = saleor.checkouts.size

    await expectKeyNotFound(await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { body: CREATE_BODY, apiKey: ACP_KEY })))

    expect(saleor.checkouts.size).toBe(before)
  })

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("keeps requests without a key open when the store key is %s", async (_label, acpApiKey) => {
    const { routes } = buildRoutes({ config: { acpApiKey } })

    const created = await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { body: CREATE_BODY }))

    expect(created.status).toBe(201)
  })

  it.each(["", "   "])("treats a blank header (%j) as absent", async (apiKey) => {
    const { routes } = buildRoutes()

    const created = await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { body: CREATE_BODY, apiKey }))

    expect(created.status).toBe(201)
  })

  it("lets an unsupported version rejection win over a wrong key", async () => {
    const { routes } = buildRoutes()

    const response = await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { agent: AGENT_UNKNOWN, body: CREATE_BODY, apiKey: "nope" }))

    expect(response.status).toBe(422)
    expect((await response.json()).messages[0].code).toBe("version_unsupported")
  })

  it("leaves ACP bearer authentication untouched by the header", async () => {
    const { acpRoutes } = buildRoutes()
    const request = new Request("https://store.test/api/acp/checkout_sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": "nope", ...ACP_AUTH },
      body: JSON.stringify({ items: [{ id: "v1", quantity: 1 }] }),
    })

    const response = await acpRoutes.checkoutSessions.POST(request)

    expect(response.status).not.toBe(401)
  })
})
