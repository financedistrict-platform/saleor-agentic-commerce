"use client"

import { useEffect, useMemo, useState } from "react"
import {
  PRISM_HANDLER_ID,
  DEFAULT_PRISM_HANDLER_CONFIG,
  DEFAULT_PRISM_HANDLER_ENTRY,
  type PaymentHandlerEntry,
  type PrismHandlerConfig,
} from "@/lib/metadata-keys"

type Props = {
  /** Map of handlerId → stored entry. Empty object on first load. */
  handlers: Record<string, PaymentHandlerEntry>
  /** Persist updated entries; key is handlerId, value is full replace. */
  onSave: (handlers: Record<string, PaymentHandlerEntry>) => Promise<void>
  saving: boolean
}

/**
 * Derive the merchant-portal "Manage in Prism →" deep link from the
 * configured gateway URL. Convention: prism-gw.<env> → prism.<env>.
 * Falls back to a stable default if the host doesn't match the convention.
 */
function deriveManageUrl(apiUrl: string): string {
  try {
    const u = new URL(apiUrl)
    if (u.hostname.startsWith("prism-gw.")) {
      u.hostname = u.hostname.replace(/^prism-gw\./, "prism.")
      u.pathname = "/"
      return u.origin + "/"
    }
  } catch {
    // ignore — fall through
  }
  return "https://prism.fd.xyz/"
}

export function PaymentHandlerSettings({ handlers, onSave, saving }: Props) {
  const stored = handlers[PRISM_HANDLER_ID] ?? null
  const storedConfig = (stored?.config ?? null) as PrismHandlerConfig | null

  const [enabled, setEnabled] = useState<boolean>(
    stored?.enabled ?? DEFAULT_PRISM_HANDLER_ENTRY.enabled,
  )
  const [apiUrl, setApiUrl] = useState<string>(
    storedConfig?.apiUrl ?? DEFAULT_PRISM_HANDLER_CONFIG.apiUrl,
  )
  const [apiKey, setApiKey] = useState<string>(
    storedConfig?.apiKey ?? DEFAULT_PRISM_HANDLER_CONFIG.apiKey,
  )

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  // Re-sync local state if the upstream `handlers` prop changes (e.g.
  // after a save round-trip refreshes the loaded config).
  useEffect(() => {
    if (!stored) return
    setEnabled(stored.enabled)
    if (storedConfig) {
      setApiUrl(storedConfig.apiUrl ?? DEFAULT_PRISM_HANDLER_CONFIG.apiUrl)
      setApiKey(storedConfig.apiKey ?? DEFAULT_PRISM_HANDLER_CONFIG.apiKey)
    }
  }, [stored, storedConfig])

  const manageUrl = useMemo(() => deriveManageUrl(apiUrl), [apiUrl])

  const dirty = useMemo(() => {
    const ref = stored ?? DEFAULT_PRISM_HANDLER_ENTRY
    const refConfig = (ref.config ?? {}) as PrismHandlerConfig
    return (
      enabled !== ref.enabled ||
      apiUrl !== (refConfig.apiUrl ?? DEFAULT_PRISM_HANDLER_CONFIG.apiUrl) ||
      apiKey !== (refConfig.apiKey ?? DEFAULT_PRISM_HANDLER_CONFIG.apiKey)
    )
  }, [stored, enabled, apiUrl, apiKey])

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      // Hit Prism's payment-profile endpoint to verify the API key is
      // valid against the configured gateway. Prism returns the merchant's
      // handler block on success (200), or 401 with an error message on
      // bad creds.
      const res = await fetch(
        `${apiUrl.replace(/\/$/, "")}/api/v2/merchant/payment-profile`,
        {
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
        },
      )
      if (res.ok) {
        setTestResult({
          success: true,
          message: "Connected to Prism. Credentials verified.",
        })
      } else {
        const body = await res.text().catch(() => "")
        setTestResult({
          success: false,
          message: `Prism returned ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
        })
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
      })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    const entry: PaymentHandlerEntry = {
      enabled,
      channels: stored?.channels ?? null,
      config: { apiUrl: apiUrl.trim(), apiKey: apiKey.trim() },
    }
    await onSave({ [PRISM_HANDLER_ID]: entry })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <p style={styles.description}>
        Payment handlers process agent transactions. Each handler is a
        separate service (Prism, Stripe, etc.); the Agentic Commerce App
        routes UCP/ACP traffic to whichever handlers you have enabled.
        Currently shipped: Finance District Prism (stablecoin payments via
        x402/EIP-3009).
      </p>

      {/* Prism Payment Handler */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h3 style={styles.cardTitle}>Prism Payment Handler</h3>
            <span style={styles.handlerId}>{PRISM_HANDLER_ID}</span>
          </div>
          <a
            href={manageUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.manageLink}
          >
            Manage in Prism →
          </a>
        </div>

        <div style={styles.form}>
          <label style={styles.toggleRow}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span style={styles.toggleLabel}>
              Enabled — route agent payments to Prism
            </span>
          </label>

          <div style={styles.field}>
            <label style={styles.label}>Prism Gateway URL</label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => {
                setApiUrl(e.target.value)
                setTestResult(null)
              }}
              placeholder="https://prism-gw.fd.xyz"
              style={styles.input}
            />
            <span style={styles.hint}>
              Override only when pointing at a self-hosted or test Prism
              instance.
            </span>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                setTestResult(null)
              }}
              placeholder="Your Prism API key"
              style={styles.input}
            />
            <span style={styles.hint}>
              Generated in your Prism merchant dashboard. All other settings
              (accepted chains, accepted tokens, settlement wallet, webhook
              secrets) are managed in Prism — use the &quot;Manage in
              Prism&quot; link above.
            </span>
          </div>

          <div style={styles.actionsRow}>
            <button
              onClick={testConnection}
              disabled={testing || !apiKey}
              style={styles.secondaryButton}
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              style={styles.primaryButton}
            >
              {saving ? "Saving..." : "Save"}
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
          + Additional payment handlers will be configurable here once the
          handler registry lands.
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
    gap: "16px",
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
  manageLink: {
    fontSize: "13px",
    color: "#2563eb",
    textDecoration: "none",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
  },
  toggleLabel: {
    fontSize: "14px",
    color: "#374151",
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
    lineHeight: "1.4",
  },
  actionsRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginTop: "8px",
    flexWrap: "wrap" as const,
  },
  primaryButton: {
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: 500,
    color: "#fff",
    background: "#2563eb",
    border: "1px solid #2563eb",
    borderRadius: "6px",
    cursor: "pointer",
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
