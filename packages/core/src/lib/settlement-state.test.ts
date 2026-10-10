import { describe, expect, it } from "vitest"
import {
  canTransition,
  failedSettlementRecord,
  heldSettlementRecord,
  parseSettlementRecord,
  pendingSettlementRecord,
  readSettlementRecord,
  settledSettlementRecord,
  SETTLEMENT_METADATA_KEY,
} from "./payment-reconciliation.js"
import type { SettlementRead } from "./payment-reconciliation.js"

const PENDING = {
  attemptId: "attempt-1",
  handlerId: "test.pay",
  keys: ["k1", "k2"],
  amount: 5497,
  currency: "USD",
  startedAt: "2026-10-09T00:00:00.000Z",
  details: { network: "eip155:84532", payer: "0xbuyer", nonce: "0x01" },
}

const SETTLED = { amount: 5497, currency: "USD", handlerId: "test.pay", reference: "0xtx", settledAt: "2026-10-09T00:00:00.000Z" }

const HELD = {
  attemptId: "attempt-1",
  handlerId: "test.pay",
  startedAt: "2026-10-09T00:00:00.000Z",
  reference: "0xtx",
  code: "settled_payment_mismatch",
  reason: "it did not match",
  heldAt: "2026-10-09T00:00:01.000Z",
  details: { network: "eip155:84532", payer: "0xbuyer", nonce: "0x01" },
}

describe("settlement record states", () => {
  it("reads a record without a state as settled", () => {
    expect(parseSettlementRecord(SETTLED)).toEqual({ kind: "ok", record: SETTLED })
  })

  it("reads each written state back", () => {
    expect(parseSettlementRecord(settledSettlementRecord(SETTLED))).toEqual({ kind: "ok", record: SETTLED })
    expect(parseSettlementRecord(pendingSettlementRecord(PENDING))).toEqual({ kind: "pending", pending: PENDING })
    expect(parseSettlementRecord(heldSettlementRecord(HELD))).toEqual({ kind: "held", held: HELD })
    expect(parseSettlementRecord(failedSettlementRecord({ attemptId: "attempt-1", amount: 5497, currency: "USD", reason: "declined", failedAt: HELD.heldAt }))).toEqual({
      kind: "failed",
      money: { amount: 5497, currency: "USD" },
    })
  })

  it("reads a failed record written without an amount, and keeps it without one", () => {
    expect(parseSettlementRecord({ state: "failed", attemptId: "attempt-1", reason: "declined", failedAt: HELD.heldAt })).toEqual({ kind: "failed", money: null })
  })

  it("reads a pending record without details", () => {
    const { details: _details, ...bare } = PENDING
    expect(parseSettlementRecord(pendingSettlementRecord(bare))).toEqual({ kind: "pending", pending: bare })
  })

  it("keeps the expiry of a pending settlement", () => {
    const pending = { ...PENDING, expiresAt: "2026-10-09T00:05:00.000Z" }
    expect(parseSettlementRecord(pendingSettlementRecord(pending))).toEqual({ kind: "pending", pending })
  })

  it("finds the record under the settlement metadata key", () => {
    expect(readSettlementRecord({ [SETTLEMENT_METADATA_KEY]: pendingSettlementRecord(PENDING) })).toMatchObject({ kind: "pending" })
    expect(readSettlementRecord({})).toEqual({ kind: "absent" })
  })

  it.each([
    ["an unknown state", { ...SETTLED, state: "refunded" }],
    ["a pending record without an attempt", { ...pendingSettlementRecord(PENDING), attemptId: undefined }],
    ["a pending record with keys that are not strings", { ...pendingSettlementRecord(PENDING), keys: [1] }],
    ["a pending record with details that are not strings", { ...pendingSettlementRecord(PENDING), details: { nonce: 1 } }],
    ["a pending record with details that are not an object", { ...pendingSettlementRecord(PENDING), details: ["0x01"] }],
    ["a held record without the attempt that submitted it", { ...heldSettlementRecord(HELD), attemptId: undefined }],
    ["a pending record without an amount", { ...pendingSettlementRecord(PENDING), amount: undefined }],
    ["a held record without a reference", { ...heldSettlementRecord(HELD), reference: "" }],
    ["a held record without a code", { ...heldSettlementRecord(HELD), code: undefined }],
    ["a failed record without an attempt", { state: "failed" }],
    ["a settled record without an amount", { state: "settled", handlerId: "test.pay", reference: "0xtx", settledAt: HELD.heldAt }],
    ["a value that is not an object", "pending"],
  ])("cannot read %s", (_case, raw) => {
    expect(parseSettlementRecord(raw).kind).toBe("unreadable")
  })
})

describe("settlement transitions", () => {
  const read = (kind: SettlementRead["kind"]): SettlementRead => {
    switch (kind) {
      case "absent": return { kind: "absent" }
      case "unreadable": return { kind: "unreadable", raw: null }
      case "ok": return { kind: "ok", record: SETTLED }
      case "pending": return { kind: "pending", pending: PENDING }
      case "held": return { kind: "held", held: HELD }
      case "failed": return { kind: "failed", money: null }
    }
  }

  it.each([
    ["absent", true],
    ["failed", true],
    ["pending", false],
    ["ok", false],
    ["held", false],
    ["unreadable", false],
  ] as const)("starting an attempt from %s is %s", (kind, allowed) => {
    expect(canTransition(read(kind), "pending")).toBe(allowed)
  })

  it.each(["settled", "held"] as const)("moves a pending settlement to %s whichever attempt resolves it", (next) => {
    expect(canTransition(read("pending"), next)).toBe(true)
    expect(canTransition(read("pending"), next, "another-attempt")).toBe(true)
  })

  it.each(["absent", "failed", "ok", "held", "unreadable"] as const)("never moves a %s settlement to settled, held or failed", (kind) => {
    expect(canTransition(read(kind), "settled")).toBe(false)
    expect(canTransition(read(kind), "held")).toBe(false)
    expect(canTransition(read(kind), "failed", PENDING.attemptId)).toBe(false)
  })

  it("lets only the attempt that owns a pending settlement fail it", () => {
    expect(canTransition(read("pending"), "failed", "attempt-1")).toBe(true)
    expect(canTransition(read("pending"), "failed", "attempt-2")).toBe(false)
    expect(canTransition(read("pending"), "failed")).toBe(false)
  })
})
