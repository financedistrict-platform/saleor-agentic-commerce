/**
 * Prism Payment Handler Adapter
 *
 * Implements the PaymentHandlerAdapter interface from
 * @financedistrict/saleor-agentic-commerce-core.
 *
 * Provides x402 stablecoin payment support via the Prism Gateway:
 * - Discovery: advertises xyz.fd.prism_payment in .well-known/ucp
 * - Checkout preparation: calls Prism checkout-prepare for x402 requirements
 * - Settlement: submits signed ERC-3009 credential to Prism for on-chain transfer
 * - Response formatting: includes Prism payment config in checkout session responses
 */

import type {
  PaymentHandlerAdapter,
  CheckoutPrepareInput,
  PaymentSettleInput,
  PaymentSettleResult,
} from "@financedistrict/saleor-agentic-commerce-core"
import { PrismClient, type CheckoutPrepareResult } from "./prism-client.js"

// =====================================================
// Constants
// =====================================================

export const PRISM_HANDLER_ID = "xyz.fd.prism_payment"
export const PRISM_CHECKOUT_CONFIG_KEY = "prism_checkout_config"

// =====================================================
// Options
// =====================================================

export type PrismPaymentHandlerOptions = {
  /** Prism Gateway API base URL (default: https://prism-gw.fd.xyz) */
  apiUrl?: string
  /** Prism Gateway API key for merchant authentication */
  apiKey?: string
}

// =====================================================
// Handler
// =====================================================

export class PrismPaymentHandler implements PaymentHandlerAdapter {
  readonly id = PRISM_HANDLER_ID
  readonly name = "Finance District Prism"

  private client: PrismClient
  private readonly apiUrl: string

  /** Cached Prism payment-profile for discovery (5 min TTL) */
  private profileCache: { data: Record<string, unknown[]>; expiry: number } | null = null
  private readonly PROFILE_TTL = 5 * 60 * 1000

  constructor(options: PrismPaymentHandlerOptions = {}) {
    // Resolve once and store — needed to construct ACP/UCP spec URLs that
    // point at gateway-hosted documents (`{apiUrl}/acp/spec.md`,
    // `{apiUrl}/ucp/schema.json`, …). See Prism gateway impl in
    // fd-prism-platform/src/api/Prism.Platform.Api.Gateway/Features/{Acp,Ucp}/.
    this.apiUrl = options.apiUrl || process.env.PRISM_API_URL || "https://prism-gw.fd.xyz"
    this.client = new PrismClient({
      apiUrl: this.apiUrl,
      apiKey: options.apiKey,
    })
  }

  // -------------------------------------------------
  // Discovery
  // -------------------------------------------------

  async getUcpDiscoveryHandlers(): Promise<Record<string, unknown[]>> {
    return this.fetchProfile()
  }

  async getAcpDiscoveryHandlers(): Promise<unknown[]> {
    const profile = await this.fetchProfile()
    const handlers: unknown[] = []

    // Per ACP 2026-04-17 PaymentHandler schema:
    //   - `id` is the seller-defined INSTANCE identifier (Prism uses "x402")
    //   - `name` is the reverse-DNS handler-TYPE identifier (the namespace key
    //     in Prism's payment-profile response)
    // We previously had these reversed, which is harmless when there's only
    // one Prism handler but breaks ACP semantics for any consumer relying on
    // them. Spec URLs now point at gateway-hosted docs (Prism gateway serves
    // /acp/spec.md, /acp/config_schema.json, /acp/instrument_schema.json),
    // not the placeholder fd.xyz URLs that never resolved. Long-term, fold
    // this whole block away by calling Prism's discovery endpoint once it
    // exists — see fd-prism-platform issue #22.
    for (const [namespace, entries] of Object.entries(profile)) {
      for (const entry of entries as any[]) {
        handlers.push({
          id: entry.id || "x402",
          name: namespace,
          version: entry.version || "2026-01-15",
          spec: `${this.apiUrl}/acp/spec.md`,
          requires_delegate_payment: false,
          requires_pci_compliance: false,
          psp: "prism",
          config_schema: `${this.apiUrl}/acp/config_schema.json`,
          instrument_schemas: [`${this.apiUrl}/acp/instrument_schema.json`],
          config: entry.config || {},
        })
      }
    }

    return handlers
  }

  // -------------------------------------------------
  // Checkout preparation
  // -------------------------------------------------

  async prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<CheckoutPrepareResult | null> {
    const { checkoutId, total, currencyCode, checkoutBaseUrl, storeName, checkoutMetadata } = input
    const resourceUrl = `${checkoutBaseUrl}/${checkoutId}`

    // Idempotency — skip if already prepared for this exact total
    const existingConfig = checkoutMetadata?.[PRISM_CHECKOUT_CONFIG_KEY] as any
    if (existingConfig?.config?.resource?.url === resourceUrl) {
      const existingAmount = existingConfig._prepared_amount
      if (existingAmount === total) {
        return existingConfig as CheckoutPrepareResult
      }
    }

    let prepareResult: CheckoutPrepareResult
    try {
      prepareResult = await this.client.checkoutPrepare({
        amount: total,
        currency: currencyCode,
        resourceUrl,
        resourceDescription: `Purchase from ${storeName}`,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      console.error(`[prism-handler] checkout-prepare failed for ${checkoutId}: ${message}`)
      return null
    }

    // Return with prepared amount for idempotency tracking
    // The core will store this on Saleor checkout metadata
    return {
      ...prepareResult,
      _prepared_amount: total,
    } as CheckoutPrepareResult
  }

  // -------------------------------------------------
  // Settlement
  // -------------------------------------------------

  async settlePayment(input: PaymentSettleInput): Promise<PaymentSettleResult> {
    const { credential, checkoutMetadata } = input

    // Get the stored payment requirements from checkout metadata
    const config = (checkoutMetadata?.[PRISM_HANDLER_ID] ?? checkoutMetadata?.[PRISM_CHECKOUT_CONFIG_KEY]) as any
    if (!config?.config) {
      return { success: false, error: "No Prism payment config found on checkout" }
    }

    try {
      const result = await this.client.settle({
        paymentPayload: credential,
        paymentRequirements: config.config,
      })

      if (!result.success) {
        return { success: false, error: result.error }
      }

      return {
        success: true,
        transactionReference: result.transactionHash,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return { success: false, error: `Prism settlement failed: ${message}` }
    }
  }

  // -------------------------------------------------
  // Response formatting
  // -------------------------------------------------

  getUcpCheckoutHandlers(checkoutMetadata?: Record<string, unknown>): Record<string, unknown[]> {
    const config = (checkoutMetadata?.[PRISM_HANDLER_ID] ?? checkoutMetadata?.[PRISM_CHECKOUT_CONFIG_KEY]) as any
    if (!config?.config) return {}

    return {
      [PRISM_HANDLER_ID]: [{
        id: config.id || "x402",
        version: config.version || "2026-01-15",
        config: config.config,
      }],
    }
  }

  getAcpCheckoutHandlers(checkoutMetadata?: Record<string, unknown>): unknown[] {
    const config = (checkoutMetadata?.[PRISM_HANDLER_ID] ?? checkoutMetadata?.[PRISM_CHECKOUT_CONFIG_KEY]) as any
    if (!config?.config) return []

    // See note in getAcpDiscoveryHandlers re: id/name semantics + spec URLs.
    return [{
      id: config.id || "x402",
      name: PRISM_HANDLER_ID,
      version: config.version || "2026-01-15",
      spec: `${this.apiUrl}/acp/spec.md`,
      requires_delegate_payment: false,
      requires_pci_compliance: false,
      psp: "prism",
      config_schema: `${this.apiUrl}/acp/config_schema.json`,
      instrument_schemas: [`${this.apiUrl}/acp/instrument_schema.json`],
      config: config.config,
    }]
  }

  // -------------------------------------------------
  // Internal
  // -------------------------------------------------

  private async fetchProfile(): Promise<Record<string, unknown[]>> {
    const now = Date.now()
    if (this.profileCache && now < this.profileCache.expiry) {
      return this.profileCache.data
    }

    try {
      const data = await this.client.fetchPaymentProfile()
      this.profileCache = { data, expiry: now + this.PROFILE_TTL }
      return data
    } catch {
      return this.profileCache?.data || {}
    }
  }
}
