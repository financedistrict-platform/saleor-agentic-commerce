"use client"

import { useState } from "react"
import type { GlobalConfig } from "@/lib/metadata-keys"

type Props = {
  config: GlobalConfig
  onSave: (config: Partial<GlobalConfig>) => Promise<void>
  saving: boolean
}

export function GeneralSettings({ config, onSave, saving }: Props) {
  const [form, setForm] = useState<GlobalConfig>(config)
  const [dirty, setDirty] = useState(false)

  const update = <K extends keyof GlobalConfig>(
    key: K,
    value: GlobalConfig[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    await onSave(form)
    setDirty(false)
  }

  const regenerateApiKey = () => {
    const key = crypto.randomUUID().replace(/-/g, "")
    update("acpApiKey", `acp_${key}`)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Master Toggle */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Agentic Commerce</h3>
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => update("enabled", e.target.checked)}
            />
            <span>{form.enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
        <p style={styles.description}>
          When enabled, AI agents can discover and shop your store through
          UCP/ACP protocol endpoints.
        </p>
      </div>

      {/* Store Identity */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Store Identity</h3>
        <p style={styles.description}>
          How your store appears to AI agents during discovery.
        </p>
        <div style={styles.field}>
          <label style={styles.label}>Store Name</label>
          <input
            type="text"
            value={form.storeName}
            onChange={(e) => update("storeName", e.target.value)}
            placeholder="My Store"
            style={styles.input}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Store Description</label>
          <textarea
            value={form.storeDescription}
            onChange={(e) => update("storeDescription", e.target.value)}
            placeholder="A brief description of your store for AI agents..."
            rows={3}
            style={{ ...styles.input, resize: "vertical" }}
          />
        </div>
      </div>

      {/* Protocols */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Protocols</h3>
        <p style={styles.description}>
          Choose which agentic commerce protocols to enable.
        </p>
        <div style={{ display: "flex", gap: "24px" }}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.ucpEnabled}
              onChange={(e) => update("ucpEnabled", e.target.checked)}
            />
            <div>
              <strong>UCP</strong>
              <br />
              <span style={styles.hint}>
                Universal Commerce Protocol — open, browsable by any agent
              </span>
            </div>
          </label>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.acpEnabled}
              onChange={(e) => update("acpEnabled", e.target.checked)}
            />
            <div>
              <strong>ACP</strong>
              <br />
              <span style={styles.hint}>
                Agentic Commerce Protocol — authenticated agent-to-agent
              </span>
            </div>
          </label>
        </div>
      </div>

      {/* ACP API Key */}
      {form.acpEnabled && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>ACP Authentication</h3>
          <p style={styles.description}>
            API key for ACP Bearer token authentication. Share this with
            authorized agent platforms.
          </p>
          <div style={styles.field}>
            <label style={styles.label}>API Key</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={form.acpApiKey}
                readOnly
                style={{ ...styles.input, flex: 1, fontFamily: "monospace" }}
              />
              <button onClick={regenerateApiKey} style={styles.secondaryButton}>
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SDK Installation */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>SDK Setup</h3>
        <p style={styles.description}>
          Install the SDK in your storefront to serve UCP/ACP endpoints.
        </p>
        <pre style={styles.codeBlock}>
          {`npm install @financedistrict/saleor-agentic-commerce-core \\
  @financedistrict/saleor-agentic-commerce-nextjs`}
        </pre>
        <p style={styles.description}>
          With this App installed, use <code>configFromApp: true</code> in
          your SDK setup:
        </p>
        <pre style={styles.codeBlock}>
          {`const agenticCommerce = await createAgenticCommerce({
  saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
  saleorAuthToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
  storefrontUrl: process.env.NEXT_PUBLIC_STOREFRONT_URL!,
  configFromApp: true,
})`}
        </pre>
      </div>

      {/* Save Button */}
      {dirty && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={styles.primaryButton}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "20px",
    background: "#fff",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: {
    margin: "0 0 8px",
    fontSize: "16px",
    fontWeight: 600,
  },
  description: {
    margin: "0 0 16px",
    fontSize: "14px",
    color: "#6b7280",
    lineHeight: "1.5",
  },
  field: {
    marginBottom: "16px",
  },
  label: {
    display: "block",
    marginBottom: "6px",
    fontSize: "13px",
    fontWeight: 500,
    color: "#374151",
  },
  input: {
    width: "100%",
    padding: "8px 12px",
    fontSize: "14px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
    fontSize: "14px",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    cursor: "pointer",
    flex: 1,
  },
  hint: {
    fontSize: "12px",
    color: "#9ca3af",
  },
  codeBlock: {
    background: "#f3f4f6",
    padding: "12px 16px",
    borderRadius: "6px",
    fontSize: "13px",
    fontFamily: "monospace",
    overflow: "auto",
    lineHeight: "1.5",
    margin: "0 0 16px",
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
  secondaryButton: {
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: 500,
    color: "#374151",
    background: "#f3f4f6",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
}
