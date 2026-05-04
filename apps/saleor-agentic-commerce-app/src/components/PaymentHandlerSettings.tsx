"use client"

import { useEffect, useMemo, useState } from "react"
import {
  PRISM_HANDLER_ID,
  type HandlerManifest,
  type PaymentHandlerEntry,
} from "@/lib/metadata-keys"

type Props = {
  /** Map of handlerId → stored entry. Empty object on first load. */
  handlers: Record<string, PaymentHandlerEntry>
  /** Persist updated entries; key is handlerId, value is full replace. */
  onSave: (handlers: Record<string, PaymentHandlerEntry>) => Promise<void>
  saving: boolean
  /**
   * Saleor API URL of the dashboard session. Forwarded to internal API
   * routes so they can resolve the correct App auth context.
   */
  saleorApiUrl: string
}

// =====================================================
// Top-level
// =====================================================

export function PaymentHandlerSettings({
  handlers,
  onSave,
  saving,
  saleorApiUrl,
}: Props) {
  const entries = Object.entries(handlers)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <p style={styles.description}>
        Payment handlers process agent transactions. Each handler is a
        separate package the storefront has installed; the App reads each
        handler&apos;s self-registered manifest and renders the
        configuration form below.
      </p>

      {entries.length === 0 ? (
        <div style={styles.emptyState}>
          <h3 style={{ margin: "0 0 8px", color: "#374151" }}>
            No handlers registered yet
          </h3>
          <p style={{ margin: 0, color: "#6b7280", fontSize: "14px" }}>
            Install a handler package in your storefront (e.g.{" "}
            <code>@financedistrict/saleor-prism-payment</code>) and call{" "}
            <code>registerHandler()</code> at boot. The handler will appear
            here automatically.
          </p>
        </div>
      ) : (
        entries.map(([handlerId, entry]) => (
          <HandlerCard
            key={handlerId}
            handlerId={handlerId}
            entry={entry}
            onSave={(updated) => onSave({ [handlerId]: updated })}
            saving={saving}
            saleorApiUrl={saleorApiUrl}
          />
        ))
      )}
    </div>
  )
}

// =====================================================
// Per-handler card
// =====================================================

type HandlerCardProps = {
  handlerId: string
  entry: PaymentHandlerEntry
  onSave: (entry: PaymentHandlerEntry) => Promise<void>
  saving: boolean
  saleorApiUrl: string
}

function HandlerCard({
  handlerId,
  entry,
  onSave,
  saving,
  saleorApiUrl,
}: HandlerCardProps) {
  const manifest = entry.manifest
  const initialConfig = (entry.config ?? {}) as Record<string, unknown>

  const [enabled, setEnabled] = useState(entry.enabled)
  const [config, setConfig] = useState<Record<string, unknown>>(initialConfig)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  // Re-sync if upstream entry changes (e.g. after save round-trip).
  useEffect(() => {
    setEnabled(entry.enabled)
    setConfig((entry.config ?? {}) as Record<string, unknown>)
    setTestResult(null)
  }, [entry])

  const dirty = useMemo(() => {
    if (enabled !== entry.enabled) return true
    return JSON.stringify(config) !== JSON.stringify(initialConfig)
    // initialConfig is stable per render — ESLint will whine but that's fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, config, entry])

  const title = manifest?.displayName ?? handlerId
  const description = manifest?.description
  const manageUrl = manifest?.manageUrl
  const version = manifest?.version

  // Test Connection is currently only wired for Prism (the test-connection
  // proxy hardcodes the probe URL by handlerId). When we add a generic
  // probe mechanism (manifest capability flag + per-handler probe URL),
  // this widens.
  const supportsTestConnection = handlerId === PRISM_HANDLER_ID

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(
        `/api/payment-handlers/test-connection?saleorApiUrl=${encodeURIComponent(saleorApiUrl)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handlerId,
            apiUrl: (config.apiUrl as string | undefined)?.trim(),
            apiKey: (config.apiKey as string | undefined)?.trim(),
          }),
        },
      )
      if (!res.ok) {
        setTestResult({
          success: false,
          message: `Proxy returned ${res.status}`,
        })
        return
      }
      const body = (await res.json()) as { ok: boolean; message: string }
      setTestResult({ success: body.ok, message: body.message })
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
    await onSave({
      enabled,
      channels: entry.channels ?? null,
      config,
      ...(manifest ? { manifest } : {}),
    })
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <h3 style={styles.cardTitle}>{title}</h3>
          <span style={styles.handlerId}>
            {handlerId}
            {version ? ` · v${version}` : ""}
          </span>
        </div>
        {manageUrl && (
          <a
            href={manageUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.manageLink}
          >
            Manage in {title} →
          </a>
        )}
      </div>

      {description && (
        <p style={styles.handlerDescription}>{description}</p>
      )}

      <div style={styles.form}>
        <label style={styles.toggleRow}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span style={styles.toggleLabel}>
            Enabled — route agent payments to this handler
          </span>
        </label>

        {manifest?.configSchema ? (
          <SchemaForm
            schema={manifest.configSchema}
            value={config}
            onChange={(v) => {
              setConfig(v)
              setTestResult(null)
            }}
          />
        ) : (
          <div style={styles.noSchemaNote}>
            This handler hasn&apos;t published a configuration schema. Use
            environment variables on the storefront, or update the handler
            package to include a <code>configSchema</code> in its manifest.
          </div>
        )}

        <div style={styles.actionsRow}>
          {supportsTestConnection && (
            <button
              onClick={testConnection}
              disabled={testing || !config.apiKey}
              style={styles.secondaryButton}
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
          )}
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
  )
}

// =====================================================
// JSON Schema form renderer
// =====================================================

/**
 * Minimal JSON Schema form renderer. Supports the subset of Draft
 * 2020-12 used by handler config schemas:
 *
 * - Object root with `properties` and `required`
 * - Property types: string, integer, number, boolean
 * - String formats: password (→ password input), uri (→ url input)
 * - String enum (→ select dropdown)
 * - `default`, `title`, `description`
 *
 * Falls through gracefully on shapes it doesn't know — renders a JSON
 * code block as a debugging fallback. Worth replacing with
 * `react-jsonschema-form` if we need richer features (nested objects,
 * arrays, oneOf, conditional schemas, etc.); current impl covers
 * everything Prism + Dummy declare.
 */
function SchemaForm({
  schema,
  value,
  onChange,
}: {
  schema: Record<string, unknown>
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  const properties = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >
  const required = (schema.required ?? []) as string[]

  if (Object.keys(properties).length === 0) {
    return (
      <pre style={styles.codeBlock}>
        {JSON.stringify(schema, null, 2)}
      </pre>
    )
  }

  function update<K extends string>(key: K, v: unknown) {
    onChange({ ...value, [key]: v })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {Object.entries(properties).map(([key, prop]) => {
        const type = prop.type as string | undefined
        const title = (prop.title as string) ?? key
        const desc = prop.description as string | undefined
        const format = prop.format as string | undefined
        const enumValues = prop.enum as unknown[] | undefined
        const def = prop.default
        const isRequired = required.includes(key)
        const current = value[key] ?? def

        // Enum → select
        if (Array.isArray(enumValues) && enumValues.length > 0) {
          return (
            <div key={key} style={styles.field}>
              <label style={styles.label}>
                {title}
                {isRequired && <span style={styles.requiredMark}> *</span>}
              </label>
              <select
                value={(current as string | undefined) ?? ""}
                onChange={(e) => update(key, e.target.value)}
                style={styles.input}
              >
                {enumValues.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
              {desc && <span style={styles.hint}>{desc}</span>}
            </div>
          )
        }

        // Boolean → checkbox
        if (type === "boolean") {
          return (
            <div key={key} style={styles.field}>
              <label style={{ ...styles.toggleRow, gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={Boolean(current)}
                  onChange={(e) => update(key, e.target.checked)}
                />
                <span style={styles.toggleLabel}>{title}</span>
              </label>
              {desc && <span style={styles.hint}>{desc}</span>}
            </div>
          )
        }

        // Integer / number
        if (type === "integer" || type === "number") {
          return (
            <div key={key} style={styles.field}>
              <label style={styles.label}>
                {title}
                {isRequired && <span style={styles.requiredMark}> *</span>}
              </label>
              <input
                type="number"
                step={type === "integer" ? 1 : "any"}
                value={
                  current === undefined || current === null
                    ? ""
                    : String(current)
                }
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === "") {
                    update(key, undefined)
                    return
                  }
                  const parsed =
                    type === "integer"
                      ? parseInt(raw, 10)
                      : parseFloat(raw)
                  update(key, Number.isFinite(parsed) ? parsed : undefined)
                }}
                style={styles.input}
              />
              {desc && <span style={styles.hint}>{desc}</span>}
            </div>
          )
        }

        // String (default)
        const inputType =
          format === "password"
            ? "password"
            : format === "uri" || format === "url"
              ? "url"
              : "text"

        return (
          <div key={key} style={styles.field}>
            <label style={styles.label}>
              {title}
              {isRequired && <span style={styles.requiredMark}> *</span>}
            </label>
            <input
              type={inputType}
              value={(current as string | undefined) ?? ""}
              onChange={(e) => update(key, e.target.value)}
              placeholder={
                typeof def === "string" ? (def as string) : undefined
              }
              style={styles.input}
            />
            {desc && <span style={styles.hint}>{desc}</span>}
          </div>
        )
      })}
    </div>
  )
}

// =====================================================
// Styles
// =====================================================

const styles: Record<string, React.CSSProperties> = {
  description: {
    margin: "0 0 8px",
    fontSize: "14px",
    color: "#6b7280",
    lineHeight: "1.5",
  },
  emptyState: {
    border: "1px dashed #d1d5db",
    borderRadius: "8px",
    padding: "32px 24px",
    textAlign: "center" as const,
    background: "#fafafa",
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
    marginBottom: "12px",
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
  handlerDescription: {
    margin: "0 0 16px",
    fontSize: "13px",
    color: "#6b7280",
    lineHeight: "1.5",
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
  requiredMark: {
    color: "#dc2626",
    marginLeft: "2px",
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
  noSchemaNote: {
    padding: "12px 16px",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "6px",
    fontSize: "13px",
    color: "#92400e",
    lineHeight: "1.5",
  },
  codeBlock: {
    padding: "12px",
    background: "#f3f4f6",
    borderRadius: "6px",
    fontSize: "12px",
    fontFamily: "monospace",
    overflow: "auto",
    margin: 0,
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
