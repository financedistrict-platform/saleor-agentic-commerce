/**
 * Configuration Manager
 *
 * Reads and writes Agentic Commerce configuration
 * from Saleor App privateMetadata.
 */

import {
  KEYS,
  METADATA_PREFIX,
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_CHANNEL_CONFIG,
  type GlobalConfig,
  type ChannelConfig,
  type PaymentHandlerEntry,
} from "./metadata-keys"
import { SaleorApiClient, QUERIES, MUTATIONS } from "./saleor-api"

type MetadataEntry = { key: string; value: string }

export class ConfigManager {
  private client: SaleorApiClient
  private appId: string | null = null

  constructor(apiUrl: string, token: string) {
    this.client = new SaleorApiClient(apiUrl, token)
  }

  // ─── Read ───────────────────────────────────────────────

  /**
   * Fetch all agentic commerce metadata from the App.
   */
  async getAllMetadata(): Promise<Map<string, string>> {
    const data = await this.client.query<{
      app: { id: string; privateMetadata: MetadataEntry[] }
    }>(QUERIES.GET_APP_METADATA)

    this.appId = data.app.id

    const map = new Map<string, string>()
    for (const entry of data.app.privateMetadata) {
      if (entry.key.startsWith(METADATA_PREFIX)) {
        map.set(entry.key, entry.value)
      }
    }
    return map
  }

  /**
   * Parse metadata into a typed GlobalConfig.
   */
  async getGlobalConfig(): Promise<GlobalConfig> {
    const metadata = await this.getAllMetadata()

    return {
      enabled: metadata.get(KEYS.enabled) === "true",
      storeName: metadata.get(KEYS.storeName) ?? DEFAULT_GLOBAL_CONFIG.storeName,
      storeDescription:
        metadata.get(KEYS.storeDescription) ?? DEFAULT_GLOBAL_CONFIG.storeDescription,
      ucpEnabled: metadata.get(KEYS.ucpEnabled) !== "false", // default true
      acpEnabled: metadata.get(KEYS.acpEnabled) === "true",
      acpApiKey: metadata.get(KEYS.acpApiKey) ?? DEFAULT_GLOBAL_CONFIG.acpApiKey,
    }
  }

  /**
   * Get config for a specific channel.
   */
  async getChannelConfig(slug: string): Promise<ChannelConfig> {
    const metadata = await this.getAllMetadata()
    const raw = metadata.get(KEYS.channel(slug))

    if (!raw) return { ...DEFAULT_CHANNEL_CONFIG }

    try {
      return JSON.parse(raw) as ChannelConfig
    } catch {
      return { ...DEFAULT_CHANNEL_CONFIG }
    }
  }

  /**
   * Get config for all channels.
   */
  async getAllChannelConfigs(): Promise<Record<string, ChannelConfig>> {
    const metadata = await this.getAllMetadata()
    const channelPrefix = `${METADATA_PREFIX}channel__`
    const configs: Record<string, ChannelConfig> = {}

    for (const [key, value] of metadata) {
      if (key.startsWith(channelPrefix)) {
        const slug = key.slice(channelPrefix.length)
        try {
          configs[slug] = JSON.parse(value) as ChannelConfig
        } catch {
          configs[slug] = { ...DEFAULT_CHANNEL_CONFIG }
        }
      }
    }

    return configs
  }

  // ─── Write ──────────────────────────────────────────────

  /**
   * Ensure we have the App ID (needed for metadata mutations).
   */
  private async ensureAppId(): Promise<string> {
    if (this.appId) return this.appId

    const data = await this.client.query<{ app: { id: string } }>(QUERIES.GET_APP_METADATA)
    this.appId = data.app.id
    return this.appId
  }

  /**
   * Save global configuration.
   */
  async saveGlobalConfig(config: Partial<GlobalConfig>): Promise<void> {
    const appId = await this.ensureAppId()

    const input: MetadataEntry[] = []

    if (config.enabled !== undefined) {
      input.push({ key: KEYS.enabled, value: String(config.enabled) })
    }
    if (config.storeName !== undefined) {
      input.push({ key: KEYS.storeName, value: config.storeName })
    }
    if (config.storeDescription !== undefined) {
      input.push({ key: KEYS.storeDescription, value: config.storeDescription })
    }
    if (config.ucpEnabled !== undefined) {
      input.push({ key: KEYS.ucpEnabled, value: String(config.ucpEnabled) })
    }
    if (config.acpEnabled !== undefined) {
      input.push({ key: KEYS.acpEnabled, value: String(config.acpEnabled) })
    }
    if (config.acpApiKey !== undefined) {
      input.push({ key: KEYS.acpApiKey, value: config.acpApiKey })
    }

    if (input.length > 0) {
      await this.client.query(MUTATIONS.UPDATE_APP_METADATA, {
        id: appId,
        input,
      })
    }
  }

  /**
   * Save channel configuration.
   */
  async saveChannelConfig(slug: string, config: ChannelConfig): Promise<void> {
    const appId = await this.ensureAppId()

    await this.client.query(MUTATIONS.UPDATE_APP_METADATA, {
      id: appId,
      input: [{ key: KEYS.channel(slug), value: JSON.stringify(config) }],
    })
  }

  // ─── Payment handlers ────────────────────────────────────

  /**
   * Get config for a single payment handler by reverse-DNS id.
   * Returns null if the handler has no stored entry.
   */
  async getPaymentHandler(handlerId: string): Promise<PaymentHandlerEntry | null> {
    const metadata = await this.getAllMetadata()
    const raw = metadata.get(KEYS.handler(handlerId))
    if (!raw) return null
    try {
      return JSON.parse(raw) as PaymentHandlerEntry
    } catch {
      return null
    }
  }

  /**
   * Get all payment handler entries keyed by reverse-DNS handlerId.
   */
  async getAllPaymentHandlers(): Promise<Record<string, PaymentHandlerEntry>> {
    const metadata = await this.getAllMetadata()
    const handlerPrefix = `${METADATA_PREFIX}handler__`
    const handlers: Record<string, PaymentHandlerEntry> = {}

    for (const [key, value] of metadata) {
      if (key.startsWith(handlerPrefix)) {
        const handlerId = key.slice(handlerPrefix.length)
        try {
          handlers[handlerId] = JSON.parse(value) as PaymentHandlerEntry
        } catch {
          // Skip malformed entries — surfaced to operator on next save.
        }
      }
    }

    return handlers
  }

  /**
   * Save (or replace) a payment handler entry.
   */
  async savePaymentHandler(
    handlerId: string,
    entry: PaymentHandlerEntry,
  ): Promise<void> {
    const appId = await this.ensureAppId()
    await this.client.query(MUTATIONS.UPDATE_APP_METADATA, {
      id: appId,
      input: [{ key: KEYS.handler(handlerId), value: JSON.stringify(entry) }],
    })
  }

  // ─── Channels ───────────────────────────────────────────

  /**
   * Fetch available Saleor channels.
   */
  async getChannels(): Promise<
    Array<{
      id: string
      slug: string
      name: string
      currencyCode: string
      isActive: boolean
    }>
  > {
    const data = await this.client.query<{
      channels: Array<{
        id: string
        slug: string
        name: string
        currencyCode: string
        isActive: boolean
      }>
    }>(QUERIES.GET_CHANNELS)

    return data.channels
  }
}
