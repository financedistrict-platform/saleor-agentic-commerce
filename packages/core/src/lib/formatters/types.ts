/**
 * Shared types for protocol formatters.
 *
 * Formatters transform Saleor internal objects (checkouts, orders)
 * into ACP or UCP protocol-compliant response shapes.
 */

import type { PaymentHandlerRegistry } from "../payment-handler-registry.js"

/** Configuration context passed to all formatters */
export type FormatterContext = {
  storeName: string
  storefrontUrl: string
  ucpVersion: string
  acpVersion: string
  paymentHandlers: PaymentHandlerRegistry
}

/**
 * Convert Saleor amount to minor units (cents).
 * Saleor returns amounts as decimals (e.g., 12.50 for $12.50).
 */
export function toMinor(amount: number): number {
  return Math.round(amount * 100)
}
