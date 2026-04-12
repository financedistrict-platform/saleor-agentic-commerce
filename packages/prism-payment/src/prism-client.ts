/**
 * Prism Gateway API Client
 *
 * Handles the merchant-side Prism integration:
 * - payment-profile: Fetch handler definition for UCP discovery
 * - checkout-prepare: Get x402 payment requirements for a checkout
 * - settle: Submit signed ERC-3009 credential for on-chain settlement
 */

// =====================================================
// Types
// =====================================================

export type CheckoutPrepareInput = {
  /** Amount in minor units (cents) */
  amount: number
  /** ISO 4217 currency code */
  currency: string
  /** Unique URL for this checkout session (x402 resource binding) */
  resourceUrl: string
  /** Human-readable description */
  resourceDescription?: string
}

export type CheckoutPrepareResult = {
  id: string
  version: string
  config: {
    x402Version: number
    resource: {
      url: string
      description: string
    }
    accepts: X402AcceptEntry[]
  }
}

export type X402AcceptEntry = {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: Record<string, unknown>
}

export type PaymentProfileResult = {
  [namespace: string]: unknown[]
}

export type SettleInput = {
  paymentPayload: unknown
  paymentRequirements: unknown
}

export type SettleResult = {
  success: boolean
  transactionHash?: string
  error?: string
}

// =====================================================
// Client
// =====================================================

export type PrismClientOptions = {
  apiUrl?: string
  apiKey?: string
}

export class PrismClient {
  private apiUrl: string
  private apiKey: string

  constructor(options: PrismClientOptions = {}) {
    this.apiUrl = options.apiUrl || process.env.PRISM_API_URL || "https://prism-gw.fd.xyz"
    this.apiKey = options.apiKey || process.env.PRISM_API_KEY || ""
  }

  async checkoutPrepare(input: CheckoutPrepareInput): Promise<CheckoutPrepareResult> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty config")
      return this.emptyConfig(input)
    }

    const response = await fetch(`${this.apiUrl}/api/v2/merchant/checkout-prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        amount: String(input.amount),
        currency: input.currency.toUpperCase(),
        resource: {
          url: input.resourceUrl,
          ...(input.resourceDescription ? { description: input.resourceDescription } : {}),
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`Prism checkout-prepare failed: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const PRISM_NAMESPACE = "xyz.fd.prism_payment"
    const handlers = (data[PRISM_NAMESPACE] ?? Object.values(data)[0]) as CheckoutPrepareResult[] | undefined

    if (!handlers || !Array.isArray(handlers) || handlers.length === 0) {
      console.warn("[prism-client] checkout-prepare returned no handlers")
      return this.emptyConfig(input)
    }

    return handlers[0]
  }

  async fetchPaymentProfile(): Promise<PaymentProfileResult> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty profile")
      return {}
    }

    const response = await fetch(`${this.apiUrl}/api/v2/merchant/payment-profile`, {
      method: "GET",
      headers: { "X-API-Key": this.apiKey },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`Prism payment-profile failed: ${response.status} ${errorText}`)
    }

    return response.json() as Promise<PaymentProfileResult>
  }

  async settle(input: SettleInput): Promise<SettleResult> {
    if (!this.apiKey) {
      return { success: false, error: "No PRISM_API_KEY configured" }
    }

    const response = await fetch(`${this.apiUrl}/api/v2/payment/settle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      return { success: false, error: `Settlement failed: ${response.status} ${errorText}` }
    }

    const data = (await response.json()) as Record<string, unknown>
    return {
      success: data.success !== false,
      transactionHash: (data.transaction ?? data.transactionHash) as string | undefined,
      error: data.errorReason as string | undefined,
    }
  }

  private emptyConfig(input: CheckoutPrepareInput): CheckoutPrepareResult {
    return {
      id: "prism_default",
      version: "2026-01-23",
      config: {
        x402Version: 2,
        resource: {
          url: input.resourceUrl,
          description: input.resourceDescription || "",
        },
        accepts: [],
      },
    }
  }
}
