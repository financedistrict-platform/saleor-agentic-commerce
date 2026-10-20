"use client"

import { useEffect, useState } from "react"
import { useAppBridge } from "@saleor/app-sdk/app-bridge"
import { useDashboardFetch } from "@/lib/dashboard-fetch"
import { KEYS } from "@/lib/metadata-keys"
import type { AgentSessionMetadata } from "@/lib/metadata-keys"
import {
  type SettlementSummary,
  netReceivedText,
  refundLimitText,
} from "@/lib/settlement-summary"

const SETTLEMENT_TIMEOUT_MS = 8000

function readOrderId(): string | null {
  return new URLSearchParams(window.location.search).get("orderId")
}

function SettlementSection({ summary }: { summary: SettlementSummary | null }) {
  if (summary?.state === "none") return null
  return (
    <div style={styles.settlement}>
      <div style={styles.settlementHeading}>Prism settlement</div>
      <table style={styles.table}>
        <tbody>
          <tr>
            <td style={styles.labelCell}>Net received</td>
            <td style={styles.valueCell}>{summary ? netReceivedText(summary) : "…"}</td>
          </tr>
          <tr>
            <td style={styles.labelCell}>Refund up to</td>
            <td style={styles.valueCell}>{summary ? refundLimitText(summary) : "…"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/**
 * Order Agent Info Widget
 *
 * Embedded in the Saleor Dashboard order detail page.
 * Shows whether the order was placed by an AI agent and
 * the agent's attribution details.
 */
export default function OrderAgentInfoWidget() {
  const [agentSession, setAgentSession] = useState<AgentSessionMetadata | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<SettlementSummary | null>(null)
  const { appBridgeState } = useAppBridge()
  const dashboardFetch = useDashboardFetch()
  const [orderId, setOrderId] = useState<string | null>(null)

  useEffect(() => {
    setOrderId(readOrderId())
  }, [])

  useEffect(() => {
    if (!appBridgeState?.ready || !orderId) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await dashboardFetch(
          `/api/order-settlement?orderId=${encodeURIComponent(orderId)}`
        )
        const next: SettlementSummary = res.ok
          ? await res.json()
          : { state: "unavailable" }
        if (!cancelled) setSummary(next)
      } catch {
        if (!cancelled) setSummary({ state: "unavailable" })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [appBridgeState?.ready, orderId, dashboardFetch])

  useEffect(() => {
    if (!orderId) return
    const timer = window.setTimeout(
      () => setSummary((current) => current ?? { state: "unavailable" }),
      SETTLEMENT_TIMEOUT_MS
    )
    return () => window.clearTimeout(timer)
  }, [orderId])

  useEffect(() => {
    // The Dashboard passes order metadata via postMessage
    // or we can extract order ID from the URL and fetch it
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "order-metadata") {
        const metadata = event.data.metadata as Array<{
          key: string
          value: string
        }>
        const sessionEntry = metadata?.find(
          (m) => m.key === KEYS.agentSession
        )

        if (sessionEntry) {
          try {
            setAgentSession(JSON.parse(sessionEntry.value))
          } catch {
            setAgentSession(null)
          }
        }
        setLoading(false)
      }
    }

    window.addEventListener("message", handleMessage)
    setLoading(false) // Don't block if no message comes

    return () => window.removeEventListener("message", handleMessage)
  }, [])

  if (loading) {
    return <div style={styles.container}>Loading...</div>
  }

  if (!agentSession) {
    return (
      <div style={styles.container}>
        <span style={styles.badge}>Human Order</span>
        <p style={styles.hint}>
          This order was not placed by an AI agent.
        </p>
        {orderId && <SettlementSection summary={summary} />}
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <span style={styles.agentBadge}>AI Agent Order</span>

      <table style={styles.table}>
        <tbody>
          <tr>
            <td style={styles.labelCell}>Protocol</td>
            <td style={styles.valueCell}>
              {agentSession.protocol.toUpperCase()}
            </td>
          </tr>
          {agentSession.agentProfileUrl && (
            <tr>
              <td style={styles.labelCell}>Agent Profile</td>
              <td style={styles.valueCell}>
                <a
                  href={agentSession.agentProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  {agentSession.agentProfileUrl}
                </a>
              </td>
            </tr>
          )}
          {agentSession.userAgent && (
            <tr>
              <td style={styles.labelCell}>User Agent</td>
              <td style={{ ...styles.valueCell, fontFamily: "monospace", fontSize: "12px" }}>
                {agentSession.userAgent}
              </td>
            </tr>
          )}
          <tr>
            <td style={styles.labelCell}>Session Started</td>
            <td style={styles.valueCell}>
              {new Date(agentSession.timestamp).toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>
      {orderId && <SettlementSection summary={summary} />}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "16px",
    fontSize: "14px",
  },
  badge: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: "12px",
    fontSize: "12px",
    fontWeight: 500,
    background: "#f3f4f6",
    color: "#6b7280",
    marginBottom: "8px",
  },
  agentBadge: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: "12px",
    fontSize: "12px",
    fontWeight: 600,
    background: "#eff6ff",
    color: "#2563eb",
    marginBottom: "12px",
  },
  hint: {
    margin: 0,
    fontSize: "13px",
    color: "#9ca3af",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  },
  labelCell: {
    padding: "6px 12px 6px 0",
    fontSize: "13px",
    fontWeight: 500,
    color: "#6b7280",
    verticalAlign: "top",
    whiteSpace: "nowrap" as const,
    width: "120px",
  },
  valueCell: {
    padding: "6px 0",
    fontSize: "13px",
    color: "#1a1a1a",
    wordBreak: "break-all" as const,
  },
  settlement: {
    marginTop: "12px",
  },
  settlementHeading: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#1a1a1a",
    marginBottom: "4px",
  },
  link: {
    color: "#2563eb",
    textDecoration: "none",
  },
}
