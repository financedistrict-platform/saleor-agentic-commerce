import { describe, it, expect } from "vitest"
import { DummyPaymentHandler, DUMMY_HANDLER_ID } from "./handler.js"

const PREPARE = {
  checkoutId: "Q2hlY2tvdXQ6YWJj",
  total: 1299,
  currencyCode: "USD",
  checkoutBaseUrl: "https://shop.example.com/api/ucp/checkout-sessions",
  storeName: "Test",
}

describe("DummyPaymentHandler — checkout config round-trip (U-1)", () => {
  it("reads prepared config back under the adapter id (the registry's storage key)", async () => {
    const h = new DummyPaymentHandler({ mode: "always_succeed" })
    const prepared = await h.prepareCheckoutPayment(PREPARE)
    // The registry keys prepare-results by adapter id (payment-handler-registry.ts:117),
    // so that is where getUcpCheckoutHandlers must read them back from.
    const metadata = { [DUMMY_HANDLER_ID]: prepared }

    const ucp = h.getUcpCheckoutHandlers(metadata)
    expect(Object.keys(ucp)).toContain(DUMMY_HANDLER_ID)
    expect(ucp[DUMMY_HANDLER_ID]).toHaveLength(1)

    const acp = h.getAcpCheckoutHandlers(metadata)
    expect(acp).toHaveLength(1)
  })

  it("is idempotent: prepare returns the stored blob when the amount is unchanged", async () => {
    const h = new DummyPaymentHandler()
    const first = await h.prepareCheckoutPayment(PREPARE)
    const metadata = { [DUMMY_HANDLER_ID]: first }
    const second = await h.prepareCheckoutPayment({ ...PREPARE, checkoutMetadata: metadata })
    expect(second).toBe(first)
  })

  it("returns empty handlers when no prepared config is present", () => {
    const h = new DummyPaymentHandler()
    expect(h.getUcpCheckoutHandlers({})).toEqual({})
    expect(h.getAcpCheckoutHandlers({})).toEqual([])
  })
})
