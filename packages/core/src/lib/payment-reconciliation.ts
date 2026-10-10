import { AmountPrecisionError, UnsupportedCurrencyError, fromMinor, isSupportedCurrency, toMinor } from "./money.js"
import type { SaleorMoney } from "../types/saleor.js"

export const PAYMENT_QUOTE_METADATA_KEY = "agentic_commerce__quote"
export const SETTLEMENT_METADATA_KEY = "agentic_commerce__settlement"
export const PAYMENT_QUOTE_TTL_MS = 15 * 60 * 1000

export type MinorMoney = {
  amount: number
  currency: string
}

export type PaymentQuote = MinorMoney & {
  quotedAt: string
}

export type SettlementRecord = MinorMoney & {
  handlerId: string
  reference: string
  settledAt: string
}

export type SettlementState = "pending" | "settled" | "held" | "failed"

export type SettlementAttempt = {
  attemptId: string
  handlerId: string
  startedAt: string
  expiresAt?: string
  details?: Readonly<Record<string, string>>
}

export type PendingSettlement = MinorMoney & SettlementAttempt & {
  keys: readonly string[]
}

export type HeldSettlement = SettlementAttempt & {
  reference: string
  code: string
  reason: string
  heldAt: string
}

export type FailedSettlement = MinorMoney & {
  attemptId: string
  reason: string
  failedAt: string
}

export type SettlementRead =
  | { kind: "absent" }
  | { kind: "unreadable"; raw: unknown }
  | { kind: "ok"; record: SettlementRecord }
  | { kind: "pending"; pending: PendingSettlement }
  | { kind: "held"; held: HeldSettlement }
  | { kind: "failed"; money: MinorMoney | null }

export type MoneyErrorCode = "unsupported_currency" | "amount_precision_invalid"

export type QuoteResult =
  | { ok: true; quote: PaymentQuote }
  | { ok: false; code: MoneyErrorCode; message: string }

export type ReconciliationErrorCode =
  | MoneyErrorCode
  | "payment_quote_missing"
  | "payment_quote_stale"
  | "payment_quote_expired"
  | "order_total_changed_after_settlement"

export type ReconciliationResult =
  | { ok: true; payable: MinorMoney }
  | { ok: false; code: ReconciliationErrorCode; message: string }

export function quoteForTotal(total: SaleorMoney, now: Date = new Date()): QuoteResult {
  try {
    return { ok: true, quote: { amount: toMinor(total), currency: total.currency, quotedAt: now.toISOString() } }
  } catch (error) {
    if (error instanceof UnsupportedCurrencyError || error instanceof AmountPrecisionError) {
      return { ok: false, code: error.code, message: error.message }
    }
    throw error
  }
}

export function minorToSaleorMoney(money: MinorMoney): SaleorMoney {
  return fromMinor(money.amount, money.currency)
}

export function readPaymentQuote(metadata: Record<string, unknown>): PaymentQuote | null {
  const raw = metadata[PAYMENT_QUOTE_METADATA_KEY]
  const money = readMinorMoney(raw)
  if (!money) return null
  const { quotedAt } = raw as Record<string, unknown>
  if (typeof quotedAt !== "string" || Number.isNaN(Date.parse(quotedAt))) return null
  return { ...money, quotedAt }
}

export function readSettlementRecord(metadata: Record<string, unknown>): SettlementRead {
  if (!(SETTLEMENT_METADATA_KEY in metadata)) return { kind: "absent" }
  return parseSettlementRecord(metadata[SETTLEMENT_METADATA_KEY])
}

export function parseSettlementRecord(raw: unknown): SettlementRead {
  if (typeof raw !== "object" || raw === null) return { kind: "unreadable", raw }
  const { state } = raw as Record<string, unknown>
  if (state === undefined || state === "settled") return parseSettled(raw)
  if (state === "pending") return parsePending(raw)
  if (state === "held") return parseHeld(raw)
  if (state === "failed") return parseFailed(raw)
  return { kind: "unreadable", raw }
}

function parseSettled(raw: object): SettlementRead {
  const unreadable = { kind: "unreadable" as const, raw }
  const money = readMinorMoney(raw)
  if (!money) return unreadable
  const record = raw as Record<string, unknown>
  if (typeof record.reference !== "string" || record.reference.length === 0) return unreadable
  if (typeof record.handlerId !== "string" || typeof record.settledAt !== "string") return unreadable
  return { kind: "ok", record: { ...money, handlerId: record.handlerId, reference: record.reference, settledAt: record.settledAt } }
}

function parsePending(raw: object): SettlementRead {
  const money = readMinorMoney(raw)
  const attempt = readAttempt(raw as Record<string, unknown>)
  const { keys } = raw as Record<string, unknown>
  if (!money || !attempt || !Array.isArray(keys) || !keys.every(isNonEmptyString)) return { kind: "unreadable", raw }
  return { kind: "pending", pending: { ...money, ...attempt, keys } }
}

function parseHeld(raw: object): SettlementRead {
  const record = raw as Record<string, unknown>
  const attempt = readAttempt(record)
  if (!attempt || !isNonEmptyString(record.reference) || !isNonEmptyString(record.code) || typeof record.reason !== "string" || !isNonEmptyString(record.heldAt)) {
    return { kind: "unreadable", raw }
  }
  return { kind: "held", held: { ...attempt, reference: record.reference, code: record.code, reason: record.reason, heldAt: record.heldAt } }
}

function readAttempt(record: Record<string, unknown>): SettlementAttempt | null {
  const { attemptId, handlerId, startedAt, expiresAt, details } = record
  if (!isNonEmptyString(attemptId) || !isNonEmptyString(handlerId) || !isNonEmptyString(startedAt)) return null
  if (expiresAt !== undefined && !isNonEmptyString(expiresAt)) return null
  if (details !== undefined && !isStringMap(details)) return null
  return {
    attemptId,
    handlerId,
    startedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(details === undefined ? {} : { details }),
  }
}

function isStringMap(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string")
}

function parseFailed(raw: object): SettlementRead {
  const record = raw as Record<string, unknown>
  if (!isNonEmptyString(record.attemptId)) return { kind: "unreadable", raw }
  return { kind: "failed", money: readMinorMoney(raw) }
}

export function pendingSettlementRecord(pending: PendingSettlement) {
  return { state: "pending" as const, ...pending }
}

export function heldSettlementRecord(held: HeldSettlement) {
  return { state: "held" as const, ...held }
}

export function failedSettlementRecord(failed: FailedSettlement) {
  return { state: "failed" as const, ...failed }
}

export function settledSettlementRecord(record: SettlementRecord) {
  return { state: "settled" as const, ...record }
}

export function canTransition(current: SettlementRead, next: SettlementState, attemptId?: string): boolean {
  if (next === "pending") return current.kind === "absent" || current.kind === "failed"
  if (current.kind !== "pending") return false
  return next === "failed" ? current.pending.attemptId === attemptId : true
}

export function reconcilePayment(input: {
  quote: PaymentQuote | null
  total: SaleorMoney
  settled?: MinorMoney
  now?: Date
}): ReconciliationResult {
  const { quote, settled } = input
  if (!quote) {
    return {
      ok: false,
      code: "payment_quote_missing",
      message: "No readable payment quote is stored on the checkout. Update the checkout to get a quote before completing.",
    }
  }

  const priced = quoteForTotal(input.total)
  if (!priced.ok) return priced
  const total = priced.quote

  if (settled && !sameMinorMoney(settled, total)) {
    return {
      ok: false,
      code: "order_total_changed_after_settlement",
      message: `The settled payment (${describe(settled)}) does not match the checkout total (${describe(total)}). The order was not placed.`,
    }
  }

  if (!sameMinorMoney(quote, total)) {
    return {
      ok: false,
      code: "payment_quote_stale",
      message: `The payment quote (${describe(quote)}) does not match the checkout total (${describe(total)}). Update the checkout to get a fresh quote and sign again.`,
    }
  }

  if (!settled) {
    const ageMs = (input.now ?? new Date()).getTime() - Date.parse(quote.quotedAt)
    if (ageMs > PAYMENT_QUOTE_TTL_MS) {
      return {
        ok: false,
        code: "payment_quote_expired",
        message: `The payment quote was made at ${quote.quotedAt}, more than ${PAYMENT_QUOTE_TTL_MS / 60_000} minutes ago. Update the checkout to get a fresh quote and sign again.`,
      }
    }
  }

  return { ok: true, payable: quote }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function readMinorMoney(raw: unknown): MinorMoney | null {
  if (typeof raw !== "object" || raw === null) return null
  const { amount, currency } = raw as Record<string, unknown>
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) return null
  if (typeof currency !== "string" || !isSupportedCurrency(currency)) return null
  return { amount, currency }
}

export function sameMinorMoney(a: MinorMoney, b: MinorMoney): boolean {
  return a.amount === b.amount && a.currency === b.currency
}

function describe(money: MinorMoney): string {
  return `${money.amount} ${money.currency} minor units`
}
