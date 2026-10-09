import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createMemoryPaymentReplayStore } from "@financedistrict/saleor-agentic-commerce-core"
import type { CheckoutPrepareInput, PaymentHandlerAdapter, PaymentSettleInput, SaleorCheckout } from "@financedistrict/saleor-agentic-commerce-core"
import { buildRoutes, CHECKOUT_ID, checkoutTemplate, fakeSaleor, fixedFetcher, params, PROFILES, STOREFRONT, stubPrismGateway, ucpRequest } from "./__tests__/harness.js"
import { createAgenticCommerce } from "../config.js"
import { createAcpRoutes } from "./acp-routes.js"
import { createUcpRoutes } from "./ucp-routes.js"

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
        replayKeys: [],
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

function inCurrency(checkout: SaleorCheckout, currency: string, scale = 1): SaleorCheckout {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (typeof node !== "object" || node === null) return
    const record = node as Record<string, unknown>
    if (typeof record.amount === "number" && typeof record.currency === "string") {
      record.amount = Math.round(record.amount * scale * 100) / 100
      record.currency = currency
    }
    Object.values(record).forEach(visit)
  }
  const copy = structuredClone(checkout)
  visit(copy)
  return copy
}

function quotedIn(checkout: SaleorCheckout, quote: { amount: number; currency: string }): SaleorCheckout {
  checkout.privateMetadata = [{ key: QUOTE_KEY, value: JSON.stringify(quote) }, preparedFor(quote.amount, quote.currency)]
  return checkout
}

function createFrom(saleor: ReturnType<typeof buildRoutes>["saleor"], checkout: SaleorCheckout) {
  checkout.privateMetadata = []
  saleor.client.createCheckout = async () => {
    saleor.checkouts.set(checkout.id, structuredClone(checkout))
    return { ok: true as const, data: structuredClone(checkout) }
  }
}

function storedQuote(saleor: ReturnType<typeof buildRoutes>["saleor"], id: string) {
  const raw = saleor.checkouts.get(id)!.privateMetadata.find((m) => m.key === QUOTE_KEY)?.value
  return raw ? JSON.parse(raw) : null
}

function ucpCreate(routes: ReturnType<typeof buildRoutes>["routes"]) {
  return routes.checkoutSessions.POST(ucpRequest(UCP_SESSIONS, { body: { line_items: [{ item: { id: "v1" }, quantity: 1 }] } }))
}

describe("Checkout in a currency without two decimals", () => {
  let gateway: ReturnType<typeof stubPrismGateway>
  beforeEach(() => { gateway = stubPrismGateway() })
  afterEach(() => gateway.restore())

  const requirementsBodies = () =>
    gateway.requests.filter((r) => r.url.endsWith("/payment-requirements")).map((r) => r.body as { amount: string; currency: string })

  it("asks Prism for exactly the KWD total, not a tenth of it", async () => {
    const { routes, saleor } = buildRoutes({ prism: true })
    createFrom(saleor, inCurrency(checkoutTemplate(), "KWD"))

    const response = await ucpCreate(routes)

    expect(response.status).toBe(201)
    expect(requirementsBodies()).toEqual([expect.objectContaining({ amount: "54.970", currency: "KWD" })])
    expect(storedQuote(saleor, CHECKOUT_ID)).toEqual({ amount: 54970, currency: "KWD" })
  })

  it("asks Prism for exactly the JPY total, not a hundred times more", async () => {
    const { routes, saleor } = buildRoutes({ prism: true })
    createFrom(saleor, inCurrency(checkoutTemplate(), "JPY", 100))

    const response = await ucpCreate(routes)
    const session = await response.json()

    expect(response.status).toBe(201)
    expect(requirementsBodies()).toEqual([expect.objectContaining({ amount: "5497", currency: "JPY" })])
    expect(session.totals.find((t: { type: string }) => t.type === "total").amount).toBe(5497)
    expect(storedQuote(saleor, CHECKOUT_ID)).toEqual({ amount: 5497, currency: "JPY" })
  })

  it("rejects a currency with no known minor unit before any quote is made", async () => {
    const { routes, saleor } = buildRoutes({ prism: true })
    createFrom(saleor, inCurrency(checkoutTemplate(), "ZZZ"))

    const response = await ucpCreate(routes)
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.messages[0].code).toBe("unsupported_currency")
    expect(requirementsBodies()).toHaveLength(0)
    expect(storedQuote(saleor, CHECKOUT_ID)).toBeNull()
  })

  it("answers a read of an unsupported-currency checkout with unsupported_currency, not a server error", async () => {
    const { routes, acpRoutes } = buildRoutes({ checkouts: [inCurrency(checkoutTemplate(), "ZZZ")] })

    const ucp = await routes.checkoutSession.GET(ucpRequest(`${UCP_SESSIONS}/${CHECKOUT_ID}`), params({ id: CHECKOUT_ID }))
    const acp = await acpRoutes.checkoutSession.GET(new Request(`${ACP_SESSIONS}/${CHECKOUT_ID}`), params({ id: CHECKOUT_ID }))

    expect(ucp.status).toBe(422)
    expect((await ucp.json()).messages[0].code).toBe("unsupported_currency")
    expect(acp.status).toBe(422)
    expect((await acp.json()).code).toBe("unsupported_currency")
  })

  it("re-quotes Prism when the currency changes but the minor amount stays the same", async () => {
    const { instance } = buildRoutes({ prism: true })
    const prism = instance.paymentHandlers.getAdapter("xyz.fd.prism_payment")!
    const input = { checkoutId: CHECKOUT_ID, total: 10500, currencyCode: "USD", checkoutBaseUrl: UCP_SESSIONS, storeName: "Demo Store", ucpVersion: "2026-04-08" }

    const first = await prism.prepareCheckoutPayment(input)
    await prism.prepareCheckoutPayment({ ...input, currencyCode: "KWD", checkoutMetadata: { "xyz.fd.prism_payment": first } })

    expect(requirementsBodies()).toEqual([
      expect.objectContaining({ amount: "105.00", currency: "USD" }),
      expect.objectContaining({ amount: "10.500", currency: "KWD" }),
    ])
  })
})

describe("Complete in KWD", () => {
  it("UCP settles the three-decimal quote and records the charge in KWD", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [quotedIn(inCurrency(checkoutTemplate(), "KWD"), { amount: 54970, currency: "KWD" })] })

    const response = await ucpComplete(routes, CHECKOUT_ID)

    expect(response.status).toBe(200)
    expect(pay.settled).toHaveLength(1)
    expect(saleor.transactions.map((t) => t.amountCharged)).toEqual([{ amount: 54.97, currency: "KWD" }])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("UCP refuses a quote written with two-decimal minor units for a KWD total", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [quotedIn(inCurrency(checkoutTemplate(), "KWD"), { amount: 5497, currency: "KWD" })] })

    const response = await ucpComplete(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("payment_quote_stale")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("ACP settles the three-decimal quote and records the charge in KWD", async () => {
    const pay = recordingHandler()
    const { acpRoutes, saleor } = buildRoutes({ handlers: [pay.adapter], checkouts: [quotedIn(inCurrency(checkoutTemplate(), "KWD"), { amount: 54970, currency: "KWD" })] })

    const response = await acpComplete(acpRoutes, CHECKOUT_ID)

    expect(response.status).toBe(200)
    expect(saleor.transactions.map((t) => t.amountCharged)).toEqual([{ amount: 54.97, currency: "KWD" }])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})

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
      return { success: true, transactionReference: "0xunreported", replayKeys: [] } as never
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

describe("Complete with a Prism credential the signed-amount check cannot read", () => {
  const PRISM = "xyz.fd.prism_payment"
  const QUOTED = {
    scheme: "exact",
    network: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x1111111111111111111111111111111111111111",
    amount: "1000000",
  }

  let gateway: ReturnType<typeof stubPrismGateway>
  beforeEach(() => { gateway = stubPrismGateway() })
  afterEach(() => gateway.restore())

  const settleRequests = () => gateway.requests.filter((r) => r.url.endsWith("/api/v2/payment/settle"))

  function signed(value: string, authorization: Record<string, unknown> = {}) {
    return {
      x402Version: 2,
      accepted: { ...QUOTED, maxTimeoutSeconds: 300 },
      payload: {
        signature: "0xsig",
        authorization: { from: "0xbuyer", to: QUOTED.payTo, value, validAfter: "0", validBefore: "9999999999", nonce: "0x01", ...authorization },
      },
    }
  }

  function withoutAccepted(value: string) {
    const { accepted: _accepted, ...rest } = signed(value)
    return { ...rest, scheme: "exact", network: QUOTED.network }
  }

  function prismCheckout(mutate?: (blob: { ucp: Record<string, { config: { accepts: Record<string, unknown>[] } }[]> }) => void): SaleorCheckout {
    const checkout = checkoutTemplate()
    if (mutate) {
      checkout.privateMetadata = checkout.privateMetadata.map((m) => {
        if (m.key !== PRISM) return m
        const blob = JSON.parse(m.value)
        mutate(blob)
        return { key: m.key, value: JSON.stringify(blob) }
      })
    }
    return checkout
  }

  async function ucpPay(credential: object, checkout = prismCheckout()) {
    const { routes, saleor } = buildRoutes({ prism: true, checkouts: [checkout] })
    const response = await routes.checkoutSessionComplete.POST(
      ucpRequest(`${UCP_SESSIONS}/${CHECKOUT_ID}/complete`, {
        body: { payment: { instruments: [{ id: "inst_1", handler_id: PRISM, type: "x402", credential: { type: "x402", ...credential } }] } },
      }),
      params({ id: CHECKOUT_ID }),
    )
    return { response, saleor }
  }

  async function acpPay(credential: object, checkout = prismCheckout()) {
    const { acpRoutes, saleor } = buildRoutes({ prism: true, checkouts: [checkout] })
    const response = await acpRoutes.checkoutSessionComplete.POST(
      new Request(`${ACP_SESSIONS}/${CHECKOUT_ID}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_data: { handler_id: PRISM, instrument: { credential } } }),
      }),
      params({ id: CHECKOUT_ID }),
    )
    return { response, saleor }
  }

  function expectRefusedBeforeSettling(saleor: ReturnType<typeof buildRoutes>["saleor"]) {
    expect(settleRequests()).toHaveLength(0)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  }

  it("UCP settles a signed payment that matches the stored quote", async () => {
    const { response, saleor } = await ucpPay(signed(QUOTED.amount))

    expect(response.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(settleRequests()[0].body).toMatchObject({ paymentPayload: signed(QUOTED.amount), paymentRequirements: QUOTED })
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("UCP refuses a credential without an accepted block instead of skipping the amount check", async () => {
    const { response, saleor } = await ucpPay(withoutAccepted("1"))

    expect(response.status).toBe(422)
    expectRefusedBeforeSettling(saleor)
  })

  it("UCP refuses a payload that is not an EIP-3009 authorization", async () => {
    const { payload: _payload, ...rest } = signed("1")
    const permit2 = { signature: "0xsig", permit2Authorization: { from: "0xbuyer", spender: QUOTED.payTo, permitted: { token: QUOTED.asset, amount: "1" } } }
    const { response, saleor } = await ucpPay({ ...rest, payload: permit2 })

    expect(response.status).toBe(422)
    expectRefusedBeforeSettling(saleor)
  })

  it("UCP refuses when the stored quote entry has no amount", async () => {
    const checkout = prismCheckout((blob) => { delete blob.ucp[PRISM][0].config.accepts[0].amount })
    const { response, saleor } = await ucpPay(signed("1"), checkout)

    expect(response.status).toBe(422)
    expectRefusedBeforeSettling(saleor)
  })

  it("UCP refuses a quote entry in a scheme it cannot check", async () => {
    const checkout = prismCheckout((blob) => { blob.ucp[PRISM][0].config.accepts[0].scheme = "upto" })
    const { response, saleor } = await ucpPay({ ...signed(QUOTED.amount), accepted: { ...QUOTED, scheme: "upto" } }, checkout)

    expect(response.status).toBe(422)
    expectRefusedBeforeSettling(saleor)
  })

  it("UCP checks the payload it would settle when a legacy authorization rides along", async () => {
    const legacy = btoa(JSON.stringify(signed(QUOTED.amount)))
    const { response, saleor } = await ucpPay({ authorization: legacy, paymentPayload: signed("1") })

    expect(response.status).toBe(422)
    expect((await response.json()).messages[0].code).toBe("amount_mismatch")
    expectRefusedBeforeSettling(saleor)
  })

  it("UCP refuses a signed payment to another recipient", async () => {
    const { response, saleor } = await ucpPay(signed(QUOTED.amount, { to: "0x2222222222222222222222222222222222222222" }))

    expect(response.status).toBe(422)
    expectRefusedBeforeSettling(saleor)
  })

  it("ACP checks the signed amount against the same stored quote the settlement uses", async () => {
    const { response, saleor } = await acpPay(signed("1"))

    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe("amount_mismatch")
    expectRefusedBeforeSettling(saleor)
  })

  it("ACP settles a signed payment that matches the stored quote", async () => {
    const { response, saleor } = await acpPay(signed(QUOTED.amount))

    expect(response.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})

function alwaysPaysQuote(id: string) {
  const settled: PaymentSettleInput[] = []
  const adapter: PaymentHandlerAdapter = {
    id,
    name: "Always Pays",
    async getUcpDiscoveryHandlers() { return {} },
    async getAcpDiscoveryHandlers() { return [] },
    async prepareCheckoutPayment() { return null },
    async settlePayment(input: PaymentSettleInput) {
      settled.push(input)
      return { success: true, transactionReference: `0xfree${settled.length}`, settled: { amount: 5497, currency: "USD" }, replayKeys: [] }
    },
    getUcpCheckoutHandlers() { return {} },
    getAcpCheckoutHandlers() { return [] },
  }
  return { adapter, settled }
}

function ucpCompleteWith(routes: ReturnType<typeof buildRoutes>["routes"], id: string, handlerId: string) {
  return routes.checkoutSessionComplete.POST(
    ucpRequest(`${UCP_SESSIONS}/${id}/complete`, {
      body: { payment: { instruments: [{ id: "inst_1", handler_id: handlerId, type: "test", credential: { token: "none" } }] } },
    }),
    params({ id }),
  )
}

function acpCompleteWith(acpRoutes: ReturnType<typeof buildRoutes>["acpRoutes"], id: string, handlerId: string) {
  return acpRoutes.checkoutSessionComplete.POST(
    new Request(`${ACP_SESSIONS}/${id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_data: { handler_id: handlerId, instrument: { credential: { token: "none" } } } }),
    }),
    params({ id }),
  )
}

describe("Complete with a registered handler that was not prepared for the checkout", () => {
  it("UCP refuses to settle through a handler with no prepared entry on the checkout", async () => {
    const pay = recordingHandler()
    const free = alwaysPaysQuote("test.free")
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter, free.adapter], checkouts: [preparedCheckout()] })

    const response = await ucpCompleteWith(routes, CHECKOUT_ID, "test.free")
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.messages[0].code).toBe("payment_handler_not_prepared")
    expect(free.settled).toHaveLength(0)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("UCP refuses a prepared entry that is a list instead of a handler object", async () => {
    const pay = recordingHandler()
    const free = alwaysPaysQuote("test.free")
    const { routes, saleor } = buildRoutes({ handlers: [pay.adapter, free.adapter], checkouts: [preparedCheckout([{ key: "test.free", value: "[]" }])] })

    const response = await ucpCompleteWith(routes, CHECKOUT_ID, "test.free")

    expect(response.status).toBe(422)
    expect(free.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("ACP refuses to settle through a handler whose prepare failed for the checkout", async () => {
    const pay = recordingHandler()
    const free = alwaysPaysQuote("test.free")
    const { acpRoutes, saleor } = buildRoutes({
      handlers: [pay.adapter, free.adapter],
      checkouts: [preparedCheckout([{ key: "test.free", value: "null" }])],
      config: { acpEnabled: true },
    })

    const response = await acpCompleteWith(acpRoutes, CHECKOUT_ID, "test.free")

    expect(response.status).toBe(422)
    expect(free.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })
})

async function buildAppRoutes(token: string, channels: string[] | null, adapter: PaymentHandlerAdapter) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({
      data: {
        app: {
          id: "app",
          privateMetadata: [
            { key: "agentic_commerce__store_name", value: "Demo Store" },
            { key: `agentic_commerce__handler__${adapter.id}`, value: JSON.stringify({ enabled: true, channels, config: {} }) },
          ],
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  ))
  const instance = await createAgenticCommerce({
    saleorApiUrl: "https://saleor.test/graphql/",
    saleorAuthToken: token,
    storefrontUrl: STOREFRONT,
    configFromApp: true,
    enabled: true,
    acpEnabled: true,
    paymentHandlerFactory: (ph) => (ph.handlerId === adapter.id ? adapter : null),
  })
  vi.unstubAllGlobals()
  const saleor = fakeSaleor([preparedCheckout()])
  instance.saleorClient = saleor.client as unknown as typeof instance.saleorClient
  instance.agentProfileFetcher = fixedFetcher(PROFILES)
  return { routes: createUcpRoutes(instance), acpRoutes: createAcpRoutes(instance), saleor, instance }
}

describe("Complete on a channel the handler is not enabled for", () => {
  it("UCP refuses to settle when the handler is limited to other channels", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = await buildAppRoutes("token-wholesale-ucp", ["wholesale"], pay.adapter)

    const response = await ucpComplete(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.messages[0].code).toBe("payment_handler_unavailable")
    expect(pay.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("ACP refuses to settle when the handler is enabled for no channel", async () => {
    const pay = recordingHandler()
    const { acpRoutes, saleor } = await buildAppRoutes("token-none-acp", [], pay.adapter)

    const response = await acpComplete(acpRoutes, CHECKOUT_ID)

    expect(response.status).toBe(422)
    expect(pay.settled).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("does not prepare the handler for a checkout on another channel", async () => {
    const pay = recordingHandler()
    const prepare = vi.spyOn(pay.adapter, "prepareCheckoutPayment")
    const { instance } = await buildAppRoutes("token-wholesale-prepare", ["wholesale"], pay.adapter)

    const prepared = await instance.paymentHandlers.prepareCheckoutPayment({
      checkoutId: CHECKOUT_ID,
      channel: "default-channel",
      total: 5497,
      currencyCode: "USD",
      checkoutBaseUrl: UCP_SESSIONS,
      storeName: "Demo Store",
      ucpVersion: "2026-04-08",
    })

    expect(prepare).not.toHaveBeenCalled()
    expect(prepared).toEqual({ "test.pay": null })
  })

  it("completes when the handler is enabled for the checkout channel", async () => {
    const pay = recordingHandler()
    const { routes, saleor } = await buildAppRoutes("token-default-ucp", ["default-channel"], pay.adapter)

    const response = await ucpComplete(routes, CHECKOUT_ID)

    expect(response.status).toBe(200)
    expect(pay.settled).toHaveLength(1)
    expect(pay.settled[0].channel).toBe("default-channel")
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})

describe("The same signed payment on two checkouts", () => {
  const PRISM = "xyz.fd.prism_payment"
  const OTHER_ID = "Q2hlY2tvdXQ6Mg=="
  const QUOTED = {
    scheme: "exact",
    network: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x1111111111111111111111111111111111111111",
    amount: "1000000",
  }

  let gateway: ReturnType<typeof stubPrismGateway>
  afterEach(() => gateway?.restore())

  const settleRequests = () => gateway.requests.filter((r) => r.url.endsWith("/api/v2/payment/settle"))

  function signed(nonce = "0x01", from = "0xbuyer") {
    return {
      type: "x402",
      x402Version: 2,
      accepted: { ...QUOTED, maxTimeoutSeconds: 300 },
      payload: {
        signature: "0xsig",
        authorization: { from, to: QUOTED.payTo, value: QUOTED.amount, validAfter: "0", validBefore: "9999999999", nonce } as Record<string, string>,
      },
    }
  }

  function twoCheckouts() {
    const other = checkoutTemplate()
    other.id = OTHER_ID
    return buildRoutes({ prism: true, checkouts: [checkoutTemplate(), other], config: { acpEnabled: true } })
  }

  function ucpPay(routes: ReturnType<typeof buildRoutes>["routes"], id: string, credential: object) {
    return routes.checkoutSessionComplete.POST(
      ucpRequest(`${UCP_SESSIONS}/${id}/complete`, {
        body: { payment: { instruments: [{ id: "inst_1", handler_id: PRISM, type: "x402", credential }] } },
      }),
      params({ id }),
    )
  }

  function acpPay(acpRoutes: ReturnType<typeof buildRoutes>["acpRoutes"], id: string, credential: object) {
    return acpRoutes.checkoutSessionComplete.POST(
      new Request(`${ACP_SESSIONS}/${id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_data: { handler_id: PRISM, instrument: { credential } } }),
      }),
      params({ id }),
    )
  }

  it("UCP refuses a second checkout paid with an authorization already settled, even when the gateway repeats success", async () => {
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: "0xsame" }) })
    const { routes, saleor } = twoCheckouts()

    const first = await ucpPay(routes, CHECKOUT_ID, signed())
    const second = await ucpPay(routes, OTHER_ID, signed())
    const body = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(body.messages[0].code).toBe("payment_already_used")
    expect(saleor.transactions.map((t) => t.checkoutId)).toEqual([CHECKOUT_ID])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("UCP refuses a second checkout when the gateway returns a transaction already used for another checkout", async () => {
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: "0xsame" }) })
    const { routes, saleor } = twoCheckouts()

    await ucpPay(routes, CHECKOUT_ID, signed("0x01"))
    const second = await ucpPay(routes, OTHER_ID, signed("0x02"))

    expect(second.status).toBe(409)
    expect((await second.json()).messages[0].code).toBe("payment_already_used")
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("ACP refuses a second checkout paid with an authorization already settled", async () => {
    let count = 0
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: `0xtx${++count}` }) })
    const { acpRoutes, saleor } = twoCheckouts()

    const first = await acpPay(acpRoutes, CHECKOUT_ID, signed())
    const second = await acpPay(acpRoutes, OTHER_ID, signed())

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect((await second.json()).code).toBe("payment_already_used")
    expect(saleor.transactions.map((t) => t.checkoutId)).toEqual([CHECKOUT_ID])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("treats an EVM nonce from the same payer in another letter case as the same authorization", async () => {
    let count = 0
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: `0xtx${++count}` }) })
    const { routes, saleor } = twoCheckouts()

    await ucpPay(routes, CHECKOUT_ID, signed("0xabcdef", "0xBuyer"))
    const second = await ucpPay(routes, OTHER_ID, signed("0xABCDEF", "0xbuyer"))

    expect(second.status).toBe(409)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("completes two checkouts paid with different authorizations", async () => {
    let count = 0
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: `0xtx${++count}` }) })
    const { routes, saleor } = twoCheckouts()

    const first = await ucpPay(routes, CHECKOUT_ID, signed("0x01"))
    const second = await ucpPay(routes, OTHER_ID, signed("0x02"))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(saleor.completed).toEqual([CHECKOUT_ID, OTHER_ID])
  })

  it("refuses a credential whose authorization has no nonce", async () => {
    gateway = stubPrismGateway()
    const { routes, saleor } = twoCheckouts()
    const credential = signed()
    delete credential.payload.authorization.nonce

    const response = await ucpPay(routes, CHECKOUT_ID, credential)

    expect(response.status).toBe(422)
    expect(settleRequests()).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it.each([
    ["has no success flag", { transaction: "0xtx" }],
    ["has a success flag that is not true", { success: "true", transaction: "0xtx" }],
    ["has a transaction that is not a string", { success: true, transaction: 12345 }],
  ])("refuses to mark paid when the settle reply %s", async (_case, reply) => {
    gateway = stubPrismGateway({ settle: () => reply })
    const { routes, saleor } = twoCheckouts()

    const response = await ucpPay(routes, CHECKOUT_ID, signed())

    expect(response.status).toBe(422)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it.each([
    ["another network", { success: true, transaction: "0xmoved", network: "eip155:1" }],
    ["another payer", { success: true, transaction: "0xmoved", payer: "0xsomeoneelse" }],
  ])("holds the order and reports the transaction when the gateway settled on %s", async (_case, reply) => {
    gateway = stubPrismGateway({ settle: () => reply })
    const { routes, saleor } = twoCheckouts()

    const response = await ucpPay(routes, CHECKOUT_ID, signed())
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.messages[0].code).toBe("settled_payment_mismatch")
    expect(body.messages[0].content).toContain("0xmoved")
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("ACP refuses a second checkout that names the same handler by its alias", async () => {
    gateway = stubPrismGateway()
    const reused = alwaysPaysQuote("test.reused")
    Object.assign(reused.adapter, { aliases: ["reused-alias"] })
    reused.adapter.settlePayment = async () => ({ success: true, transactionReference: "0xreused", settled: { amount: 5497, currency: "USD" }, replayKeys: [] })
    const prepared = { key: "test.reused", value: JSON.stringify({ prepared: true }) }
    const first = preparedCheckout([prepared])
    const other = preparedCheckout([prepared])
    other.id = OTHER_ID
    const { acpRoutes, saleor } = buildRoutes({ handlers: [reused.adapter], checkouts: [first, other], config: { acpEnabled: true } })

    const ok = await acpCompleteWith(acpRoutes, CHECKOUT_ID, "test.reused")
    const replayed = await acpCompleteWith(acpRoutes, OTHER_ID, "reused-alias")

    expect(ok.status).toBe(200)
    expect(replayed.status).toBe(409)
    expect((await replayed.json()).code).toBe("payment_already_used")
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("holds the order when a handler settles without reporting replay keys", async () => {
    gateway = stubPrismGateway()
    const unchecked = alwaysPaysQuote("test.unchecked")
    unchecked.adapter.settlePayment = async () => ({ success: true, transactionReference: "0xunchecked", settled: { amount: 5497, currency: "USD" } }) as never
    const { routes, saleor } = buildRoutes({ handlers: [unchecked.adapter], checkouts: [preparedCheckout([{ key: "test.unchecked", value: "{}" }])] })

    const response = await ucpCompleteWith(routes, CHECKOUT_ID, "test.unchecked")

    expect(response.status).toBe(409)
    expect((await response.json()).messages[0].code).toBe("settled_payment_unchecked")
    expect(saleor.completed).toHaveLength(0)
  })

  it("completes when the settle reply names the signed network and payer", async () => {
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: "0xtx", network: QUOTED.network, payer: "0xBUYER" }) })
    const { routes, saleor } = twoCheckouts()

    const response = await ucpPay(routes, CHECKOUT_ID, signed())

    expect(response.status).toBe(200)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("refuses a second checkout paid through a handler that reuses a transaction reference", async () => {
    gateway = stubPrismGateway()
    const reused = alwaysPaysQuote("test.reused")
    reused.adapter.settlePayment = async () => ({ success: true, transactionReference: "0xreused", settled: { amount: 5497, currency: "USD" }, replayKeys: [] })
    const prepared = { key: "test.reused", value: JSON.stringify({ prepared: true }) }
    const first = preparedCheckout([prepared])
    const other = preparedCheckout([prepared])
    other.id = OTHER_ID
    const { routes, saleor } = buildRoutes({ handlers: [reused.adapter], checkouts: [first, other] })

    const ok = await ucpCompleteWith(routes, CHECKOUT_ID, "test.reused")
    const replayed = await ucpCompleteWith(routes, OTHER_ID, "test.reused")

    expect(ok.status).toBe(200)
    expect(replayed.status).toBe(409)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})

describe("Payment replay store in production", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("refuses to start in production without a payment replay store", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(() => buildRoutes()).toThrow(/paymentReplayStore/)
  })

  it("starts in production with an explicit payment replay store", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(() => buildRoutes({ config: { paymentReplayStore: createMemoryPaymentReplayStore() } })).not.toThrow()
  })
})
