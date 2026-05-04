import { describe, it, expect } from "vitest"
import {
  resolveUcpCheckoutStatus,
  resolveAcpCheckoutStatus,
  normalizeOrderStatus,
} from "./status-maps.js"
import type { SaleorCheckout } from "../types/saleor.js"

function makeCheckout(overrides: Partial<SaleorCheckout> = {}): SaleorCheckout {
  return {
    id: "chk_1",
    token: "tok_1",
    email: "agent@example.com",
    channel: { slug: "default-channel" },
    totalPrice: { gross: { amount: 0, currency: "USD" }, net: { amount: 0, currency: "USD" }, tax: { amount: 0, currency: "USD" } },
    subtotalPrice: { gross: { amount: 0, currency: "USD" }, net: { amount: 0, currency: "USD" }, tax: { amount: 0, currency: "USD" } },
    shippingPrice: { gross: { amount: 0, currency: "USD" }, net: { amount: 0, currency: "USD" }, tax: { amount: 0, currency: "USD" } },
    discount: null,
    lines: [{ id: "line_1", quantity: 1 } as never],
    shippingAddress: { firstName: "A" } as never,
    billingAddress: null,
    shippingMethods: [],
    deliveryMethod: { id: "dm_1" } as never,
    metadata: [],
    privateMetadata: [],
    ...overrides,
  }
}

describe("resolveUcpCheckoutStatus", () => {
  it("returns ready_for_complete when email, shipping address, delivery method, and lines are all set", () => {
    expect(resolveUcpCheckoutStatus(makeCheckout())).toBe("ready_for_complete")
  })

  it("returns incomplete when there are no lines", () => {
    expect(resolveUcpCheckoutStatus(makeCheckout({ lines: [] }))).toBe("incomplete")
  })

  it("returns incomplete when email is missing", () => {
    expect(resolveUcpCheckoutStatus(makeCheckout({ email: null }))).toBe("incomplete")
  })

  it("returns incomplete when shipping address is missing", () => {
    expect(resolveUcpCheckoutStatus(makeCheckout({ shippingAddress: null }))).toBe("incomplete")
  })

  it("returns incomplete when delivery method is missing", () => {
    expect(resolveUcpCheckoutStatus(makeCheckout({ deliveryMethod: null }))).toBe("incomplete")
  })
})

describe("resolveAcpCheckoutStatus", () => {
  it("returns ready_for_payment for a fully populated checkout", () => {
    expect(resolveAcpCheckoutStatus(makeCheckout())).toBe("ready_for_payment")
  })

  it("returns not_ready_for_payment when delivery method is missing", () => {
    expect(resolveAcpCheckoutStatus(makeCheckout({ deliveryMethod: null }))).toBe("not_ready_for_payment")
  })

  it("returns not_ready_for_payment when there are no lines", () => {
    expect(resolveAcpCheckoutStatus(makeCheckout({ lines: [] }))).toBe("not_ready_for_payment")
  })
})

describe("normalizeOrderStatus", () => {
  it.each([
    ["DRAFT", "pending"],
    ["UNCONFIRMED", "pending"],
    ["UNFULFILLED", "confirmed"],
    ["PARTIALLY_FULFILLED", "partially_shipped"],
    ["FULFILLED", "shipped"],
    ["PARTIALLY_RETURNED", "partially_returned"],
    ["RETURNED", "returned"],
    ["CANCELED", "canceled"],
    ["EXPIRED", "expired"],
  ])("maps Saleor status %s to %s", (input, expected) => {
    expect(normalizeOrderStatus(input)).toBe(expected)
  })

  it("falls back to lowercased input for unknown statuses", () => {
    expect(normalizeOrderStatus("SOMETHING_WEIRD")).toBe("something_weird")
  })
})
