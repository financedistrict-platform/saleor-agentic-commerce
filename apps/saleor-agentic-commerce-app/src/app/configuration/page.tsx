"use client"

import { useState, useEffect, useCallback } from "react"
import { useAppBridge } from "@saleor/app-sdk/app-bridge"
import { GeneralSettings } from "@/components/GeneralSettings"
import { ChannelSettings } from "@/components/ChannelSettings"
import { PaymentHandlerSettings } from "@/components/PaymentHandlerSettings"
import { ActivityDashboard } from "@/components/ActivityDashboard"
import type { GlobalConfig, ChannelConfig } from "@/lib/metadata-keys"
import { DEFAULT_GLOBAL_CONFIG } from "@/lib/metadata-keys"

type Tab = "general" | "channels" | "payment-handlers" | "activity"

type Channel = {
  id: string
  slug: string
  name: string
  currencyCode: string
  isActive: boolean
  agenticConfig: ChannelConfig | null
}

type ConfigData = {
  global: GlobalConfig
  channels: Channel[]
}

/**
 * Configuration Page
 *
 * The main App page shown in the Saleor Dashboard iframe.
 * Four tabs: General, Channels, Payment Handlers, Activity.
 */
export default function ConfigurationPage() {
  const { appBridgeState } = useAppBridge()
  const [activeTab, setActiveTab] = useState<Tab>("general")
  const [data, setData] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saleorApiUrl = appBridgeState?.saleorApiUrl ?? null

  // Fetch configuration
  useEffect(() => {
    if (!saleorApiUrl) return

    const loadConfig = async () => {
      try {
        const response = await fetch(
          `/api/config?saleorApiUrl=${encodeURIComponent(saleorApiUrl)}`
        )

        if (!response.ok) {
          throw new Error(`Failed to load config: ${response.status}`)
        }

        const config = await response.json()
        setData(config)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load configuration"
        )
      } finally {
        setLoading(false)
      }
    }

    loadConfig()
  }, [saleorApiUrl])

  // Save configuration
  const saveConfig = async (body: {
    global?: Partial<GlobalConfig>
    channels?: Record<string, ChannelConfig>
  }) => {
    if (!saleorApiUrl) return

    setSaving(true)
    try {
      const response = await fetch(
        `/api/config?saleorApiUrl=${encodeURIComponent(saleorApiUrl)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to save: ${response.status}`)
      }

      // Refresh data
      const refreshResponse = await fetch(
        `/api/config?saleorApiUrl=${encodeURIComponent(saleorApiUrl)}`
      )
      if (refreshResponse.ok) {
        setData(await refreshResponse.json())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  if (!saleorApiUrl) {
    return (
      <div style={styles.error}>
        <h2>Not Connected</h2>
        <p>
          This App must be loaded from the Saleor Dashboard. Please open it
          through your Dashboard&apos;s Apps section.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={styles.loading}>
        <p>Loading configuration...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.error}>
        <h2>Configuration Error</h2>
        <p>{error}</p>
        <p style={{ fontSize: "13px", color: "#6b7280" }}>
          Make sure the App is properly installed and registered with your
          Saleor instance.
        </p>
      </div>
    )
  }

  const globalConfig = data?.global ?? DEFAULT_GLOBAL_CONFIG
  const channels = data?.channels ?? []

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "channels", label: "Channels" },
    { id: "payment-handlers", label: "Payment Handlers" },
    { id: "activity", label: "Activity" },
  ]

  return (
    <div>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Agentic Commerce</h1>
        <span style={styles.version}>v0.1.0</span>
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.activeTab : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={styles.tabContent}>
        {activeTab === "general" && (
          <GeneralSettings
            config={globalConfig}
            onSave={(config) => saveConfig({ global: config })}
            saving={saving}
          />
        )}
        {activeTab === "channels" && (
          <ChannelSettings
            channels={channels}
            onSave={(configs) => saveConfig({ channels: configs })}
            saving={saving}
          />
        )}
        {activeTab === "payment-handlers" && <PaymentHandlerSettings />}
        {activeTab === "activity" && <ActivityDashboard />}
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: "12px",
    marginBottom: "24px",
  },
  title: {
    margin: 0,
    fontSize: "24px",
    fontWeight: 700,
  },
  version: {
    fontSize: "13px",
    color: "#9ca3af",
    fontFamily: "monospace",
  },
  tabBar: {
    display: "flex",
    gap: "0",
    borderBottom: "1px solid #e5e7eb",
    marginBottom: "24px",
  },
  tab: {
    padding: "12px 20px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#6b7280",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  activeTab: {
    color: "#2563eb",
    borderBottomColor: "#2563eb",
  },
  tabContent: {
    minHeight: "400px",
  },
  loading: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "300px",
    color: "#6b7280",
  },
  error: {
    padding: "24px",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    background: "#fef2f2",
    color: "#dc2626",
  },
}
