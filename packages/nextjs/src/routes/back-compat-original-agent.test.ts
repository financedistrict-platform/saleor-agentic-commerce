import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  buildRoutes,
  CHECKOUT_ID,
  checkoutTemplate,
  params,
  PINNED_0408_CONFIG,
  readFixture,
  stubPrismGateway,
  ucpRequest,
} from "./__tests__/harness.js"

const COMPLETE = `https://store.test/api/ucp/checkout-sessions/${CHECKOUT_ID}/complete`
const SIGNED = { x402Version: 2, payload: { signature: "0xsig", authorization: { from: "0xbuyer" } } }

let gateway: ReturnType<typeof stubPrismGateway>

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  gateway = stubPrismGateway()
})

afterEach(() => {
  gateway.restore()
  vi.restoreAllMocks()
})

function settleRequests() {
  return gateway.requests.filter((r) => r.url.endsWith("/api/v2/payment/settle"))
}

async function complete(instrument: Record<string, unknown>) {
  const { routes, saleor } = buildRoutes({ prism: true, config: PINNED_0408_CONFIG, checkouts: [checkoutTemplate()] })
  const response = await routes.checkoutSessionComplete.POST(
    ucpRequest(COMPLETE, { body: { payment: { instruments: [instrument] } } }),
    params({ id: CHECKOUT_ID }),
  )
  return { response, saleor }
}

describe("an original-era agent completing an in-flight original-release session", () => {
  it.each([
    ["handler_id xyz.fd.prism_payment, type tokenized, no id, credential without type", { handler_id: "xyz.fd.prism_payment", type: "tokenized", credential: SIGNED }],
    ["handler_id x402 without type", { id: "inst_1", handler_id: "x402", credential: SIGNED }],
    ["handler_id x402, type default, credential type x402", { id: "inst_1", handler_id: "x402", type: "default", credential: { ...SIGNED, type: "x402" } }],
  ])("settles %s through Prism under the canonical handler id", async (_label, instrument) => {
    const { response, saleor } = await complete(instrument)

    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe("completed")
    expect(settleRequests()).toHaveLength(1)
    expect(settleRequests()[0].headers["User-Agent"]).toMatch(/^fd-saleor-prism\/\d+\.\d+\.\d+/)
    expect(saleor.transactions).toEqual([{ checkoutId: CHECKOUT_ID, name: "Finance District Prism", pspReference: "0xsettled" }])
    const record = saleor.checkouts.get(CHECKOUT_ID)!.privateMetadata.find((m) => m.key === "agentic_commerce__settlement")
    expect(JSON.parse(record!.value).handlerId).toBe("xyz.fd.prism_payment")
  })

  it("answers the original request with the original response bytes", async () => {
    const { response } = await complete({ id: "inst_1", handler_id: "xyz.fd.prism_payment", type: "x402", credential: { ...SIGNED, type: "x402" } })
    const golden = readFixture("ucp/2026-04-08-prism-nsid/checkout__complete.json")
    expect(JSON.stringify(await response.json(), null, 2)).toBe(golden)
  })

  it("still refuses another handler id without settling", async () => {
    const { response } = await complete({ id: "inst_1", handler_id: "com.example.other", type: "x402", credential: SIGNED })

    expect(response.status).toBe(422)
    expect((await response.json()).messages[0].code).toBe("payment_failed")
    expect(settleRequests()).toHaveLength(0)
  })

  it("still refuses an instrument without handler_id", async () => {
    const { response } = await complete({ id: "inst_1", type: "x402", credential: SIGNED })

    expect(response.status).toBe(400)
    expect((await response.json()).messages[0].code).toBe("invalid_instrument")
    expect(settleRequests()).toHaveLength(0)
  })

  it("still refuses an instrument type that never existed for Prism", async () => {
    const { response } = await complete({ id: "inst_1", handler_id: "xyz.fd.prism_payment", type: "card", credential: SIGNED })

    expect(response.status).toBe(422)
    expect(settleRequests()).toHaveLength(0)
  })
})
