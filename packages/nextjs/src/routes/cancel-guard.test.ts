import { describe, expect, it } from "vitest"
import { SETTLEMENT_METADATA_KEY } from "@financedistrict/saleor-agentic-commerce-core"
import { cancelRefusal } from "./cancel-guard.js"

const ATTEMPT = { attemptId: "attempt-1", handlerId: "xyz.fd.prism_payment", startedAt: "2026-10-19T00:00:00.000Z" }

const RECORDS = {
  pending: { state: "pending", ...ATTEMPT, amount: 5497, currency: "USD", keys: ["k"] },
  held: { state: "held", ...ATTEMPT, code: "settlement_unresolved", reason: "it could not be confirmed", heldAt: "2026-10-19T00:00:01.000Z" },
  settled: { state: "settled", amount: 5497, currency: "USD", handlerId: ATTEMPT.handlerId, reference: "0xtx", settledAt: "2026-10-19T00:00:01.000Z" },
  failed: { state: "failed", attemptId: "attempt-1", amount: 5497, currency: "USD", reason: "insufficient_funds", failedAt: "2026-10-19T00:00:01.000Z" },
  unreadable: { state: "mystery" },
}

const withRecord = (record: object) => ({ [SETTLEMENT_METADATA_KEY]: record })

describe("cancelRefusal", () => {
  it("allows a cancel when no settlement is recorded", () => {
    expect(cancelRefusal({})).toBeNull()
  })

  it("allows a cancel after a declined payment", () => {
    expect(cancelRefusal(withRecord(RECORDS.failed))).toBeNull()
  })

  it.each([
    ["pending", "session_complete_in_progress"],
    ["held", "session_requires_escalation"],
    ["unreadable", "session_requires_escalation"],
    ["settled", "session_completed"],
  ] as const)("refuses a cancel while the settlement is %s", (state, code) => {
    expect(cancelRefusal(withRecord(RECORDS[state]))).toMatchObject({ code })
  })
})
