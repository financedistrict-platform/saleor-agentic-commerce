import { minorToDecimalString } from "@financedistrict/saleor-agentic-commerce-core"

const PRISM_UCP_HANDLER_ID = "xyz.fd.prism_payment"
const PRISM_UCP_HANDLER_IDS: readonly unknown[] = [PRISM_UCP_HANDLER_ID, "x402"]


export type PreparePaymentInput = {
  amount: number
  currency: string
  resourceUrl: string
  resourceDescription?: string
}

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

export type UcpCheckoutHandlerEntry = {
  id: string
  version: string
  config: PaymentHandlerConfig
}

export type UcpCheckoutPrepareResponse = Record<string, UcpCheckoutHandlerEntry[]>


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


export type SettleInput = {
  paymentPayload: unknown
  paymentRequirements: unknown
}

export type SettleResult = {
  success: boolean
  transactionHash?: string
  error?: string
}


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


  async fetchUcpHandlers(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty UCP handlers")
      return {}
    }
    return this.get<UcpHandlersDiscoveryResponse>(`/ucp/${encodeURIComponent(ucpVersion)}/handlers`)
  }

  async preparePayment(input: PreparePaymentInput): Promise<PaymentHandlerConfig> {
    if (!this.apiKey) {
      throw new Error("No PRISM_API_KEY configured")
    }
    return this.post<PaymentHandlerConfig>("/api/v2/merchant/payment-requirements", this.preparePayload(input))
  }


  async fetchAcpHandlers(): Promise<AcpHandler[]> {
    if (!this.apiKey) {
      console.warn("[prism-client] No PRISM_API_KEY configured, returning empty ACP handlers")
      return []
    }
    return this.get<AcpHandler[]>("/api/v2/merchant/acp/handlers")
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


  private preparePayload(input: PreparePaymentInput) {
    return {
      amount: minorToDecimalString(input.amount, input.currency),
      currency: input.currency.toUpperCase(),
      resource: {
        url: input.resourceUrl,
        ...(input.resourceDescription ? { description: input.resourceDescription } : {}),
      },
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "GET",
      headers: { "X-API-Key": this.apiKey },
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`Prism GET ${path} failed: ${response.status} ${errorText}`)
    }
    return response.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
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
