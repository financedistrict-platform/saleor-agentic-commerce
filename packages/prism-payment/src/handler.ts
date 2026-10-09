import type {
  PaymentHandlerAdapter,
  CheckoutPrepareInput,
  PaymentSettleInput,
  PaymentSettleResult,
} from "@financedistrict/saleor-agentic-commerce-core"
import { extractSignedSummary, validateSignedAgainstStored } from "@financedistrict/saleor-agentic-commerce-core"
import {
  PrismClient,
  canonicalUcpHandlerEntry,
  type AcpHandler,
  type PaymentHandlerConfig,
  type UcpCheckoutPrepareResponse,
  type UcpHandlersDiscoveryResponse,
} from "./prism-client.js"


export const PRISM_HANDLER_ID = "xyz.fd.prism_payment"
export const PRISM_INSTRUMENT_TYPE = "x402"
const PRISM_HANDLER_ALIASES: readonly string[] = ["x402"]
const ORIGINAL_INSTRUMENT_TYPES: readonly (string | undefined)[] = [PRISM_INSTRUMENT_TYPE, "tokenized", "default", undefined]
const ORIGINAL_CREDENTIAL_TYPES: readonly (string | undefined)[] = [PRISM_INSTRUMENT_TYPE, undefined]

export const PRISM_CHECKOUT_CONFIG_KEY = "prism_checkout_config"


type PrismCheckoutData = {
  ucp: UcpCheckoutPrepareResponse | null
  acp: AcpHandler | null
  preparedAmount: number
  preparedCurrency: string
  preparedResourceUrl: string
}


export type PrismPaymentHandlerOptions = {
  apiUrl?: string
  apiKey?: string
}


export class PrismPaymentHandler implements PaymentHandlerAdapter {
  readonly id = PRISM_HANDLER_ID
  readonly name = "Finance District Prism"
  readonly aliases = PRISM_HANDLER_ALIASES

  private client: PrismClient
  private readonly apiUrl: string

  private ucpDiscoveryCache = new Map<string, { data: UcpHandlersDiscoveryResponse; expiry: number }>()
  private acpDiscoveryCache = new Map<string, { data: AcpHandler[]; expiry: number }>()
  private readonly DISCOVERY_TTL = 5 * 60 * 1000
  private ucpDiscoveryRetryAt = new Map<string, number>()
  private readonly DISCOVERY_FAILURE_TTL = 60 * 1000

  constructor(options: PrismPaymentHandlerOptions = {}) {
    const apiUrl = options.apiUrl || process.env.PRISM_API_URL || "https://prism-gw.fd.xyz"
    this.apiUrl = apiUrl
    this.client = new PrismClient({
      apiUrl,
      apiKey: options.apiKey,
    })
  }


  async getUcpDiscoveryHandlers(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    return this.fetchUcpDiscovery(ucpVersion)
  }

  async getAcpDiscoveryHandlers(ucpVersion: string): Promise<AcpHandler[]> {
    return this.fetchAcpDiscovery()
  }


  async prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<PrismCheckoutData | null> {
    const { checkoutId, total, currencyCode, checkoutBaseUrl, storeName, checkoutMetadata, ucpVersion } = input
    const resourceUrl = `${checkoutBaseUrl}/${checkoutId}`

    const existing = checkoutMetadata?.[PRISM_HANDLER_ID] as PrismCheckoutData | undefined
    if (
      existing &&
      existing.preparedResourceUrl === resourceUrl &&
      existing.preparedAmount === total &&
      existing.preparedCurrency === currencyCode &&
      (existing.ucp || existing.acp)
    ) {
      return existing
    }

    const prepareInput = {
      amount: total,
      currency: currencyCode,
      resourceUrl,
      resourceDescription: `Purchase from ${storeName}`,
    }

    const [ucpDiscovery, acpDiscovery] = await Promise.all([
      this.fetchUcpDiscovery(ucpVersion),
      this.fetchAcpDiscovery(),
    ])
    const ucpDeclaration = ucpDiscovery[PRISM_HANDLER_ID]?.[0]
    const acpDeclaration = acpDiscovery[0]

    if (!ucpDeclaration && !acpDeclaration) {
      console.error(`[prism-handler] no UCP or ACP declaration for ${checkoutId}`)
      return null
    }

    let config: PaymentHandlerConfig
    try {
      config = await this.client.preparePayment(prepareInput)
    } catch (error: unknown) {
      console.error(`[prism-handler] prepare failed for ${checkoutId}: ${error}`)
      return null
    }

    const ucp: UcpCheckoutPrepareResponse | null = ucpDeclaration
      ? { [PRISM_HANDLER_ID]: [{ id: ucpDeclaration.id, version: ucpDeclaration.version, config }] }
      : null
    const acp: AcpHandler | null = acpDeclaration ? { ...acpDeclaration, config } : null

    return {
      ucp,
      acp,
      preparedAmount: total,
      preparedCurrency: currencyCode,
      preparedResourceUrl: resourceUrl,
    }
  }


  async settlePayment(input: PaymentSettleInput): Promise<PaymentSettleResult> {
    const { credential, checkoutMetadata } = input

    if (
      input.protocol !== "acp" &&
      (!ORIGINAL_INSTRUMENT_TYPES.includes(input.instrumentType || undefined) ||
        !ORIGINAL_CREDENTIAL_TYPES.includes(readString(credential, "type")))
    ) {
      return { success: false, error: `Prism instrument and credential type must be "${PRISM_INSTRUMENT_TYPE}"` }
    }

    const config = this.extractPaymentConfig(checkoutMetadata)
    if (!config) {
      return { success: false, error: "No Prism payment config found on checkout" }
    }

    const prepared = checkoutMetadata?.[PRISM_HANDLER_ID] as Partial<PrismCheckoutData>
    if (!Number.isSafeInteger(prepared.preparedAmount) || typeof prepared.preparedCurrency !== "string") {
      return { success: false, error: "Prism payment config has no prepared amount" }
    }
    const settled = { amount: prepared.preparedAmount as number, currency: prepared.preparedCurrency }

    const accepts = config.accepts ?? []
    if (accepts.length === 0) {
      return { success: false, error: "Prism payment config has no accepts entries" }
    }

    const signed = extractSignedSummary(credential)
    if (!signed) {
      return {
        success: false,
        code: "unreadable_payment_credential",
        error: "The credential is not a signed x402 exact payment with an accepted network and asset and an EIP-3009 authorization",
      }
    }

    const checked = validateSignedAgainstStored(signed, accepts)
    if (!checked.ok) {
      return { success: false, code: checked.code, error: checked.message }
    }

    try {
      const result = await this.client.settle({
        paymentPayload: signed.payload,
        paymentRequirements: checked.entry,
      })

      if (!result.success) {
        return { success: false, error: result.error ?? "Prism settlement failed" }
      }
      if (!result.transactionHash) {
        return { success: false, error: "Prism settlement returned no transaction reference" }
      }

      return {
        success: true,
        transactionReference: result.transactionHash,
        settled,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return { success: false, error: `Prism settlement failed: ${message}` }
    }
  }


  getUcpCheckoutHandlers(checkoutMetadata?: Record<string, unknown>): Record<string, unknown[]> {
    const data = checkoutMetadata?.[PRISM_HANDLER_ID] as PrismCheckoutData | undefined
    return data?.ucp ?? {}
  }

  getAcpCheckoutHandlers(checkoutMetadata?: Record<string, unknown>): unknown[] {
    const data = checkoutMetadata?.[PRISM_HANDLER_ID] as PrismCheckoutData | undefined
    return data?.acp ? [data.acp] : []
  }


  private async fetchUcpDiscovery(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    const now = Date.now()
    const key = `${this.apiUrl}|${ucpVersion}`
    const cache = this.ucpDiscoveryCache.get(key)
    if (cache && now < cache.expiry) return cache.data
    if (now < (this.ucpDiscoveryRetryAt.get(key) ?? 0)) return {}
    try {
      const entry = firstCanonicalEntry(await this.client.fetchUcpHandlers(ucpVersion))
      if (!entry) {
        throw new Error(`malformed ${PRISM_HANDLER_ID} entry (need id, version, spec, schema)`)
      }
      const data = { [PRISM_HANDLER_ID]: [entry] }
      this.ucpDiscoveryCache.set(key, { data, expiry: now + this.DISCOVERY_TTL })
      return data
    } catch (error: unknown) {
      console.error(`[prism-handler] UCP discovery failed: ${error}`)
      this.ucpDiscoveryRetryAt.set(key, now + this.DISCOVERY_FAILURE_TTL)
      return {}
    }
  }

  private async fetchAcpDiscovery(): Promise<AcpHandler[]> {
    const now = Date.now()
    const cache = this.acpDiscoveryCache.get(this.apiUrl)
    if (cache && now < cache.expiry) {
      return cache.data
    }
    try {
      const data = await this.client.fetchAcpHandlers()
      this.acpDiscoveryCache.set(this.apiUrl, { data, expiry: now + this.DISCOVERY_TTL })
      return data
    } catch (error: unknown) {
      console.error(`[prism-handler] ACP discovery failed: ${error}`)
      return cache?.data ?? []
    }
  }

  private extractPaymentConfig(
    checkoutMetadata?: Record<string, unknown>,
  ): PaymentHandlerConfig | null {
    const data = checkoutMetadata?.[PRISM_HANDLER_ID] as PrismCheckoutData | undefined
    if (!data) return null

    if (data.ucp) {
      const firstNamespace = Object.values(data.ucp)[0]
      const firstEntry = firstNamespace?.[0]
      if (firstEntry?.config) return firstEntry.config
    }

    if (data.acp?.config && this.isPaymentHandlerConfig(data.acp.config)) {
      return data.acp.config
    }

    return null
  }

  private isPaymentHandlerConfig(value: unknown): value is PaymentHandlerConfig {
    return (
      typeof value === "object" &&
      value !== null &&
      "x402Version" in value &&
      "accepts" in value
    )
  }
}

function firstCanonicalEntry(data: unknown) {
  if (typeof data !== "object" || data === null) return null
  const entries = (data as Record<string, unknown>)[PRISM_HANDLER_ID]
  if (!Array.isArray(entries) || entries.length === 0) return null
  return canonicalUcpHandlerEntry(entries[0])
}

export function isContractEntry(data: unknown): data is UcpHandlersDiscoveryResponse {
  return firstCanonicalEntry(data) !== null
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = (value as Record<string, unknown>)[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}
