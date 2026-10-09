import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { CheckoutPrepareInput, PaymentHandlerAdapter, PaymentSettleInput, SaleorCheckout } from "@financedistrict/saleor-agentic-commerce-core"
import { buildRoutes, CHECKOUT_ID, checkoutTemplate, params, ucpRequest } from "./__tests__/harness.js"

const UCP_SESSIONS = "https://store.test/api/ucp/checkout-sessions"
const ACP_SESSIONS = "https://store.test/api/acp/checkout_sessions"
const EXPENSIVE_VARIANT = "UHJvZHVjdFZhcmlhbnQ6OTk5"
const QUOTE_KEY = "agentic_commerce__quote"
const SETTLEMENT_KEY = "agentic_commerce__settlement"

function recordingHandler() {
  const settled: PaymentSettleInput[] = []
  const adapter: PaymentHandlerAdapter = {
    id: "test.pay",
    name: "Test Pay",
    async getUcpDiscoveryHandlers() { return {} },
    async getAcpDiscoveryHandlers() { return [] },
    async prepareCheckoutPayment(input: CheckoutPrepareInput) { return { preparedAmount: input.total, currency: input.currencyCode } },
    async settlePayment(input: PaymentSettleInput) {
      settled.push(input)
      return { success: true, transactionReference: `0xsettled${settled.length}` }
    },
    getUcpCheckoutHandlers() { return {} },
    getAcpCheckoutHandlers() { return [] },
  }
  return { adapter, settled }
}

function preparedCheckout(extra: { key: string; value: string }[] = []): SaleorCheckout {
  const checkout = checkoutTemplate()
  checkout.privateMetadata = [{ key: QUOTE_KEY, value: JSON.stringify({ amount: 5497, currency: "USD" }) }, ...extra]
  return checkout
}

function settledEarlier(): { key: string; value: string } {
  return {
    key: SETTLEMENT_KEY,
    value: JSON.stringify({ handlerId: "test.pay", reference: "0xprior", amount: 5497, currency: "USD", settledAt: "2026-10-09T00:00:00.000Z" }),
  }
}

function setTotal(saleor: ReturnType<typeof buildRoutes>["saleor"], id: string, amount: number) {
  saleor.checkouts.get(id)!.totalPrice.gross.amount = amount
}

function setQuote(saleor: ReturnType<typeof buildRoutes>["saleor"], id: string, amount: number) {
  const checkout = saleor.checkouts.get(id)!
  checkout.privateMetadata = [
    ...checkout.privateMetadata.filter((m) => m.key !== QUOTE_KEY),
    { key: QUOTE_KEY, value: JSON.stringify({ amount, currency: "USD" }) },
  ]
}

function ucpComplete(routes: ReturnType<typeof buildRoutes>["routes"], id: string) {
  return routes.checkoutSessionComplete.POST(
    ucpRequest(`${UCP_SESSIONS}/${id}/complete`, {
      body: { payment: { instruments: [{ id: "inst_1", handler_id: "test.pay", type: "test", credential: { token: "signed-for-54.97" } }] } },
    }),
    params({ id }),
  )
}

function acpComplete(acpRoutes: ReturnType<typeof buildRoutes>["acpRoutes"], id: string) {
  return acpRoutes.checkoutSessionComplete.POST(
    new Request(`${ACP_SESSIONS}/${id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_data: { handler_id: "test.pay", instrument: { credential: { token: "signed-for-54.97" } } } }),
    }),
    params({ id }),
  )
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("UCP complete with a cart changed after the quote", () => {
  it("refuses to settle an old quote after an update added items and then failed before re-quoting", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter] })
    const created = await (await routes.checkoutSessions.POST(ucpRequest(UCP_SESSIONS, { body: { line_items: [{ item: { id: "v1" }, quantity: 1 }] } }))).json()
    const id = created.id as string
    const current = checkoutTemplate().lines.map((l) => ({ item: { id: l.variant.id }, quantity: l.quantity }))

    const update = await routes.checkoutSession.PUT(
      ucpRequest(`${UCP_SESSIONS}/${id}`, {
        method: "PUT",
        body: { line_items: [{ ...current[0], quantity: current[0].quantity + 50 }, ...current.slice(1), { item: { id: EXPENSIVE_VARIANT }, quantity: 1 }] },
      }),
      params({ id }),
    )
    expect(update.status).toBe(422)
    expect(saleor.checkouts.get(id)!.totalPrice.gross.amount).toBe(154.97)

    const response = await ucpComplete(routes, id)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("payment_quote_stale")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("rejects completion when no quote is stored instead of skipping the check", async () => {
    const pay = recordingHandler()
    const checkout = checkoutTemplate()
    checkout.privateMetadata = []
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [checkout] })

    const response = await ucpComplete(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("payment_quote_missing")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("records the settled amount, not the live total, and holds the order when the cart grew after settlement", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout([settledEarlier()])] })
    setTotal(saleor, CHECKOUT_ID, 154.97)
    setQuote(saleor, CHECKOUT_ID, 15497)

    const response = await ucpComplete(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("order_total_changed_after_settlement")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.transactions.map((t) => t.amountCharged)).toEqual([{ amount: 54.97, currency: "USD" }])
    expect(saleor.completed).toHaveLength(0)
  })

  it("completes and records the settled amount when quote, total and settlement agree", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout()] })

    const response = await ucpComplete(routes, CHECKOUT_ID)

    expect(response.status).toBe(200)
    expect(pay.settled).toHaveLength(1)
    expect(saleor.transactions.map((t) => t.amountCharged)).toEqual([{ amount: 54.97, currency: "USD" }])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})

describe("ACP complete with a cart changed after the quote", () => {
  it("refuses to settle an old quote when the live total is higher", async () => {
    const pay = recordingHandler()
    const { acpRoutes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout()] })
    setTotal(saleor, CHECKOUT_ID, 154.97)

    const response = await acpComplete(acpRoutes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("payment_quote_stale")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("records the settled amount and holds the order when the cart grew after settlement", async () => {
    const pay = recordingHandler()
    const { acpRoutes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout([settledEarlier()])] })
    setTotal(saleor, CHECKOUT_ID, 154.97)
    setQuote(saleor, CHECKOUT_ID, 15497)

    const response = await acpComplete(acpRoutes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("order_total_changed_after_settlement")
    expect(saleor.transactions.map((t) => t.amountCharged)).toEqual([{ amount: 54.97, currency: "USD" }])
    expect(saleor.completed).toHaveLength(0)
  })
})
