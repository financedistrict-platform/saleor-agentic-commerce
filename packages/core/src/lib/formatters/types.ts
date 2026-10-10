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
