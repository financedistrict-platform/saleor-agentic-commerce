"use client"

/**
 * Activity Dashboard (Phase 4)
 *
 * Placeholder component for the Activity tab.
 * Will show recent agent checkout sessions, agent analytics,
 * and links to completed orders.
 */
export function ActivityDashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <p style={styles.description}>
        Monitor AI agent activity on your store — checkout sessions,
        completed orders, and conversion metrics.
      </p>

      {/* Placeholder stats */}
      <div style={styles.statsRow}>
        <div style={styles.statCard}>
          <span style={styles.statValue}>—</span>
          <span style={styles.statLabel}>Agent Sessions (7d)</span>
        </div>
        <div style={styles.statCard}>
          <span style={styles.statValue}>—</span>
          <span style={styles.statLabel}>Completed Orders (7d)</span>
        </div>
        <div style={styles.statCard}>
          <span style={styles.statValue}>—</span>
          <span style={styles.statLabel}>Conversion Rate</span>
        </div>
        <div style={styles.statCard}>
          <span style={styles.statValue}>—</span>
          <span style={styles.statLabel}>Agent GMV (7d)</span>
        </div>
      </div>

      {/* Empty state */}
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>📊</div>
        <h3 style={{ margin: "0 0 8px", color: "#374151" }}>
          Activity tracking coming soon
        </h3>
        <p style={{ margin: 0, color: "#6b7280", fontSize: "14px" }}>
          Once agents start shopping your store, their activity will appear
          here. Install the SDK and enable agentic commerce to get started.
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
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "16px",
  },
  statCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "20px",
    background: "#fff",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "4px",
  },
  statValue: {
    fontSize: "28px",
    fontWeight: 700,
    color: "#1a1a1a",
  },
  statLabel: {
    fontSize: "12px",
    color: "#6b7280",
    textAlign: "center" as const,
  },
  emptyState: {
    border: "1px dashed #d1d5db",
    borderRadius: "8px",
    padding: "48px 24px",
    textAlign: "center" as const,
    background: "#fafafa",
  },
  emptyIcon: {
    fontSize: "48px",
    marginBottom: "16px",
  },
}
