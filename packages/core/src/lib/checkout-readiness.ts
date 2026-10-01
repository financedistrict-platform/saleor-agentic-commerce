/**
 * Readiness is decided by Saleor, not by rules here. We probe `checkoutComplete`
 * on the still-unpaid checkout: Saleor runs its full validation and either
 * rejects with the real reason(s), or — once everything but payment is
 * satisfied — with only CHECKOUT_NOT_FULLY_PAID. The latter is the one signal
 * that means "ready to settle". Because the checkout is unpaid, the probe never
 * places an order. Whatever Saleor complains about is passed back verbatim.
 */

import type { SaleorClient } from "./saleor-client.js"
import type { SaleorCheckout } from "../types/saleor.js"
import type { UcpCheckoutStatus, UcpMessage } from "../types/ucp.js"

export const PAYMENT_PENDING_CODE = "CHECKOUT_NOT_FULLY_PAID"

type SaleorCompleteError = {
  field?: string | null
  message?: string | null
  code?: string | null
}

export type CheckoutReadiness = {
  status: UcpCheckoutStatus
  /** true iff the only outstanding requirement is payment. */
  ready: boolean
  messages: UcpMessage[]
}

export function classifyCompleteErrors(errors: unknown): CheckoutReadiness {
  const arr: SaleorCompleteError[] = Array.isArray(errors)
    ? (errors as SaleorCompleteError[])
    : []

  const blocking = arr.filter((e) => e?.code !== PAYMENT_PENDING_CODE)
  if (blocking.length === 0) {
    return { status: "ready_for_complete", ready: true, messages: [] }
  }

  // code/content are open-vocab, so the engine's are passed through verbatim.
  // severity is UCP-semantic: these are all fixable via Update Checkout, i.e.
  // recoverable. path is omitted rather than emit the engine's flat field name,
  // which is not the RFC 9535 JSONPath the schema requires.
  const messages: UcpMessage[] = blocking.map((e) => ({
    type: "error" as const,
    code: e?.code ?? "checkout_not_ready",
    content: e?.message ?? "Checkout is not ready to complete",
    severity: "recoverable" as const,
  }))
  return { status: "incomplete", ready: false, messages }
}

export async function evaluateReadiness(
  saleor: SaleorClient,
  checkout: SaleorCheckout,
): Promise<CheckoutReadiness> {
  // A transaction already present means settlement is underway or done; a probe
  // here would drive a real completion.
  if (checkout.transactions && checkout.transactions.length > 0) {
    return { status: "complete_in_progress", ready: false, messages: [] }
  }

  // Zero-total needs no payment, so the payment-pending signal never appears and
  // a probe could place the order.
  if (checkout.totalPrice.gross.amount <= 0) {
    const hasLines = checkout.lines.length > 0
    return {
      status: hasLines ? "ready_for_complete" : "incomplete",
      ready: hasLines,
      messages: [],
    }
  }

  const result = await saleor.completeCheckout(checkout.id)
  if (result.ok) {
    return { status: "completed", ready: false, messages: [] }
  }
  return classifyCompleteErrors(result.errors)
}
