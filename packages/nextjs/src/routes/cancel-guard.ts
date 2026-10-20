import { metadataToRecord, readSettlementRecord } from "@financedistrict/saleor-agentic-commerce-core"
import type { AgenticCommerceInstance } from "../config.js"
import { RETRY_DELAYS_MS } from "./write-settlement-record.js"

export type CancelRefusal = { code: string; message: string }

export type CancelResult = { ok: true } | { ok: false; code: string; message: string; status: number }

const ROLLBACK_ATTEMPTS = RETRY_DELAYS_MS.length + 1

export function cancelRefusal(metadata: Record<string, unknown>): CancelRefusal | null {
  const settlement = readSettlementRecord(metadata)
  switch (settlement.kind) {
    case "absent":
    case "failed":
      return null
    case "pending":
      return { code: "session_complete_in_progress", message: "A payment for this checkout is still being confirmed, so the session cannot be changed or canceled." }
    case "ok":
      return { code: "session_completed", message: "A payment for this checkout has settled, so the session cannot be changed or canceled." }
    case "held":
    case "unreadable":
      return { code: "session_requires_escalation", message: "A payment for this checkout needs merchant review, so the session cannot be changed or canceled." }
  }
}

export async function cancelCheckout(
  saleorClient: AgenticCommerceInstance["saleorClient"],
  checkoutId: string,
  metadata: Record<string, unknown>,
  flagKey: string,
): Promise<CancelResult> {
  const refused = cancelRefusal(metadata)
  if (refused) return { ok: false, ...refused, status: 409 }

  const persisted = await saleorClient.updatePrivateMetadata(checkoutId, [
    { key: flagKey, value: "true" },
    { key: `${flagKey}_at`, value: new Date().toISOString() },
  ])
  if (!persisted.ok) return { ok: false, code: "cancel_persist_failed", message: persisted.error, status: 422 }

  const latest = await saleorClient.getCheckout(checkoutId)
  if (!latest.ok) {
    const notConfirmed = { code: "cancel_not_confirmed", message: `The cancel could not be confirmed: ${latest.error}. Retry the cancel.`, status: 503 }
    return rollBack(saleorClient, checkoutId, flagKey, notConfirmed)
  }
  const current = metadataToRecord(latest.data.privateMetadata)
  if (current[flagKey] !== true) {
    return { ok: false, code: "cancel_conflict", message: "Another change to this checkout replaced the cancel. Retry the cancel.", status: 409 }
  }
  const refusedLate = cancelRefusal(current)
  if (!refusedLate) return { ok: true }
  return rollBack(saleorClient, checkoutId, flagKey, { ...refusedLate, status: 409 })
}

async function rollBack(
  saleorClient: AgenticCommerceInstance["saleorClient"],
  checkoutId: string,
  flagKey: string,
  refusal: { code: string; message: string; status: number },
): Promise<CancelResult> {
  for (let tried = 0; tried < ROLLBACK_ATTEMPTS; tried++) {
    if (tried > 0) await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[tried - 1]))
    const reverted = await saleorClient.updatePrivateMetadata(checkoutId, [{ key: flagKey, value: "false" }])
    if (reverted.ok) return { ok: false, ...refusal }
  }
  console.error(`[cancel-guard] could not roll back ${flagKey} on checkout ${checkoutId} after refusing the cancel (${refusal.code})`)
  return {
    ok: false,
    code: "cancel_not_confirmed",
    message: "The cancel could not be confirmed or rolled back. A payment for this checkout may still complete with the same payment credential.",
    status: 503,
  }
}
