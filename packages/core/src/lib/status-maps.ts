/**
 * Status mapping between Saleor checkout/order states and protocol states.
 *
 * Saleor doesn't have an explicit checkout status field — the status is
 * inferred from what data is present on the checkout object.
 */

import type { SaleorCheckout, SaleorOrder } from "../types/saleor.js"
import type { UcpCheckoutStatus } from "../types/ucp.js"
import type { AcpCheckoutStatus } from "../types/acp.js"

/**
 * Resolve UCP checkout status from a Saleor checkout.
 *
 * UCP statuses: "incomplete" | "requires_escalation" | "ready_for_complete"
 *             | "complete_in_progress" | "completed" | "canceled"
 */
export function resolveUcpCheckoutStatus(checkout: SaleorCheckout): UcpCheckoutStatus {
  const hasEmail = !!checkout.email
  const hasShippingAddress = !!checkout.shippingAddress
  const hasDeliveryMethod = !!checkout.deliveryMethod
  const hasLines = checkout.lines.length > 0

  if (!hasLines) return "incomplete"
  if (!hasEmail || !hasShippingAddress) return "incomplete"
  if (!hasDeliveryMethod) return "incomplete"

  return "ready_for_complete"
}

/**
 * Resolve ACP checkout status from a Saleor checkout.
 *
 * ACP statuses: "not_ready_for_payment" | "ready_for_payment" | "in_progress" | "completed" | "canceled"
 */
export function resolveAcpCheckoutStatus(checkout: SaleorCheckout): AcpCheckoutStatus {
  const hasEmail = !!checkout.email
  const hasShippingAddress = !!checkout.shippingAddress
  const hasDeliveryMethod = !!checkout.deliveryMethod
  const hasLines = checkout.lines.length > 0

  if (!hasLines) return "not_ready_for_payment"
  if (!hasEmail || !hasShippingAddress) return "not_ready_for_payment"
  if (!hasDeliveryMethod) return "not_ready_for_payment"

  return "ready_for_payment"
}

/**
 * Map Saleor order status to a normalized string.
 *
 * Saleor order statuses: DRAFT, UNCONFIRMED, UNFULFILLED, PARTIALLY_FULFILLED,
 *                        FULFILLED, PARTIALLY_RETURNED, RETURNED, CANCELED, EXPIRED
 */
export function normalizeOrderStatus(status: string): string {
  const statusMap: Record<string, string> = {
    DRAFT: "pending",
    UNCONFIRMED: "pending",
    UNFULFILLED: "confirmed",
    PARTIALLY_FULFILLED: "partially_shipped",
    FULFILLED: "shipped",
    PARTIALLY_RETURNED: "partially_returned",
    RETURNED: "returned",
    CANCELED: "canceled",
    EXPIRED: "expired",
  }

  return statusMap[status] || status.toLowerCase()
}
