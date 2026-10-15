export type SettlementSummary =
  | { state: "confirmed"; net: string; cashback: string; fee: string; asset: string }
  | { state: "pending" }
  | { state: "unavailable" }
  | { state: "none" }

export const UNAVAILABLE_TEXT = "Refund limit unavailable — check Prism portal"

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function fromPrism(body: unknown): SettlementSummary {
  if (typeof body !== "object" || body === null) return { state: "unavailable" }
  const { status, net, cashback, fee, asset } = body as Record<string, unknown>
  if (status === "broadcasted") return { state: "pending" }
  if (
    status === "confirmed" &&
    nonEmptyString(net) &&
    nonEmptyString(cashback) &&
    nonEmptyString(fee) &&
    nonEmptyString(asset)
  ) {
    return { state: "confirmed", net, cashback, fee, asset }
  }
  return { state: "unavailable" }
}

export function netReceivedText(summary: SettlementSummary): string {
  if (summary.state === "confirmed") return `${summary.net} ${summary.asset}`
  if (summary.state === "pending") return "Pending"
  return "Unavailable"
}

export function refundLimitText(summary: SettlementSummary): string {
  if (summary.state === "confirmed") return `${summary.net} ${summary.asset}`
  if (summary.state === "pending") return "Pending"
  return UNAVAILABLE_TEXT
}
