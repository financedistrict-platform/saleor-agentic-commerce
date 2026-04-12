"use client"

import { useState } from "react"
import type { PrismConfig } from "@/lib/metadata-keys"

type Props = {
  // Phase 2: Will receive current payment handler configs
  onSave?: (configs: unknown) => Promise<void>
}

const DEFAULT_PRISM_CONFIG: PrismConfig = {
  apiUrl: "https://prism-gw.fd.xyz",
  apiKey: "",
  webhookSecret: "",
  acceptedTokens: ["USDC"],
  acceptedChains: ["base"],
  merchantWallet: "",
}

const AVAILABLE_TOKENS = ["USDC", "FDUSD"]
const AVAILABLE_CHAINS = ["base", "bsc", "ethereum"]

export function PaymentHandlerSettings({ onSave }: Props) {
  const [prismConfig, setPrismConfig] = useState<PrismConfig>(DEFAULT_PRISM_CONFIG)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  const update = <K extends keyof PrismConfig>(
    key: K,
    value: PrismConfig[K]
  ) => {
    setPrismConfig((prev) => ({ ...prev, [key]: value }))
    setTestResult(null)
  }

  const toggleArrayItem = (
    key: "acceptedTokens" | "acceptedChains",
    item: string
  ) => {
    const current = prismConfig[key]
    const next = current.includes(item)
      ? current.filter((i) => i !== item)
      : [...current, item]
    update(key, next)
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)

    try {
      // Call Prism API to verify credentials
      const response = await fetch(
        `${prismConfig.apiUrl}/api/v2/merchant/payment-profile`,
        {
          headers: {
            Authorization: `Bearer ${prismConfig.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      )

      if (response.ok) {
        setTestResult({
          success: true,
          message: "Connection successful! Prism credentials verified.",
        })
      } else {
        setTestResult({
          success: false,
          message: `Connection failed: ${response.status} ${response.statusText}`,
        })
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <p style={styles.description}>
        Configure payment handlers that process agent payments. Currently
        supported: Finance District Prism (stablecoin payments via
        x402/EIP-3009).
      </p>

      {/* Prism Payment Handler */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h3 style={styles.cardTitle}>Prism Payment Handler</h3>
            <span style={styles.handlerId}>xyz.fd.prism_payment</span>
          </div>
        </div>

        <div style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Prism Gateway URL</label>
            <input
              type="text"
              value={prismConfig.apiUrl}
              onChange={(e) => update("apiUrl", e.target.value)}
              placeholder="https://prism-gw.fd.xyz"
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>API Key</label>
            <input
              type="password"
              value={prismConfig.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder="Your Prism API key"
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Webhook Secret</label>
            <input
              type="password"
              value={prismConfig.webhookSecret}
              onChange={(e) => update("webhookSecret", e.target.value)}
              placeholder="HMAC signing secret"
              style={styles.input}
            />
            <span style={styles.hint}>
              Used to verify incoming Prism webhook payloads
            </span>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Merchant Wallet Address</label>
            <input
              type="text"
              value={prismConfig.merchantWallet}
              onChange={(e) => update("merchantWallet", e.target.value)}
              placeholder="0x..."
              style={{ ...styles.input, fontFamily: "monospace" }}
            />
            <span style={styles.hint}>
              Settlement destination for stablecoin payments
            </span>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Accepted Tokens</label>
            <div style={styles.chipRow}>
              {AVAILABLE_TOKENS.map((token) => (
                <label key={token} style={styles.chip}>
                  <input
                    type="checkbox"
                    checked={prismConfig.acceptedTokens.includes(token)}
                    onChange={() => toggleArrayItem("acceptedTokens", token)}
                    style={{ display: "none" }}
                  />
                  <span
                    style={{
                      ...styles.chipLabel,
                      ...(prismConfig.acceptedTokens.includes(token)
                        ? styles.chipActive
                        : {}),
                    }}
                  >
                    {token}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Accepted Chains</label>
            <div style={styles.chipRow}>
              {AVAILABLE_CHAINS.map((chain) => (
                <label key={chain} style={styles.chip}>
                  <input
                    type="checkbox"
                    checked={prismConfig.acceptedChains.includes(chain)}
                    onChange={() => toggleArrayItem("acceptedChains", chain)}
                    style={{ display: "none" }}
                  />
                  <span
                    style={{
                      ...styles.chipLabel,
                      ...(prismConfig.acceptedChains.includes(chain)
                        ? styles.chipActive
                        : {}),
                    }}
                  >
                    {chain.charAt(0).toUpperCase() + chain.slice(1)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Test Connection */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginTop: "8px",
            }}
          >
            <button
              onClick={testConnection}
              disabled={testing || !prismConfig.apiKey}
              style={styles.secondaryButton}
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
            {testResult && (
              <span
                style={{
                  fontSize: "13px",
                  color: testResult.success ? "#059669" : "#dc2626",
                }}
              >
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Placeholder for additional handlers */}
      <div style={{ ...styles.card, borderStyle: "dashed", opacity: 0.6 }}>
        <p style={{ margin: 0, color: "#6b7280", textAlign: "center" }}>
          + Additional payment handlers coming soon
        </p>
      </div>
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
    padding: "20px",
    background: "#fff",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "20px",
  },
  cardTitle: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 600,
  },
  handlerId: {
    fontSize: "12px",
    color: "#9ca3af",
    fontFamily: "monospace",
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#374151",
  },
  input: {
    padding: "8px 12px",
    fontSize: "14px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    outline: "none",
  },
  hint: {
    fontSize: "12px",
    color: "#9ca3af",
  },
  chipRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  chip: {
    cursor: "pointer",
  },
  chipLabel: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: "16px",
    fontSize: "13px",
    fontWeight: 500,
    border: "1px solid #d1d5db",
    color: "#6b7280",
    background: "#fff",
    transition: "all 0.15s",
  },
  chipActive: {
    background: "#eff6ff",
    borderColor: "#2563eb",
    color: "#2563eb",
  },
  secondaryButton: {
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: 500,
    color: "#374151",
    background: "#f3f4f6",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    cursor: "pointer",
  },
}
