import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

describe("DummyPaymentHandler on a production configuration", () => {
  const settleInput = (prepared: unknown) => ({
    checkoutId: PREPARE.checkoutId,
    channel: "default-channel",
    handlerId: DUMMY_HANDLER_ID,
    ucpVersion: "2026-04-08",
    credential: {},
    checkoutMetadata: { [DUMMY_HANDLER_ID]: prepared },
  })

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("refuses to settle a prepared checkout in production without an explicit opt-in", async () => {
    const prepared = await new DummyPaymentHandler().prepareCheckoutPayment(PREPARE)
    vi.stubEnv("NODE_ENV", "production")
    const h = new DummyPaymentHandler({ mode: "always_succeed" })

    const result = await h.settlePayment(settleInput(prepared))

    expect(result.success).toBe(false)
  })

  it("is not advertised or prepared in production without an explicit opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const h = new DummyPaymentHandler()

    expect(await h.getUcpDiscoveryHandlers()).toEqual({})
    expect(await h.getAcpDiscoveryHandlers()).toEqual([])
    expect(await h.prepareCheckoutPayment(PREPARE)).toBeNull()
  })

  it("ignores the mode env var forcing success when production refuses it", async () => {
    const prepared = await new DummyPaymentHandler().prepareCheckoutPayment(PREPARE)
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DUMMY_PAYMENT_MODE", "always_succeed")

    const result = await new DummyPaymentHandler().settlePayment(settleInput(prepared))

    expect(result.success).toBe(false)
  })

  it("refuses to settle when NODE_ENV is not set", async () => {
    const prepared = await new DummyPaymentHandler().prepareCheckoutPayment(PREPARE)
    vi.stubEnv("NODE_ENV", undefined)

    const result = await new DummyPaymentHandler().settlePayment(settleInput(prepared))

    expect(result.success).toBe(false)
  })

  it("settles in production when the code opts in explicitly", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const h = new DummyPaymentHandler({ mode: "always_succeed", allowInProduction: true })
    const prepared = await h.prepareCheckoutPayment(PREPARE)

    const result = await h.settlePayment(settleInput(prepared))

    expect(result.success).toBe(true)
  })
})

describe("DummyPaymentHandler settlement declaration", () => {
  const settleInput = (prepared: unknown, checkoutId = PREPARE.checkoutId) => ({
    checkoutId,
    channel: "default-channel",
    handlerId: DUMMY_HANDLER_ID,
    ucpVersion: "2026-04-08",
    credential: {},
    checkoutMetadata: { [DUMMY_HANDLER_ID]: prepared },
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("declares one key per checkout and prepared intent", async () => {
    const h = new DummyPaymentHandler()
    const prepared = await h.prepareCheckoutPayment(PREPARE)
    const intent = (prepared as { config: { intent_id: string } }).config.intent_id

    expect(h.settlementKeys(settleInput(prepared))).toEqual({
      ok: true,
      keys: [JSON.stringify(["dummy", PREPARE.checkoutId, intent])],
      settled: { amount: PREPARE.total, currency: PREPARE.currencyCode },
    })
  })

  it("refuses to declare keys without a prepared payment", () => {
    expect(new DummyPaymentHandler().settlementKeys(settleInput(undefined))).toMatchObject({ ok: false })
  })

  it("refuses to declare keys when the handler is disabled", async () => {
    const prepared = await new DummyPaymentHandler().prepareCheckoutPayment(PREPARE)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubEnv("NODE_ENV", "production")

    expect(new DummyPaymentHandler().settlementKeys(settleInput(prepared))).toMatchObject({ ok: false, code: "payment_handler_unavailable" })
  })

  it("reports a simulated failure and a refusal as declined", async () => {
    const failing = new DummyPaymentHandler({ mode: "always_fail" })
    const prepared = await failing.prepareCheckoutPayment(PREPARE)

    expect(await failing.settlePayment(settleInput(prepared))).toMatchObject({ success: false, outcome: "declined" })
    expect(await failing.settlePayment(settleInput(undefined))).toMatchObject({ success: false, outcome: "declined" })
  })
})
