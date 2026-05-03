"use client"

import { useState } from "react"
import { DEFAULT_CHANNEL_CONFIG, type ChannelConfig } from "@/lib/metadata-keys"

type Channel = {
  id: string
  slug: string
  name: string
  currencyCode: string
  isActive: boolean
  agenticConfig: ChannelConfig | null
}

type Props = {
  channels: Channel[]
  onSave: (configs: Record<string, ChannelConfig>) => Promise<void>
  saving: boolean
}

export function ChannelSettings({ channels, onSave, saving }: Props) {
  const [configs, setConfigs] = useState<Record<string, ChannelConfig>>(
    () => {
      const initial: Record<string, ChannelConfig> = {}
      for (const ch of channels) {
        initial[ch.slug] = ch.agenticConfig ?? { ...DEFAULT_CHANNEL_CONFIG }
      }
      return initial
    }
  )
  const [dirty, setDirty] = useState(false)

  const updateChannel = (slug: string, update: Partial<ChannelConfig>) => {
    setConfigs((prev) => ({
      ...prev,
      [slug]: { ...prev[slug], ...update },
    }))
    setDirty(true)
  }

  const toggleProtocol = (slug: string, protocol: "ucp" | "acp") => {
    const current = configs[slug]?.protocols ?? []
    const next = current.includes(protocol)
      ? current.filter((p) => p !== protocol)
      : [...current, protocol]
    updateChannel(slug, { protocols: next })
  }

  const handleSave = async () => {
    await onSave(configs)
    setDirty(false)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={styles.description}>
        Configure which channels are available to AI agents and which
        protocols each channel supports.
      </p>

      {channels.length === 0 && (
        <div style={styles.card}>
          <p style={{ margin: 0, color: "#6b7280" }}>
            No channels found. Create a channel in Saleor first.
          </p>
        </div>
      )}

      {channels.map((ch) => {
        const config = configs[ch.slug] ?? DEFAULT_CHANNEL_CONFIG

        return (
          <div key={ch.id} style={styles.card}>
            <div style={styles.channelHeader}>
              <div>
                <h4 style={styles.channelName}>{ch.name}</h4>
                <span style={styles.channelMeta}>
                  {ch.slug} &middot; {ch.currencyCode}
                  {!ch.isActive && (
                    <span style={styles.inactiveBadge}> Inactive</span>
                  )}
                </span>
              </div>
              <label style={styles.toggle}>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) =>
                    updateChannel(ch.slug, { enabled: e.target.checked })
                  }
                />
                <span>{config.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </div>

            {config.enabled && (
              <div style={styles.channelBody}>
                <div style={styles.protocolRow}>
                  <span style={styles.label}>Protocols:</span>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={config.protocols.includes("ucp")}
                      onChange={() => toggleProtocol(ch.slug, "ucp")}
                    />
                    UCP
                  </label>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={config.protocols.includes("acp")}
                      onChange={() => toggleProtocol(ch.slug, "acp")}
                    />
                    ACP
                  </label>
                </div>

                {/*
                  ChannelConfig.paymentHandlers is deprecated — handler
                  enable/disable now lives on the handler entry itself
                  (PaymentHandlerEntry.channels). For now the Channels tab
                  just nudges the operator to the Payment Handlers tab; a
                  follow-up PR will surface the active handlers per channel
                  from the new metadata layout.
                */}
                <p style={styles.hint}>
                  Configure payment handlers (Prism, etc.) and their
                  per-channel scoping in the Payment Handlers tab.
                </p>
              </div>
            )}
          </div>
        )
      })}

      {dirty && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={styles.primaryButton}
          >
            {saving ? "Saving..." : "Save Channel Settings"}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  description: {
    margin: "0 0 8px",
    fontSize: "14px",
    color: "#6b7280",
    lineHeight: "1.5",
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "16px 20px",
    background: "#fff",
  },
  channelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  channelName: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 600,
  },
  channelMeta: {
    fontSize: "13px",
    color: "#6b7280",
  },
  inactiveBadge: {
    color: "#ef4444",
    fontWeight: 500,
  },
  channelBody: {
    marginTop: "16px",
    paddingTop: "16px",
    borderTop: "1px solid #f3f4f6",
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
    fontSize: "14px",
  },
  protocolRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#374151",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    cursor: "pointer",
    fontSize: "14px",
  },
  hint: {
    marginTop: "12px",
    fontSize: "13px",
    color: "#9ca3af",
    fontStyle: "italic",
  },
  handlerList: {
    margin: "8px 0 0",
    padding: "0",
    listStyle: "none",
  },
  handlerItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 12px",
    background: "#f9fafb",
    borderRadius: "4px",
    marginBottom: "4px",
    fontSize: "13px",
  },
  primaryButton: {
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#fff",
    background: "#2563eb",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
}
