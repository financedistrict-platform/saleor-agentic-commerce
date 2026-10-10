import {
  canTransition,
  failedSettlementRecord,
  metadataToRecord,
  readSettlementRecord,
  settledSettlementRecord,
  settlementReplayKey,
} from "@financedistrict/saleor-agentic-commerce-core"
import type { AgenticCommerceInstance } from "../config.js"
import { writeSettlementRecord } from "./write-settlement-record.js"

export type PendingSettlementOutcome = { settled: true; reference: string } | { settled: false }

export type ResolvePendingSettlementResult =
  | { ok: true; state: "settled" | "failed" }
  | { ok: false; code: "checkout_not_found" | "not_pending" | "invalid_reference" | "reference_already_used" | "not_recorded"; error: string }

export async function resolvePendingSettlement(
  instance: Pick<AgenticCommerceInstance, "saleorClient" | "paymentReplayStore">,
  checkoutId: string,
  outcome: PendingSettlementOutcome,
): Promise<ResolvePendingSettlementResult> {
  const { saleorClient, paymentReplayStore } = instance
  const checkout = await saleorClient.getCheckout(checkoutId)
  if (!checkout.ok) return { ok: false, code: "checkout_not_found", error: checkout.error }

  const current = readSettlementRecord(metadataToRecord(checkout.data.privateMetadata))
  if (current.kind !== "pending") return { ok: false, code: "not_pending", error: `Checkout ${checkoutId} has no pending settlement (record is ${current.kind})` }
  const { pending } = current

  if (outcome.settled) {
    if (typeof outcome.reference !== "string" || outcome.reference.length === 0) {
      return { ok: false, code: "invalid_reference", error: "A settled outcome needs the transaction reference reported by the gateway" }
    }
    if (!canTransition(current, "settled")) return { ok: false, code: "not_pending", error: `Checkout ${checkoutId} cannot be marked settled` }
    const claim = await paymentReplayStore.claim([settlementReplayKey(pending.handlerId, outcome.reference)], checkoutId)
    if (!claim.ok) return { ok: false, code: "reference_already_used", error: `Reference ${outcome.reference} is already used by checkout ${claim.heldBy}` }
    const written = await writeSettlementRecord(
      saleorClient,
      checkoutId,
      settledSettlementRecord({
        amount: pending.amount,
        currency: pending.currency,
        handlerId: pending.handlerId,
        reference: outcome.reference,
        settledAt: new Date().toISOString(),
      }),
    )
    return written.ok ? { ok: true, state: "settled" } : { ok: false, code: "not_recorded", error: written.error }
  }

  if (!canTransition(current, "failed", pending.attemptId)) return { ok: false, code: "not_pending", error: `Checkout ${checkoutId} cannot be marked failed` }
  const written = await writeSettlementRecord(
    saleorClient,
    checkoutId,
    failedSettlementRecord({ attemptId: pending.attemptId, amount: pending.amount, currency: pending.currency, reason: "resolved as not settled", failedAt: new Date().toISOString() }),
  )
  return written.ok ? { ok: true, state: "failed" } : { ok: false, code: "not_recorded", error: written.error }
}
