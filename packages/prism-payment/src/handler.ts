/**
 * Prism Payment Handler Adapter
 *
 * Implements the PaymentHandlerAdapter interface from
 * @financedistrict/saleor-agentic-commerce-core.
 *
 * Wires Prism's protocol-specific endpoints (UCP and ACP variants of
 * `/handlers` and `/payment-requirements`) into the agentic commerce
 * SDK. Discovery and checkout-prepare responses are passed through
 * verbatim — Prism is the authority on its own handler shape.
 */

import type {
  PaymentHandlerAdapter,
  CheckoutPrepareInput,
  PaymentSettleInput,
  PaymentSettleResult,
} from "@financedistrict/saleor-agentic-commerce-core"
import {
  PrismClient,
  canonicalUcpHandlerEntry,
  type AcpHandler,
  type PaymentHandlerConfig,
  type UcpCheckoutPrepareResponse,
  type UcpHandlersDiscoveryResponse,
  type X402AcceptEntry,
} from "./prism-client.js"

// =====================================================
// Constants
// =====================================================

export const PRISM_HANDLER_ID = "xyz.fd.prism_payment"
export const PRISM_INSTRUMENT_TYPE = "x402"
const PRISM_HANDLER_ALIASES: readonly string[] = ["x402"]
const ORIGINAL_INSTRUMENT_TYPES: readonly (string | undefined)[] = [PRISM_INSTRUMENT_TYPE, "tokenized", "default", undefined]
const ORIGINAL_CREDENTIAL_TYPES: readonly (string | undefined)[] = [PRISM_INSTRUMENT_TYPE, undefined]

/**
 * Re-exported for back-compat readers of older Saleor checkout metadata.
 * The legacy generic `payment-profile` flow used this key; the new flow
 * stores the UCP+ACP blob under `PRISM_HANDLER_ID` directly (the registry
 * keys prepare-results by the adapter's id automatically).
 */
export const PRISM_CHECKOUT_CONFIG_KEY = "prism_checkout_config"

// =====================================================
// Stored shape (per-checkout metadata blob)
// =====================================================

type PrismCheckoutData = {
  ucp: UcpCheckoutPrepareResponse | null
  acp: AcpHandler | null
  /** Used for idempotency — set once per (resource, amount) pair */
  preparedAmount: number
  preparedResourceUrl: string
}

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

  // -------------------------------------------------
  // Discovery
  // -------------------------------------------------

  async getUcpDiscoveryHandlers(ucpVersion: string): Promise<UcpHandlersDiscoveryResponse> {
    return this.fetchUcpDiscovery(ucpVersion)
  }

  async getAcpDiscoveryHandlers(ucpVersion: string): Promise<AcpHandler[]> {
    return this.fetchAcpDiscovery(ucpVersion)
  }

  // -------------------------------------------------
  // Checkout preparation
  // -------------------------------------------------

  async prepareCheckoutPayment(input: CheckoutPrepareInput): Promise<PrismCheckoutData | null> {
    const { checkoutId, total, currencyCode, checkoutBaseUrl, storeName, checkoutMetadata, ucpVersion } = input
    const resourceUrl = `${checkoutBaseUrl}/${checkoutId}`

    // Idempotency — return existing blob if we already prepared for this
    // exact (resource, amount) pair.
    const existing = checkoutMetadata?.[PRISM_HANDLER_ID] as PrismCheckoutData | undefined
    if (
      existing &&
      existing.preparedResourceUrl === resourceUrl &&
      existing.preparedAmount === total &&
      (existing.ucp || existing.acp)
    ) {
      return existing
    }

    const prepareInput = {
      ucpVersion,
      amount: total,
      currency: currencyCode,
      resourceUrl,
      resourceDescription: `Purchase from ${storeName}`,
    }

    // Call UCP and ACP prepare in parallel — fail-soft per protocol so a
    // transient error on one side doesn't kill the other.
    const [ucpResult, acpResult] = await Promise.allSettled([
      this.client.prepareUcpPayment(prepareInput),
      this.client.prepareAcpPayment(prepareInput),
    ])

    const ucp = ucpResult.status === "fulfilled" ? ucpResult.value : null
    const acp = acpResult.status === "fulfilled" ? acpResult.value : null

    if (ucpResult.status === "rejected") {
      console.error(
        `[prism-handler] UCP prepare failed for ${checkoutId}: ${ucpResult.reason}`,
      )
    }
    if (acpResult.status === "rejected") {
      console.error(
        `[prism-handler] ACP prepare failed for ${checkoutId}: ${acpResult.reason}`,
      )
    }

    if (!ucp && !acp) {
      return null
    }

    return {
      ucp,
      acp,
      preparedAmount: total,
      preparedResourceUrl: resourceUrl,
    }
  }

  // -------------------------------------------------
  // Settlement
  // -------------------------------------------------

  async settlePayment(input: PaymentSettleInput): Promise<PaymentSettleResult> {
    const { credential, checkoutMetadata, ucpVersion } = input

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

    const accepts = config.accepts ?? []
    if (accepts.length === 0) {
      return { success: false, error: "Prism payment config has no accepts entries" }
    }

    // Prism's /payment/settle wants a single accepts entry as
    // `paymentRequirements` (with network/asset/amount/scheme/payTo at top
    // level), not the wrapper config. Pick the entry matching the network
    // the wallet signed for.
    const requirements = pickAcceptsEntryForCredential(accepts, credential)
    if (!requirements) {
      return {
        success: false,
        error: "Could not match a payment-requirements entry to the submitted credential",
      }
    }

    try {
      const result = await this.client.settle({
        ucpVersion,
        // SAC-3: agents submit the wallet's whole x402 wrapper
        // ({ x402Version, paymentPayload, paymentRequirements }); Prism's
        // /settle wants the INNER paymentPayload (carrying accepted/payload).
        // Unwrap it — matching pickAcceptsEntryForCredential and
        // validate-signed-amount, which already accept both shapes. A flat
        // payload passes through unchanged.
        paymentPayload: unwrapCredentialForSettle(credential),
        paymentRequirements: requirements,
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
    const data = checkoutMetadata?.[PRISM_HANDLER_ID] as PrismCheckoutData | undefined
    return data?.ucp ?? {}
  }

  getAcpCheckoutHandlers(checkoutMetadata?: Record<string, unknown>): unknown[] {
    const data = checkoutMetadata?.[PRISM_HANDLER_ID] as PrismCheckoutData | undefined
    return data?.acp ? [data.acp] : []
  }

  // -------------------------------------------------
  // Internal
  // -------------------------------------------------

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

  private async fetchAcpDiscovery(ucpVersion: string): Promise<AcpHandler[]> {
    const now = Date.now()
    const cache = this.acpDiscoveryCache.get(ucpVersion)
    if (cache && now < cache.expiry) {
      return cache.data
    }
    try {
      const data = await this.client.fetchAcpHandlers(ucpVersion)
      this.acpDiscoveryCache.set(ucpVersion, { data, expiry: now + this.DISCOVERY_TTL })
      return data
    } catch (error: unknown) {
      console.error(`[prism-handler] ACP discovery failed: ${error}`)
      return cache?.data ?? []
    }
  }

  /**
   * Pull the x402 PaymentHandlerConfig from stored checkout metadata.
   * Prefers UCP storage; falls back to ACP. Both wrap the same x402
   * payload so settlement works against either.
   */
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

/**
 * Unwrap the settle credential (SAC-3). Agents submit the wallet's whole x402
 * authorization wrapper `{ x402Version, paymentPayload, paymentRequirements }`,
 * but Prism's `/settle` expects the inner `paymentPayload` (with accepted /
 * payload). Return that inner object when present; pass a flat payload — or a
 * non-object — through unchanged.
 */
export function unwrapCredentialForSettle(credential: unknown): unknown {
  if (credential && typeof credential === "object" && "paymentPayload" in credential) {
    return (credential as { paymentPayload: unknown }).paymentPayload
  }
  return credential
}

/**
 * Pick the `accepts[]` entry that the wallet signed against. Match on
 * (network, asset) — the only pair that uniquely identifies an entry when
 * a cart advertises multiple assets per network. Falls back to legacy
 * (network, scheme) or single-entry resolution when the credential
 * doesn't carry a readable `accepted` block.
 */
export function pickAcceptsEntryForCredential(
  accepts: X402AcceptEntry[],
  credential: unknown,
): X402AcceptEntry | null {
  const { network: signedNetwork, asset: signedAsset } =
    readAcceptedFromCredential(credential)

  if (signedNetwork && signedAsset) {
    const match = accepts.find(
      (a) =>
        a.network === signedNetwork &&
        a.asset.toLowerCase() === signedAsset.toLowerCase(),
    )
    // When the credential carries asset info, treat it as authoritative.
    // Don't silently substitute a different asset just because the network
    // matches — that's what produced the picker-mismatch class of bugs.
    return match ?? null
  }

  // Legacy fallbacks for credential shapes that don't carry an `accepted`
  // block at all (only a hoisted top-level network/scheme).
  const network = readString(credential, "network")
  const scheme = readString(credential, "scheme")
  if (network) {
    const byNetworkAndScheme = scheme
      ? accepts.find((a) => a.network === network && a.scheme === scheme)
      : undefined
    if (byNetworkAndScheme) return byNetworkAndScheme

    const byNetwork = accepts.filter((a) => a.network === network)
    if (byNetwork.length === 1) return byNetwork[0]
    if (byNetwork.length > 1) return null
  }

  return accepts.length === 1 ? accepts[0] : null
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = (value as Record<string, unknown>)[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

function readAcceptedFromCredential(
  credential: unknown,
): { network?: string; asset?: string } {
  if (typeof credential !== "object" || credential === null) return {}
  const obj = credential as Record<string, unknown>
  // Handles flat paymentPayload shape (the obj IS the payload) AND wrapper
  // shape ({paymentPayload, paymentRequirements}).
  const pp =
    obj.paymentPayload && typeof obj.paymentPayload === "object"
      ? (obj.paymentPayload as Record<string, unknown>)
      : obj
  const accepted = pp.accepted
  if (typeof accepted !== "object" || accepted === null) return {}
  const ar = accepted as Record<string, unknown>
  const network =
    typeof ar.network === "string" && ar.network.length > 0 ? ar.network : undefined
  const asset =
    typeof ar.asset === "string" && ar.asset.length > 0 ? ar.asset : undefined
  return { network, asset }
}
