import { SETTLEMENT_METADATA_KEY } from "@financedistrict/saleor-agentic-commerce-core"
import type { AgenticCommerceInstance } from "../config.js"

export const RETRY_DELAYS_MS = [100, 300]

export type RecordWrite = { ok: true } | { ok: false; error: string }

export async function writeSettlementRecord(
  saleorClient: AgenticCommerceInstance["saleorClient"],
  checkoutId: string,
  record: object,
): Promise<RecordWrite> {
  const items = [{ key: SETTLEMENT_METADATA_KEY, value: JSON.stringify(record) }]
  let result = await saleorClient.updatePrivateMetadata(checkoutId, items)
  for (const delay of RETRY_DELAYS_MS) {
    if (result.ok) break
    await new Promise<void>((resolve) => setTimeout(resolve, delay))
    result = await saleorClient.updatePrivateMetadata(checkoutId, items)
  }
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}
