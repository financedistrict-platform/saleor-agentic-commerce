import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { CheckoutPrepareInput, PaymentHandlerAdapter, PaymentSettleInput, SaleorCheckout } from "@financedistrict/saleor-agentic-commerce-core"
import { buildRoutes, CHECKOUT_ID, checkoutTemplate, params, ucpRequest } from "./__tests__/harness.js"

const UCP_SESSIONS = "https://store.test/api/ucp/checkout-sessions"
const ACP_SESSIONS = "https://store.test/api/acp/checkout_sessions"
const EXPENSIVE_VARIANT = "UHJvZHVjdFZhcmlhbnQ6OTk5"
const QUOTE_KEY = "agentic_commerce__quote"
const SETTLEMENT_KEY = "agentic_commerce__settlement"

type Prepared = { preparedAmount: number; preparedCurrency: string }

function recordingHandler(options: { failPrepare?: () => boolean; settles?: (prepared: Prepared) => Prepared } = {}) {
  const settled: PaymentSettleInput[] = []
  const adapter: PaymentHandlerAdapter = {
    id: "test.pay",
    name: "Test Pay",
    async getUcpDiscoveryHandlers() { return {} },
    async getAcpDiscoveryHandlers() { return [] },
    async prepareCheckoutPayment(input: CheckoutPrepareInput) {
      if (options.failPrepare?.()) throw new Error("gateway unavailable")
      return { preparedAmount: input.total, preparedCurrency: input.currencyCode }
    },
    async settlePayment(input: PaymentSettleInput) {
      settled.push(input)
      const prepared = input.checkoutMetadata?.["test.pay"] as Prepared | null | undefined
      if (!prepared) return { success: false, error: "No prepared payment for this checkout" }
      const charged = options.settles ? options.settles(prepared) : prepared
      return {
        success: true,
        transactionReference: `0xsettled${settled.length}`,
        settled: { amount: charged.preparedAmount, currency: charged.preparedCurrency },
      }
    },
    getUcpCheckoutHandlers() { return {} },
    getAcpCheckoutHandlers() { return [] },
  }
  return { adapter, settled }
}

function preparedFor(amount: number, currency = "USD"): { key: string; value: string } {
  return { key: "test.pay", value: JSON.stringify({ preparedAmount: amount, preparedCurrency: currency }) }
}

function preparedCheckout(extra: { key: string; value: string }[] = []): SaleorCheckout {
  const checkout = checkoutTemplate()
  checkout.privateMetadata = [{ key: QUOTE_KEY, value: JSON.stringify({ amount: 5497, currency: "USD" }) }, preparedFor(5497), ...extra]
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

function quotedIn(checkout: SaleorCheckout, quote: { amount: number; currency: string }): SaleorCheckout {
  checkout.privateMetadata = [{ key: QUOTE_KEY, value: JSON.stringify(quote) }, preparedFor(quote.amount, quote.currency)]
  return checkout
}

function metadataValue(saleor: ReturnType<typeof buildRoutes>["saleor"], id: string, key: string) {
  const raw = saleor.checkouts.get(id)!.privateMetadata.find((m) => m.key === key)?.value
  return raw === undefined ? undefined : JSON.parse(raw)
}

function unreadableSettlement(): { key: string; value: string } {
  return {
    key: SETTLEMENT_KEY,
    value: JSON.stringify({ handlerId: "test.pay", reference: "0xprior", amount: 54.97, currency: "USD", settledAt: "2026-10-09T00:00:00.000Z" }),
  }
}

describe("Complete with a settlement record that cannot be read", () => {
  it("UCP holds the checkout instead of settling a second time", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout([unreadableSettlement()])] })

    const response = await ucpComplete(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("settlement_unreadable")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("ACP holds the checkout instead of settling a second time", async () => {
    const pay = recordingHandler()
    const { acpRoutes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout([unreadableSettlement()])] })

    const response = await acpComplete(acpRoutes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("settlement_unreadable")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })
})

describe("Complete after a handler failed to prepare the new total", () => {
  it("clears the old handler requirements in the same write as the new quote, so the old amount cannot be settled", async () => {
    let failing = false
    const pay = recordingHandler({ failPrepare: () => failing })
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter] })
    const created = await (await routes.checkoutSessions.POST(ucpRequest(UCP_SESSIONS, { body: { line_items: [{ item: { id: "v1" }, quantity: 1 }] } }))).json()
    const id = created.id as string
    expect(metadataValue(saleor, id, "test.pay")).toEqual({ preparedAmount: 5497, preparedCurrency: "USD" })

    failing = true
    const current = checkoutTemplate().lines.map((l) => ({ item: { id: l.variant.id }, quantity: l.quantity }))
    await routes.checkoutSession.PUT(
      ucpRequest(`${UCP_SESSIONS}/${id}`, { method: "PUT", body: { line_items: [...current, { item: { id: EXPENSIVE_VARIANT }, quantity: 1 }] } }),
      params({ id }),
    )
    expect(saleor.checkouts.get(id)!.totalPrice.gross.amount).toBe(154.97)
    expect(metadataValue(saleor, id, QUOTE_KEY)).toEqual({ amount: 15497, currency: "USD" })
    expect(metadataValue(saleor, id, "test.pay")).toBeNull()

    const response = await ucpComplete(routes, id)

    expect(response.status).toBe(422)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })
})

describe("Complete when the handler settles a different amount than the quote", () => {
  it("UCP records what the handler settled and holds the order", async () => {
    const pay = recordingHandler({ settles: () => ({ preparedAmount: 2000, preparedCurrency: "USD" }) })
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout()] })

    const response = await ucpComplete(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("settled_amount_mismatch")
    expect(metadataValue(saleor, CHECKOUT_ID, SETTLEMENT_KEY)).toMatchObject({ amount: 2000, currency: "USD", reference: "0xsettled1" })
    expect(saleor.transactions.map((t) => t.amountCharged)).toEqual([{ amount: 20, currency: "USD" }])
    expect(saleor.completed).toHaveLength(0)
  })

  it("ACP holds the order when the handler settles a different currency", async () => {
    const pay = recordingHandler({ settles: () => ({ preparedAmount: 5497, preparedCurrency: "EUR" }) })
    const { acpRoutes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout()] })

    const response = await acpComplete(acpRoutes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("settled_amount_mismatch")
    expect(saleor.completed).toHaveLength(0)
  })

  it("holds the order without settling again when the handler reports no settled amount", async () => {
    const pay = recordingHandler()
    pay.adapter.settlePayment = async (input) => {
      pay.settled.push(input)
      return { success: true, transactionReference: "0xunreported" } as never
    }
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout()] })

    const first = await ucpComplete(routes, CHECKOUT_ID)
    const retry = await ucpComplete(routes, CHECKOUT_ID)

    expect(first.status).toBe(409)
    expect((await first.json()).messages[0].code).toBe("settled_amount_unreported")
    expect(retry.status).toBe(409)
    expect((await retry.json()).messages[0].code).toBe("settlement_unreadable")
    expect(pay.settled).toHaveLength(1)
    expect(saleor.completed).toHaveLength(0)
  })
})

describe("Complete on a channel that allows unpaid orders", () => {
  it("UCP refuses before settling", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout()] })
    saleor.channel.allowUnpaidOrders = true

    const response = await ucpComplete(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("channel_allows_unpaid_orders")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("ACP refuses when the channel order settings cannot be read", async () => {
    const pay = recordingHandler()
    const { acpRoutes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout()] })
    saleor.channel.allowUnpaidOrders = null

    const response = await acpComplete(acpRoutes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("channel_order_settings_unreadable")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("reading a session does not place an unpaid order through the readiness probe", async () => {
    const { routes, saleor } = buildRoutes({ checkouts: [preparedCheckout()] })
    saleor.channel.allowUnpaidOrders = true

    const response = await routes.checkoutSession.GET(ucpRequest(`${UCP_SESSIONS}/${CHECKOUT_ID}`), params({ id: CHECKOUT_ID }))
    const session = await response.json()

    expect(saleor.completed).toHaveLength(0)
    expect(session.status).toBe("incomplete")
    expect(session.messages.map((m: { code: string }) => m.code)).toContain("channel_allows_unpaid_orders")
  })
})

describe("Complete with a billing address that changes the total", () => {
  it("UCP compares the quote with the total after the billing update and refuses before settling", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout()] })

    const response = await routes.checkoutSessionComplete.POST(
      ucpRequest(`${UCP_SESSIONS}/${CHECKOUT_ID}/complete`, {
        body: {
          payment: {
            instruments: [{
              id: "inst_1",
              handler_id: "test.pay",
              type: "test",
              credential: { token: "signed-for-54.97" },
              billing_address: { street_address: "1 Main St", address_locality: "Austin", address_region: "TX", postal_code: "78701", address_country: "US" },
            }],
          },
        },
      }),
      params({ id: CHECKOUT_ID }),
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("payment_quote_stale")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.transactions).toHaveLength(0)
  })
})

describe("Complete happy path and currency checks", () => {
  it("ACP completes and records the settled amount when quote, total and settlement agree", async () => {
    const pay = recordingHandler()
    const { acpRoutes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [preparedCheckout()] })

    const response = await acpComplete(acpRoutes, CHECKOUT_ID)

    expect(response.status).toBe(200)
    expect(pay.settled).toHaveLength(1)
    expect(saleor.transactions.map((t) => t.amountCharged)).toEqual([{ amount: 54.97, currency: "USD" }])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("UCP treats a quote in another currency with the same minor amount as stale", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [quotedIn(checkoutTemplate(), { amount: 5497, currency: "EUR" })] })

    const response = await ucpComplete(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("payment_quote_stale")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })
})
