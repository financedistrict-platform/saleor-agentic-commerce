import { describe, it, expect } from "vitest"
import { PAYMENT_QUOTE_METADATA_KEY, PAYMENT_QUOTE_TTL_MS, quoteForTotal, readPaymentQuote, reconcilePayment } from "./payment-reconciliation.js"

const NOW = new Date("2026-10-09T10:00:00.000Z")
const total = { amount: 54.97, currency: "USD" }
const quoteAt = (offsetMs: number) => ({ amount: 5497, currency: "USD", quotedAt: new Date(NOW.getTime() - offsetMs).toISOString() })

describe("quoteForTotal", () => {
  it("stamps the quote with the time it was made", () => {
    const quoted = quoteForTotal(total, NOW)

    expect(quoted).toEqual({ ok: true, quote: { amount: 5497, currency: "USD", quotedAt: NOW.toISOString() } })
  })
})

describe("readPaymentQuote", () => {
  it("reads a quote with a timestamp", () => {
    expect(readPaymentQuote({ [PAYMENT_QUOTE_METADATA_KEY]: quoteAt(0) })).toEqual(quoteAt(0))
  })

  it.each([
    ["no timestamp", { amount: 5497, currency: "USD" }],
    ["an unparseable timestamp", { amount: 5497, currency: "USD", quotedAt: "soon" }],
    ["a numeric timestamp", { amount: 5497, currency: "USD", quotedAt: 1760000000000 }],
    ["an empty timestamp", { amount: 5497, currency: "USD", quotedAt: "" }],
  ])("returns null for a quote with %s", (_label, value) => {
    expect(readPaymentQuote({ [PAYMENT_QUOTE_METADATA_KEY]: value })).toBeNull()
  })
})

describe("reconcilePayment quote lifetime", () => {
  it("accepts a quote just inside its lifetime", () => {
    const result = reconcilePayment({ quote: quoteAt(PAYMENT_QUOTE_TTL_MS - 1), total, now: NOW })

    expect(result.ok).toBe(true)
  })

  it("accepts a quote exactly at its lifetime", () => {
    expect(reconcilePayment({ quote: quoteAt(PAYMENT_QUOTE_TTL_MS), total, now: NOW }).ok).toBe(true)
  })

  it("rejects a quote past its lifetime before any settlement", () => {
    const result = reconcilePayment({ quote: quoteAt(PAYMENT_QUOTE_TTL_MS + 1), total, now: NOW })

    expect(result).toMatchObject({ ok: false, code: "payment_quote_expired" })
  })

  it("does not expire a quote once the payment has settled", () => {
    const result = reconcilePayment({
      quote: quoteAt(PAYMENT_QUOTE_TTL_MS * 10),
      total,
      settled: { amount: 5497, currency: "USD" },
      now: NOW,
    })

    expect(result.ok).toBe(true)
  })

  it("still rejects a settled amount that differs from the total", () => {
    const result = reconcilePayment({
      quote: quoteAt(PAYMENT_QUOTE_TTL_MS * 10),
      total,
      settled: { amount: 100, currency: "USD" },
      now: NOW,
    })

    expect(result).toMatchObject({ ok: false, code: "order_total_changed_after_settlement" })
  })

  it("rejects a missing quote", () => {
    expect(reconcilePayment({ quote: null, total, now: NOW })).toMatchObject({ ok: false, code: "payment_quote_missing" })
  })
})
