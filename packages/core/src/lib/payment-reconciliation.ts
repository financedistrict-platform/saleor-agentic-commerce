import { fromMinor, toMinor } from "./formatters/types.js"
import type { SaleorMoney } from "../types/saleor.js"

export const PAYMENT_QUOTE_METADATA_KEY = "agentic_commerce__quote"
export const SETTLEMENT_METADATA_KEY = "agentic_commerce__settlement"

export type MinorMoney = {
  amount: number
  currency: string
}

export type SettlementRecord = MinorMoney & {
  handlerId: string
  reference: string
  settledAt: string
}

export type ReconciliationErrorCode =
  | "payment_quote_missing"
  | "payment_quote_stale"
  | "order_total_changed_after_settlement"

export type ReconciliationResult =
  | { ok: true; payable: MinorMoney }
  | { ok: false; code: ReconciliationErrorCode; message: string }

export function quoteForTotal(total: SaleorMoney): MinorMoney {
  return { amount: toMinor(total.amount), currency: total.currency }
}

export function minorToSaleorMoney(money: MinorMoney): SaleorMoney {
  return { amount: fromMinor(money.amount), currency: money.currency }
}

export function readPaymentQuote(metadata: Record<string, unknown>): MinorMoney | null {
  return readMinorMoney(metadata[PAYMENT_QUOTE_METADATA_KEY])
}

export function readSettlementRecord(metadata: Record<string, unknown>): SettlementRecord | null {
  const raw = metadata[SETTLEMENT_METADATA_KEY]
  const money = readMinorMoney(raw)
  if (!money) return null
  const record = raw as Record<string, unknown>
  if (typeof record.reference !== "string" || record.reference.length === 0) return null
  if (typeof record.handlerId !== "string" || typeof record.settledAt !== "string") return null
  return { ...money, handlerId: record.handlerId, reference: record.reference, settledAt: record.settledAt }
}

export function reconcilePayment(input: {
  quote: MinorMoney | null
  total: SaleorMoney
  settled?: MinorMoney
}): ReconciliationResult {
  const { quote, settled } = input
  if (!quote) {
    return {
      ok: false,
      code: "payment_quote_missing",
      message: "No payment quote is stored on the checkout. Update the checkout to get a quote before completing.",
    }
  }

  const total = quoteForTotal(input.total)

  if (settled && !sameMoney(settled, total)) {
    return {
      ok: false,
      code: "order_total_changed_after_settlement",
      message: `The settled payment (${describe(settled)}) does not match the checkout total (${describe(total)}). The order was not placed.`,
    }
  }

  if (!sameMoney(quote, total)) {
    return {
      ok: false,
      code: "payment_quote_stale",
      message: `The payment quote (${describe(quote)}) does not match the checkout total (${describe(total)}). Update the checkout to get a fresh quote and sign again.`,
    }
  }

  return { ok: true, payable: quote }
}

function readMinorMoney(raw: unknown): MinorMoney | null {
  if (typeof raw !== "object" || raw === null) return null
  const { amount, currency } = raw as Record<string, unknown>
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) return null
  if (typeof currency !== "string" || currency.length === 0) return null
  return { amount, currency }
}

function sameMoney(a: MinorMoney, b: MinorMoney): boolean {
  return a.amount === b.amount && a.currency === b.currency
}

function describe(money: MinorMoney): string {
  return `${money.amount} ${money.currency} minor units`
}
