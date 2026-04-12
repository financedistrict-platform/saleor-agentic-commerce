/**
 * Agentic Commerce Configuration
 *
 * Creates and configures the agentic commerce instance that route handlers
 * and middleware use. Merchants call createAgenticCommerce() once in their
 * storefront code and export the instance.
 */

import {
  SaleorClient,
  PaymentHandlerRegistry,
  type PaymentHandlerAdapter,
  type FormatterContext,
  type SaleorClientOptions,
} from "@financedistrict/saleor-agentic-commerce-core"

// =====================================================
// Configuration
// =====================================================

export type AgenticCommerceConfig = {
  /** Saleor GraphQL API URL (e.g., "https://api.store.com/graphql/") */
  saleorApiUrl: string
  /** Saleor App Token with MANAGE_CHECKOUTS, MANAGE_ORDERS permissions */
  saleorAuthToken: string
  /** Default Saleor channel slug */
  channel?: string
  /** Storefront public URL (e.g., "https://store.com") */
  storefrontUrl: string
  /** Store display name */
  storeName: string
  /** Store description */
  storeDescription?: string
  /** UCP protocol version (default: "2026-04-08") */
  ucpVersion?: string
  /** ACP protocol version (default: "2026-01-30") */
  acpVersion?: string
  /** API key for ACP Bearer token authentication */
  acpApiKey?: string
  /** Payment handler adapters to register */
  paymentHandlers?: PaymentHandlerAdapter[]
}

// =====================================================
// Instance
// =====================================================

export type AgenticCommerceInstance = {
  saleorClient: SaleorClient
  paymentHandlers: PaymentHandlerRegistry
  formatterContext: FormatterContext
  config: Required<Pick<AgenticCommerceConfig, "storefrontUrl" | "storeName" | "ucpVersion" | "acpVersion">> &
    Pick<AgenticCommerceConfig, "storeDescription" | "acpApiKey">
}

export function createAgenticCommerce(config: AgenticCommerceConfig): AgenticCommerceInstance {
  // Validate required config
  if (!config.saleorApiUrl) throw new Error("saleorApiUrl is required")
  if (!config.saleorAuthToken) throw new Error("saleorAuthToken is required")
  if (!config.storefrontUrl) throw new Error("storefrontUrl is required")
  if (!config.storeName) throw new Error("storeName is required")

  const ucpVersion = config.ucpVersion || "2026-04-08"
  const acpVersion = config.acpVersion || "2026-01-30"

  // Create Saleor client
  const saleorClient = new SaleorClient({
    apiUrl: config.saleorApiUrl,
    authToken: config.saleorAuthToken,
    channel: config.channel,
  })

  // Create and populate payment handler registry
  const paymentHandlers = new PaymentHandlerRegistry()
  for (const handler of config.paymentHandlers || []) {
    paymentHandlers.registerAdapter(handler)
  }

  // Create formatter context
  const formatterContext: FormatterContext = {
    storeName: config.storeName,
    storefrontUrl: config.storefrontUrl,
    ucpVersion,
    acpVersion,
    paymentHandlers,
  }

  return {
    saleorClient,
    paymentHandlers,
    formatterContext,
    config: {
      storefrontUrl: config.storefrontUrl,
      storeName: config.storeName,
      storeDescription: config.storeDescription,
      ucpVersion,
      acpVersion,
      acpApiKey: config.acpApiKey,
    },
  }
}
