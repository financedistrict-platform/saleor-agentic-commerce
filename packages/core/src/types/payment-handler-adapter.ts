/**
 * Payment Handler Adapter Interface
 *
 * Implement this interface to add a new payment handler to the agentic commerce
 * extension. Each adapter provides discovery, checkout preparation, settlement,
 * and response formatting for a specific payment provider (e.g., Prism x402,
 * Stripe, Coinbase, etc.)
 *
 * Example implementation:
 * ```ts
 * import type { PaymentHandlerAdapter } from "@financedistrict/saleor-agentic-commerce-core"
 *
 * class StripePaymentHandler implements PaymentHandlerAdapter {
 *   readonly id = "com.stripe.payment"
 *   readonly name = "Stripe"
 *   // ... implement all methods
 * }
 * ```
 *
 * Register your adapter in the createAgenticCommerce() config:
 * ```ts
 * createAgenticCommerce({
 *   paymentHandlers: [new StripePaymentHandler({ ... })],
 * })
 * ```
 */

// =====================================================
// Adapter Interface
// =====================================================

export interface PaymentHandlerAdapter {
  /** Unique identifier for this adapter (reverse-domain, e.g., "xyz.fd.prism_payment") */
  readonly id: string

  /** Human-readable name (e.g., "Finance District Prism") */
  readonly name: string

  /**
   * Return UCP discovery handler entries for .well-known/ucp.
   * Keyed by handler namespace (e.g., "xyz.fd.prism_payment").
   * Return empty object if nothing to advertise.
   */
  getUcpDiscoveryHandlers(): Promise<Record<string, unknown[]>>

  /**
   * Return ACP discovery handler entries.
   * Flat array of handler objects for capabilities.payment.handlers.
   * Return empty array if nothing to advertise.
   */
  getAcpDiscoveryHandlers(): Promise<unknown[]>

  /**
   * Prepare payment requirements for a checkout session.
   *
   * Called when a checkout session is created or updated (total changes).
   * The adapter should:
   * 1. Call its payment gateway to get payment requirements
   * 2. Return the result (core will store it on Saleor checkout metadata)
   *
   * The adapter is responsible for idempotency — return cached result
   * if already prepared for the same checkout total.
   */
  prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<unknown | null>

  /**
   * Settle payment using the agent's submitted credential.
   *
   * Called when an agent completes checkout with a payment credential
   * for this handler. The adapter should submit the credential to its
   * payment provider for processing/settlement.
   */
  settlePayment(input: PaymentSettleInput): Promise<PaymentSettleResult>

  /**
   * Return UCP payment_handlers block for a checkout session response.
   * Reads stored data from checkout metadata.
   * Return empty object if no data available.
   */
  getUcpCheckoutHandlers(checkoutMetadata?: Record<string, unknown>): Record<string, unknown[]>

  /**
   * Return ACP payment handlers array for a checkout session response.
   * Reads stored data from checkout metadata.
   * Return empty array if no data available.
   */
  getAcpCheckoutHandlers(checkoutMetadata?: Record<string, unknown>): unknown[]
}

// =====================================================
// Input / Output Types
// =====================================================

export type CheckoutPrepareInput = {
  /** Saleor checkout ID */
  checkoutId: string
  /** Total amount in minor units (cents) */
  total: number
  /** ISO 4217 currency code (e.g., "USD", "EUR") */
  currencyCode: string
  /** Base URL for checkout session resources */
  checkoutBaseUrl: string
  /** Human-readable store name for payment descriptions */
  storeName: string
  /** Existing checkout metadata (for idempotency checks) */
  checkoutMetadata?: Record<string, unknown>
}

export type PaymentSettleInput = {
  /** Saleor checkout ID */
  checkoutId: string
  /** The handler ID that the agent selected */
  handlerId: string
  /** Handler-specific payment credential submitted by the agent */
  credential: unknown
  /** Checkout metadata (may contain handler-specific state) */
  checkoutMetadata?: Record<string, unknown>
}

export type PaymentSettleResult = {
  success: boolean
  /** Transaction reference (e.g., blockchain tx hash) */
  transactionReference?: string
  /** Error message on failure */
  error?: string
}
