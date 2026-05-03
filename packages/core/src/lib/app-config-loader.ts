/**
 * App Config Loader
 *
 * Loads Agentic Commerce configuration from Saleor App privateMetadata.
 * Used when `configFromApp: true` is set in createAgenticCommerce().
 *
 * This module is framework-agnostic — it uses the SaleorClient
 * from this package to query the Saleor API.
 */

// ─── Metadata Key Constants ─────────────────────────────

const METADATA_PREFIX = "agentic_commerce__"

const KEYS = {
  enabled: `${METADATA_PREFIX}enabled`,
  storeName: `${METADATA_PREFIX}store_name`,
  storeDescription: `${METADATA_PREFIX}store_description`,
  ucpEnabled: `${METADATA_PREFIX}ucp_enabled`,
  acpEnabled: `${METADATA_PREFIX}acp_enabled`,
  acpApiKey: `${METADATA_PREFIX}acp_api_key`,
  channel: (slug: string) => `${METADATA_PREFIX}channel__${slug}`,
  // New shape (PR #10) — per-handler entry stored under handler__<id>.
  handler: (handlerId: string) => `${METADATA_PREFIX}handler__${handlerId}`,
} as const

const HANDLER_KEY_PREFIX = `${METADATA_PREFIX}handler__`

// ─── Types ──────────────────────────────────────────────

export type AppConfig = {
  enabled: boolean
  storeName: string
  storeDescription: string
  ucpEnabled: boolean
  acpEnabled: boolean
  acpApiKey: string
  channels: Record<string, AppChannelConfig>
  paymentHandlers: AppPaymentHandlerConfig[]
}

export type AppChannelConfig = {
  enabled: boolean
  protocols: ("ucp" | "acp")[]
  paymentHandlers: AppPaymentHandlerConfig[]
}

export type AppPaymentHandlerConfig = {
  handlerId: string
  enabled: boolean
  /**
   * Optional channel allow-list. `null` / `undefined` means "all channels".
   * Set by the App's Payment Handlers tab; only applies to entries stored
   * in the new per-handler key shape. Old per-channel-nested entries leave
   * this undefined.
   */
  channels?: string[] | null
  config: Record<string, unknown>
}

// ─── Loader ─────────────────────────────────────────────

type MetadataEntry = { key: string; value: string }

const APP_METADATA_QUERY = `
  query GetAppMetadata {
    app {
      id
      privateMetadata {
        key
        value
      }
    }
  }
`

/**
 * Load Agentic Commerce configuration from Saleor App metadata.
 *
 * @param apiUrl - Saleor GraphQL API URL
 * @param token  - Saleor App Token with appropriate permissions
 */
export async function loadConfigFromApp(
  apiUrl: string,
  token: string
): Promise<AppConfig> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: APP_METADATA_QUERY }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to load App config from Saleor: ${response.status} ${response.statusText}`
    )
  }

  const json = (await response.json()) as {
    data?: { app: { id: string; privateMetadata: MetadataEntry[] } }
    errors?: Array<{ message: string }>
  }

  if (json.errors?.length) {
    throw new Error(
      `Saleor GraphQL error loading App config: ${json.errors.map((e) => e.message).join(", ")}`
    )
  }

  if (!json.data?.app) {
    throw new Error("No App data returned — is the App installed?")
  }

  return parseMetadata(json.data.app.privateMetadata)
}

/**
 * Parse raw metadata entries into a typed AppConfig.
 */
function parseMetadata(entries: MetadataEntry[]): AppConfig {
  const metadata = new Map<string, string>()

  for (const entry of entries) {
    if (entry.key.startsWith(METADATA_PREFIX)) {
      metadata.set(entry.key, entry.value)
    }
  }

  // Parse global settings
  const config: AppConfig = {
    enabled: metadata.get(KEYS.enabled) === "true",
    storeName: metadata.get(KEYS.storeName) ?? "",
    storeDescription: metadata.get(KEYS.storeDescription) ?? "",
    ucpEnabled: metadata.get(KEYS.ucpEnabled) !== "false",
    acpEnabled: metadata.get(KEYS.acpEnabled) === "true",
    acpApiKey: metadata.get(KEYS.acpApiKey) ?? "",
    channels: {},
    paymentHandlers: [],
  }

  // Parse per-channel configs (still used for protocol enable/disable per channel)
  const channelPrefix = `${METADATA_PREFIX}channel__`
  const allHandlers = new Map<string, AppPaymentHandlerConfig>()

  for (const [key, value] of metadata) {
    if (key.startsWith(channelPrefix)) {
      const slug = key.slice(channelPrefix.length)
      try {
        const channelConfig = JSON.parse(value) as AppChannelConfig
        config.channels[slug] = channelConfig

        // Backward-compat: older configs stored handlers nested inside
        // channel entries. Read those too so we don't lose state from a
        // pre-PR-10 install.
        for (const ph of channelConfig.paymentHandlers ?? []) {
          if (ph.enabled && !allHandlers.has(ph.handlerId)) {
            allHandlers.set(ph.handlerId, ph)
          }
        }
      } catch {
        // Skip malformed channel config
      }
    }
  }

  // New shape (PR #10): per-handler entries stored under
  // `agentic_commerce__handler__<handlerId>` as a JSON blob with
  // `{ enabled, channels, config }`. These take precedence over the
  // backward-compat channel-nested reads above, which they completely
  // replace once the App writes a value (the App's Payment Handlers tab
  // never writes the old shape).
  for (const [key, value] of metadata) {
    if (key.startsWith(HANDLER_KEY_PREFIX)) {
      const handlerId = key.slice(HANDLER_KEY_PREFIX.length)
      try {
        const entry = JSON.parse(value) as {
          enabled: boolean
          channels?: string[] | null
          config: Record<string, unknown>
        }
        if (!entry.enabled) {
          allHandlers.delete(handlerId)
          continue
        }
        allHandlers.set(handlerId, {
          handlerId,
          enabled: true,
          channels: entry.channels ?? null,
          config: entry.config ?? {},
        })
      } catch {
        // Skip malformed handler entry
      }
    }
  }

  config.paymentHandlers = Array.from(allHandlers.values())

  return config
}

// ─── Config Cache ───────────────────────────────────────

type CacheEntry = {
  config: AppConfig
  loadedAt: number
}

let cache: CacheEntry | null = null

/**
 * Load config with caching. Returns cached config if within TTL.
 *
 * @param apiUrl - Saleor GraphQL API URL
 * @param token  - Saleor App Token
 * @param ttlMs  - Cache TTL in milliseconds (default: 60000 = 60s)
 */
export async function loadConfigFromAppCached(
  apiUrl: string,
  token: string,
  ttlMs = 60_000
): Promise<AppConfig> {
  const now = Date.now()

  if (cache && now - cache.loadedAt < ttlMs) {
    return cache.config
  }

  const config = await loadConfigFromApp(apiUrl, token)
  cache = { config, loadedAt: now }

  return config
}

/**
 * Clear the config cache. Useful for testing or forced refresh.
 */
export function clearAppConfigCache(): void {
  cache = null
}
