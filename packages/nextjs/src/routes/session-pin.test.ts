import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { SaleorCheckout } from "@financedistrict/saleor-agentic-commerce-core"
import {
  AGENT_0408,
  AGENT_0825,
  AGENT_DOWN,
  buildRoutes,
  CHECKOUT_ID,
  checkoutTemplate,
  params,
  PINNED_0408_CONFIG,
  ucpRequest,
} from "./__tests__/harness.js"

const SESSIONS = "https://store.test/api/ucp/checkout-sessions"

function pinnedCheckout(version?: string): SaleorCheckout {
  const checkout = checkoutTemplate()
  if (version) checkout.privateMetadata = [...checkout.privateMetadata, { key: "ucp_version", value: version }]
  return checkout
}

function metadataValue(checkout: SaleorCheckout | undefined, key: string): string | undefined {
  return checkout?.privateMetadata.find((m) => m.key === key)?.value
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("checkout session version pin", () => {
  it("pins a new session to a matched agent version and answers in it", async () => {
    const { routes, saleor } = buildRoutes()
    const response = await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { agent: AGENT_0825, body: { line_items: [{ item: { id: "v1" }, quantity: 1 }] } }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.ucp.version).toBe("2026-08-25")
    expect(metadataValue(saleor.checkouts.get(body.id), "ucp_version")).toBe("2026-08-25")
  })

  it("does not pin a new session on a fallback outcome", async () => {
    const { routes, saleor } = buildRoutes({ config: PINNED_0408_CONFIG })
    const response = await routes.checkoutSessions.POST(ucpRequest(SESSIONS, { agent: AGENT_DOWN, body: { line_items: [{ item: { id: "v1" }, quantity: 1 }] } }))
    const body = await response.json()

    expect(body.ucp.version).toBe("2026-04-08")
    expect(metadataValue(saleor.checkouts.get(body.id), "ucp_version")).toBeUndefined()
  })

  it("answers 422 version_unsupported in the current wire when a matched version differs from the pin", async () => {
    const { routes } = buildRoutes({ config: PINNED_0408_CONFIG, checkouts: [pinnedCheckout("2026-08-25")] })
    const response = await routes.checkoutSession.GET(ucpRequest(`${SESSIONS}/${CHECKOUT_ID}`, { agent: AGENT_0408 }), params({ id: CHECKOUT_ID }))

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      ucp: { version: "2026-04-08", status: "error" },
      messages: [{
        type: "error",
        code: "version_unsupported",
        content: "Version 2026-04-08 is not supported. This business implements versions 2026-04-08, 2026-08-25, 2026-01-23.",
        severity: "unrecoverable",
      }],
    })
  })

  it.each([
    ["an unreachable agent profile", AGENT_DOWN],
    ["no UCP-Agent header", undefined],
  ])("keeps the pinned version for %s", async (_label, agent) => {
    const { routes } = buildRoutes({ checkouts: [pinnedCheckout("2026-08-25")] })
    const response = await routes.checkoutSession.GET(ucpRequest(`${SESSIONS}/${CHECKOUT_ID}`, { agent }), params({ id: CHECKOUT_ID }))

    expect(response.status).toBe(200)
    expect((await response.json()).ucp.version).toBe("2026-08-25")
  })

  it("never rejects an unpinned session created before the upgrade", async () => {
    const { routes } = buildRoutes({ checkouts: [pinnedCheckout()] })
    const response = await routes.checkoutSession.GET(ucpRequest(`${SESSIONS}/${CHECKOUT_ID}`, { agent: AGENT_0825 }), params({ id: CHECKOUT_ID }))

    expect(response.status).toBe(200)
    expect((await response.json()).ucp.version).toBe("2026-08-25")
  })

  it("renders a malformed instrument error in the pinned version", async () => {
    const { routes } = buildRoutes({ checkouts: [pinnedCheckout("2026-01-23")] })
    const response = await routes.checkoutSessionComplete.POST(
      ucpRequest(`${SESSIONS}/${CHECKOUT_ID}/complete`, { agent: AGENT_DOWN, body: { payment: { instruments: [{ id: "i1" }] } } }),
      params({ id: CHECKOUT_ID }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ucp: { version: "2026-01-23" }, status: "requires_escalation" })
  })

  it("applies the pin on update and cancel", async () => {
    const { routes } = buildRoutes({ checkouts: [pinnedCheckout("2026-08-25")] })
    const update = await routes.checkoutSession.PUT(
      ucpRequest(`${SESSIONS}/${CHECKOUT_ID}`, { agent: AGENT_0408, method: "PUT", body: {} }),
      params({ id: CHECKOUT_ID }),
    )
    const cancel = await routes.checkoutSessionCancel.POST(
      ucpRequest(`${SESSIONS}/${CHECKOUT_ID}/cancel`, { agent: AGENT_DOWN, body: {} }),
      params({ id: CHECKOUT_ID }),
    )

    expect(update.status).toBe(422)
    expect(cancel.status).toBe(200)
    expect(await cancel.json()).toMatchObject({ ucp: { version: "2026-08-25" }, status: "canceled" })
  })
})
