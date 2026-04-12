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

  // Order-level metadata (written by webhooks)
  agentSession: `${METADATA_PREFIX}agent_session`,
  orderEvents: `${METADATA_PREFIX}order_events`,
} as const

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
  paymentHandlers: PaymentHandlerConfig[]
}

export type PaymentHandlerConfig = {
  handlerId: string
  enabled: boolean
  config: Record<string, unknown>
}

export type PrismConfig = {
  apiUrl: string
  apiKey: string
  webhookSecret: string
  acceptedTokens: string[]
  acceptedChains: string[]
  merchantWallet: string
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
  paymentHandlers: [],
}
