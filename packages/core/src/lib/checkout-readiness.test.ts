import { describe, it, expect, vi } from "vitest"
import {
  classifyCompleteErrors,
  evaluateReadiness,
  PAYMENT_PENDING_CODE,
} from "./checkout-readiness.js"

// Minimal SaleorCheckout stub — only the fields evaluateReadiness reads.
function checkout(over: Partial<any> = {}): any {
  return {
    id: "Q2hlY2tvdXQ6MQ==",
    lines: [{ id: "l1" }],
    totalPrice: { gross: { amount: 600, currency: "USD" } },
    transactions: [],
    ...over,
  }
}

describe("classifyCompleteErrors — Saleor is the authority, we only translate", () => {
  it("no errors => ready_for_complete", () => {
    const r = classifyCompleteErrors([])
    expect(r).toEqual({ status: "ready_for_complete", ready: true, messages: [] })
  })

  it("only CHECKOUT_NOT_FULLY_PAID => ready (payment is the sole remaining need)", () => {
    const r = classifyCompleteErrors([{ code: PAYMENT_PENDING_CODE, field: null, message: "not paid" }])
    expect(r.ready).toBe(true)
    expect(r.status).toBe("ready_for_complete")
    expect(r.messages).toHaveLength(0)
  })

  it("a real validation error => incomplete + one message, Saleor's code & wording verbatim", () => {
    const r = classifyCompleteErrors([
      { code: "SHIPPING_METHOD_NOT_SET", field: "shippingMethod", message: "Shipping method is not set" },
    ])
    expect(r.ready).toBe(false)
    expect(r.status).toBe("incomplete")
    expect(r.messages).toEqual([
      {
        type: "error",
        code: "SHIPPING_METHOD_NOT_SET", // verbatim from Saleor, not rewritten
        content: "Shipping method is not set", // verbatim
        severity: "recoverable", // UCP-semantic: mapped, not passed through
      },
    ])
  })

  it("mixed errors => payment complaint dropped, real one surfaced", () => {
    const r = classifyCompleteErrors([
      { code: "SHIPPING_METHOD_NOT_SET", field: "shippingMethod", message: "Shipping method is not set" },
      { code: PAYMENT_PENDING_CODE, field: null, message: "not paid" },
    ])
    expect(r.ready).toBe(false)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0].code).toBe("SHIPPING_METHOD_NOT_SET")
  })

  it("non-array errors => treated as none => ready", () => {
    expect(classifyCompleteErrors(undefined).ready).toBe(true)
  })
})

describe("evaluateReadiness — probes Saleor, guarded", () => {
  it("checkout with a transaction is past readiness => complete_in_progress, no probe", async () => {
    const complete = vi.fn()
    const saleor = { completeCheckout: complete } as any
    const r = await evaluateReadiness(saleor, checkout({ transactions: [{ pspReference: "x" }] }))
    expect(r.status).toBe("complete_in_progress")
    expect(r.ready).toBe(false)
    expect(complete).not.toHaveBeenCalled() // never risk a real completion
  })

  it("zero-total checkout => ready on line presence, no probe", async () => {
    const complete = vi.fn()
    const saleor = { completeCheckout: complete } as any
    const r = await evaluateReadiness(saleor, checkout({ totalPrice: { gross: { amount: 0, currency: "USD" } } }))
    expect(r.ready).toBe(true)
    expect(complete).not.toHaveBeenCalled()
  })

  it("unpaid non-zero: Saleor says only-payment-missing => ready", async () => {
    const saleor = {
      completeCheckout: vi.fn().mockResolvedValue({ ok: false, error: "not paid", errors: [{ code: PAYMENT_PENDING_CODE }] }),
    } as any
    const r = await evaluateReadiness(saleor, checkout())
    expect(r.ready).toBe(true)
    expect(r.status).toBe("ready_for_complete")
  })

  it("unpaid non-zero: Saleor rejects with a real reason => incomplete + verbatim message", async () => {
    const saleor = {
      completeCheckout: vi.fn().mockResolvedValue({
        ok: false,
        error: "Shipping method is not set",
        errors: [{ code: "SHIPPING_METHOD_NOT_SET", field: "shippingMethod", message: "Shipping method is not set" }],
      }),
    } as any
    const r = await evaluateReadiness(saleor, checkout())
    expect(r.ready).toBe(false)
    expect(r.status).toBe("incomplete")
    expect(r.messages[0].content).toBe("Shipping method is not set")
  })
})
