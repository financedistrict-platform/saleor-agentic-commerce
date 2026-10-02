/**
 * Prism Gateway API Client
 *
 * Handles the merchant-side Prism integration using protocol-specific
 * endpoints (separate UCP and ACP variants — the older generic
 * `payment-profile` and `checkout-prepare` endpoints are deprecated).
 *
 * Endpoints used:
 * - GET  /api/v2/merchant/ucp/handlers              — UCP discovery
 * - GET  /api/v2/merchant/acp/handlers              — ACP discovery
 * - POST /api/v2/merchant/ucp/payment-requirements  — UCP checkout prepare
 * - POST /api/v2/merchant/acp/payment-requirements  — ACP checkout prepare
 * - POST /api/v2/payment/settle                     — settlement (shared)
 *
 * See https://prism-gw.test.1stdigital.tech/swagger/index.html for the
 * full OpenAPI spec.
 */

const UCP_DATE_VERSION = /^\d{4}-\d{2}-\d{2}$/

function prismUserAgent(ucpVersion: string): string {
  if (typeof ucpVersion !== "string" || !UCP_DATE_VERSION.test(ucpVersion)) {
    throw new Error(
      `Invalid UCP version ${JSON.stringify(ucpVersion)} for the Prism User-Agent; upgrade @financedistrict/saleor-agentic-commerce-core together with @financedistrict/saleor-prism-payment`,
    )
  }
  return `fd-saleor-prism/${ucpVersion}`
}

const PRISM_UCP_HANDLER_ID = "xyz.fd.prism_payment"
const PRISM_UCP_HANDLER_IDS: readonly unknown[] = [PRISM_UCP_HANDLER_ID, "x402"]

// =====================================================
// Shared payment-requirements input
// =====================================================

export type PreparePaymentInput = {
  ucpVersion: string
  /** Amount in the currency's minor units (e.g. cents for USD, no fractional units for JPY) */
  amount: number
  /** ISO 4217 currency code */
  currency: string
  /** Unique URL for this checkout session (x402 resource binding) */
  resourceUrl: string
  /** Human-readable description */
  resourceDescription?: string
}

/**
 * Convert a minor-unit integer amount to the decimal-major-unit string that
 * Prism's `/payment-requirements` endpoint expects (e.g. 11480 USD cents
 * → "114.80", 100 JPY → "100"). Exponent is derived from the ISO 4217
 * currency code via Intl, with a USD fallback if the runtime can't resolve
 * the currency.
 */
export function minorUnitsToDecimalString(amount: number, currency: string): string {
  const exponent = currencyExponent(currency)
  if (exponent === 0) return String(amount)
  const negative = amount < 0
  const abs = Math.abs(amount).toString().padStart(exponent + 1, "0")
  const whole = abs.slice(0, -exponent)
  const frac = abs.slice(-exponent)
  return `${negative ? "-" : ""}${whole}.${frac}`
}

function currencyExponent(currency: string): number {
  try {
    const fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    })
    return fmt.resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

// =====================================================
// UCP shapes (per Prism OpenAPI)
// =====================================================

/** A single UCP discovery entry — `/ucp/handlers` returns these keyed by namespace */
export type UcpHandlerDiscoveryEntry = {
  id: string
  version: string
  spec: string
  schema: string
  available_instruments?: { type: string }[]
  config_schema?: string
  instrument_schemas?: string[]
  config: unknown
}

/** UCP discovery response: `{ "xyz.fd.prism_payment": [...] }` */
export type UcpHandlersDiscoveryResponse = Record<string, UcpHandlerDiscoveryEntry[]>

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function canonicalUcpHandlerEntry(entry: unknown): UcpHandlerDiscoveryEntry | null {
  if (typeof entry !== "object" || entry === null) return null
  const raw = entry as Record<string, unknown>
  const schema = nonEmptyString(raw.schema) ? raw.schema : raw.config_schema
  if (!PRISM_UCP_HANDLER_IDS.includes(raw.id)) return null
  if (!nonEmptyString(raw.version) || !nonEmptyString(raw.spec) || !nonEmptyString(schema)) return null
  if (raw.available_instruments !== undefined && !Array.isArray(raw.available_instruments)) return null
  if (raw.instrument_schemas !== undefined && !Array.isArray(raw.instrument_schemas)) return null
  return { ...raw, id: PRISM_UCP_HANDLER_ID, schema } as UcpHandlerDiscoveryEntry
}

/** A single UCP checkout-prepare entry — same namespace keying, smaller shape */
export type UcpCheckoutHandlerEntry = {
  id: string
  version: string
  config: PaymentHandlerConfig
}

/** UCP checkout-prepare response: `{ "xyz.fd.prism_payment": [...] }` */
export type UcpCheckoutPrepareResponse = Record<string, UcpCheckoutHandlerEntry[]>

// =====================================================
// ACP shapes (per Prism OpenAPI)
// =====================================================

/**
 * A single ACP handler descriptor. Used both for discovery (`config` is `{}`)
 * and for checkout-prepare (`config` is a `PaymentHandlerConfig`).
 */
export type AcpHandler = {
  id: string
  name: string
  version: string
  spec: string
  requires_delegate_payment: boolean
  requires_pci_compliance: boolean
  psp: string
  config_schema: string
  instrument_schemas: string[]
  config: PaymentHandlerConfig | Record<string, unknown>
}

// =====================================================
// x402 PaymentHandlerConfig — shared by UCP and ACP
// =====================================================

export type PaymentHandlerConfig = {
  x402Version: number
  resource: {
    url: string
    description?: string | null
  }
  accepts: X402AcceptEntry[]
}

export type X402AcceptEntry = {
  scheme: string
  network: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  amount?: string | null
  extra?: Record<string, unknown> | null
}

// =====================================================
// Settlement
// =====================================================

export type SettleInput = {
  ucpVersion: string
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

  // -------------------------------------------------
  // UCP
  // -------------------------------------------------

  async fetchUcpHandlers(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty UCP handlers")
      return {}
    }
    return this.get<UcpHandlersDiscoveryResponse>("/api/v2/merchant/ucp/handlers", ucpVersion)
  }

  async prepareUcpPayment(input: PreparePaymentInput): Promise<UcpCheckoutPrepareResponse> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty UCP prepare")
      return {}
    }
    return this.post<UcpCheckoutPrepareResponse>(
      "/api/v2/merchant/ucp/payment-requirements",
      this.preparePayload(input),
      input.ucpVersion,
    )
  }

  // -------------------------------------------------
  // ACP
  // -------------------------------------------------

  async fetchAcpHandlers(ucpVersion: string): Promise<AcpHandler[]> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty ACP handlers")
      return []
    }
    return this.get<AcpHandler[]>("/api/v2/merchant/acp/handlers", ucpVersion)
  }

  async prepareAcpPayment(input: PreparePaymentInput): Promise<AcpHandler> {
    if (!this.apiKey) {
      throw new Error("No PRISM_API_KEY configured")
    }
    return this.post<AcpHandler>(
      "/api/v2/merchant/acp/payment-requirements",
      this.preparePayload(input),
      input.ucpVersion,
    )
  }

  // -------------------------------------------------
  // Settlement (shared)
  // -------------------------------------------------

  async settle(input: SettleInput): Promise<SettleResult> {
    if (!this.apiKey) {
      return { success: false, error: "No PRISM_API_KEY configured" }
    }

    const response = await fetch(`${this.apiUrl}/api/v2/payment/settle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        "User-Agent": prismUserAgent(input.ucpVersion),
      },
      body: JSON.stringify({ x402Version: 2, paymentPayload: input.paymentPayload, paymentRequirements: input.paymentRequirements }),
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

  // -------------------------------------------------
  // Internal helpers
  // -------------------------------------------------

  private preparePayload(input: PreparePaymentInput) {
    return {
      amount: minorUnitsToDecimalString(input.amount, input.currency),
      currency: input.currency.toUpperCase(),
      resource: {
        url: input.resourceUrl,
        ...(input.resourceDescription ? { description: input.resourceDescription } : {}),
      },
    }
  }

  private async get<T>(path: string, ucpVersion: string): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "GET",
      headers: { "X-API-Key": this.apiKey, "User-Agent": prismUserAgent(ucpVersion) },
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`Prism GET ${path} failed: ${response.status} ${errorText}`)
    }
    return response.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown, ucpVersion: string): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        "User-Agent": prismUserAgent(ucpVersion),
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`Prism POST ${path} failed: ${response.status} ${errorText}`)
    }
    return response.json() as Promise<T>
  }
}
