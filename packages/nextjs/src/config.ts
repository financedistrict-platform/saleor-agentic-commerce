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
  loadConfigFromAppCached,
  type PaymentHandlerAdapter,
  type FormatterContext,
  type SaleorClientOptions,
  type AppConfig,
  type AppPaymentHandlerConfig,
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
  /**
   * Load configuration from the Saleor Agentic Commerce App metadata
   * instead of requiring explicit storeName, paymentHandlers, etc.
   *
   * When true, the SDK queries the App's privateMetadata on startup
   * and auto-configures itself. Env-based overrides still take priority.
   */
  configFromApp?: boolean
  /**
   * Public URL of the Saleor Agentic Commerce App (e.g.
   * `https://agentic-app.example.com`). When set, the SDK fetches config
   * via the App's `/api/config-public` endpoint instead of querying
   * Saleor's `{ app { privateMetadata } }` directly.
   *
   * Set this when the storefront's Saleor App token belongs to a
   * DIFFERENT Saleor App than the Agentic Commerce App that holds the
   * dashboard config (the typical setup — storefront has its own
   * service-account App, the Agentic Commerce App is installed via the
   * dashboard with its own identity). Saleor's `{ app }` query always
   * returns the calling App's metadata, so the storefront can't read the
   * Agentic Commerce App's metadata directly.
   *
   * Only used when `configFromApp: true`.
   */
  agenticCommerceAppUrl?: string
  /**
   * Cache TTL in milliseconds for App config (default: 60000 = 60s).
   * Only used when configFromApp is true.
   */
  configCacheTtl?: number
  /**
   * Factory function to create payment handler adapters from App metadata.
   * Called for each payment handler config found in App metadata.
   * If not provided, payment handlers from App config are ignored.
   */
  paymentHandlerFactory?: (config: AppPaymentHandlerConfig) => PaymentHandlerAdapter | null
  /** Store display name (overrides App config if both present) */
  storeName?: string
  /** Store description (overrides App config if both present) */
  storeDescription?: string
  /** UCP protocol version (default: "2026-04-08") */
  ucpVersion?: string
  /** ACP protocol version (default: "2026-01-30") */
  acpVersion?: string
  /** API key for ACP Bearer token authentication (overrides App config) */
  acpApiKey?: string
  /** Payment handler adapters to register (added alongside App-managed handlers) */
  paymentHandlers?: PaymentHandlerAdapter[]
}

// =====================================================
// Instance
// =====================================================

export type AgenticCommerceInstance = {
  saleorClient: SaleorClient
  paymentHandlers: PaymentHandlerRegistry
  formatterContext: FormatterContext
  config: Required<Pick<AgenticCommerceConfig, "storefrontUrl" | "ucpVersion" | "acpVersion">> &
    Pick<AgenticCommerceConfig, "storeDescription" | "acpApiKey"> &
    { storeName: string }
}

/**
 * Create an Agentic Commerce instance.
 *
 * Supports two modes:
 * 1. **Explicit config** — Pass storeName, paymentHandlers, etc. directly.
 * 2. **App-managed config** — Set `configFromApp: true` to load config from
 *    the Saleor Agentic Commerce App's metadata.
 *
 * When using `configFromApp`, the function becomes async and returns a Promise.
 */
export function createAgenticCommerce(
  config: AgenticCommerceConfig & { configFromApp: true }
): Promise<AgenticCommerceInstance>
export function createAgenticCommerce(
  config: AgenticCommerceConfig & { configFromApp?: false }
): AgenticCommerceInstance
export function createAgenticCommerce(
  config: AgenticCommerceConfig
): AgenticCommerceInstance | Promise<AgenticCommerceInstance>
export function createAgenticCommerce(
  config: AgenticCommerceConfig
): AgenticCommerceInstance | Promise<AgenticCommerceInstance> {
  // Validate required config
  if (!config.saleorApiUrl) throw new Error("saleorApiUrl is required")
  if (!config.saleorAuthToken) throw new Error("saleorAuthToken is required")
  if (!config.storefrontUrl) throw new Error("storefrontUrl is required")

  if (config.configFromApp) {
    return createFromApp(config)
  }

  // Explicit config mode — storeName is required
  if (!config.storeName) {
    throw new Error("storeName is required (or use configFromApp: true)")
  }

  return buildInstance(config, config.storeName)
}

/**
 * Load config from App metadata and build the instance.
 */
async function createFromApp(
  config: AgenticCommerceConfig
): Promise<AgenticCommerceInstance> {
  const appConfig = await loadConfigFromAppCached(
    config.saleorApiUrl,
    config.saleorAuthToken,
    config.configCacheTtl,
    { agenticCommerceAppUrl: config.agenticCommerceAppUrl }
  )

  // App config provides defaults; explicit config overrides
  const storeName = config.storeName || appConfig.storeName
  if (!storeName) {
    throw new Error(
      "storeName not found in App config. Configure it in the Dashboard or pass it explicitly."
    )
  }

  // Build payment handlers from App config
  const appHandlers: PaymentHandlerAdapter[] = []
  if (config.paymentHandlerFactory) {
    for (const ph of appConfig.paymentHandlers) {
      const handler = config.paymentHandlerFactory(ph)
      if (handler) appHandlers.push(handler)
    }
  }

  const mergedConfig: AgenticCommerceConfig = {
    ...config,
    storeName,
    storeDescription: config.storeDescription || appConfig.storeDescription,
    acpApiKey: config.acpApiKey || appConfig.acpApiKey,
    paymentHandlers: [...appHandlers, ...(config.paymentHandlers || [])],
  }

  return buildInstance(mergedConfig, storeName)
}

/**
 * Build the final instance from resolved config.
 */
function buildInstance(
  config: AgenticCommerceConfig,
  storeName: string
): AgenticCommerceInstance {
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
    storeName,
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
      storeName,
      storeDescription: config.storeDescription,
      ucpVersion,
      acpVersion,
      acpApiKey: config.acpApiKey,
    },
  }
}
