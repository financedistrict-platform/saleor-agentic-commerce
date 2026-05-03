/**
 * Metadata key constants for the Agentic Commerce App.
 *
 * All configuration is stored in Saleor's App privateMetadata
 * via the EncryptedMetadataManager from @saleor/app-sdk.
 *
 * Prefix: `agentic_commerce__`
 */

// ─── Key Constants ──────────────────────────────────────────

export const METADATA_PREFIX = "agentic_commerce__"

// Global settings
export const KEYS = {
  enabled: `${METADATA_PREFIX}enabled`,
  storeName: `${METADATA_PREFIX}store_name`,
  storeDescription: `${METADATA_PREFIX}store_description`,
  ucpEnabled: `${METADATA_PREFIX}ucp_enabled`,
  acpEnabled: `${METADATA_PREFIX}acp_enabled`,
  acpApiKey: `${METADATA_PREFIX}acp_api_key`,

  // Per-channel config (template — replace {slug})
  channel: (slug: string) => `${METADATA_PREFIX}channel__${slug}`,

  // Per-handler config (template — replace {handlerId})
  // handlerId is the reverse-DNS handler-type identifier
  // (e.g. "xyz.fd.prism_payment"). Stored as a JSON blob with shape
  // PaymentHandlerEntry.
  handler: (handlerId: string) => `${METADATA_PREFIX}handler__${handlerId}`,

  // Order-level metadata (written by webhooks)
  agentSession: `${METADATA_PREFIX}agent_session`,
  orderEvents: `${METADATA_PREFIX}order_events`,
} as const

/** Reverse-DNS identifier of the only handler we ship with v1. */
export const PRISM_HANDLER_ID = "xyz.fd.prism_payment"

// ─── Types ──────────────────────────────────────────────────

export type GlobalConfig = {
  enabled: boolean
  storeName: string
  storeDescription: string
  ucpEnabled: boolean
  acpEnabled: boolean
  acpApiKey: string
}

export type ChannelConfig = {
  enabled: boolean
  protocols: ("ucp" | "acp")[]
  /**
   * @deprecated Per-channel handler enabling now lives on the handler entry
   * itself (`PaymentHandlerEntry.channels`). Kept on ChannelConfig for
   * backward compatibility with older stored values; ignored on read.
   */
  paymentHandlers?: PaymentHandlerConfig[]
}

/**
 * @deprecated Use {@link PaymentHandlerEntry} for v1+ storage. The shape
 * lives on the handler entry now, not nested inside ChannelConfig.
 */
export type PaymentHandlerConfig = {
  handlerId: string
  enabled: boolean
  config: Record<string, unknown>
}

/**
 * Per-handler entry stored in privateMetadata under
 * `agentic_commerce__handler__<handlerId>` as a JSON blob.
 *
 * Shape mirrors the design doc handler-registry layout:
 * - `enabled`: global on/off
 * - `channels`: optional allow-list of Saleor channel slugs; null/undefined
 *   means "all channels"
 * - `config`: handler-specific values, shape governed by the handler's
 *   `config_schema` URL (per ACP/UCP spec). For v1 we type this loosely;
 *   future PRs will validate against the live schema.
 */
export type PaymentHandlerEntry = {
  enabled: boolean
  channels?: string[] | null
  config: Record<string, unknown>
}

/** v1 Prism handler config — only what's actually local. */
export type PrismHandlerConfig = {
  apiUrl: string
  apiKey: string
}

export type AgentSessionMetadata = {
  agentProfileUrl: string | null
  protocol: "ucp" | "acp"
  timestamp: string
  userAgent: string | null
}

export type OrderEvent = {
  id: string
  type: string
  timestamp: string
  fulfillmentId?: string
  trackingNumber?: string
  status?: string
  lineItems?: { id: string; quantity: number }[]
}

// ─── Defaults ───────────────────────────────────────────────

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  enabled: false,
  storeName: "",
  storeDescription: "",
  ucpEnabled: true,
  acpEnabled: false,
  acpApiKey: "",
}

export const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  enabled: false,
  protocols: ["ucp"],
}

export const DEFAULT_PRISM_HANDLER_CONFIG: PrismHandlerConfig = {
  // Defaults to FD's hosted gateway. Operator overrides for self-hosted Prism
  // or test environments.
  apiUrl: "https://prism-gw.fd.xyz",
  apiKey: "",
}

export const DEFAULT_PRISM_HANDLER_ENTRY: PaymentHandlerEntry = {
  enabled: false,
  channels: null,
  config: DEFAULT_PRISM_HANDLER_CONFIG as unknown as Record<string, unknown>,
}
