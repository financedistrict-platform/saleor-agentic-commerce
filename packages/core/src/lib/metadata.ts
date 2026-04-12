/**
 * Saleor metadata utilities.
 *
 * Saleor stores metadata as an array of { key, value } pairs where
 * value is always a string. We need to serialize/deserialize JSON
 * objects for storing payment handler config.
 */

import type { SaleorMetadataItem } from "../types/saleor.js"

/**
 * Convert Saleor metadata array to a key-value record.
 * Values are parsed as JSON where possible, falling back to raw string.
 */
export function metadataToRecord(metadata: SaleorMetadataItem[]): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const { key, value } of metadata) {
    try {
      record[key] = JSON.parse(value)
    } catch {
      record[key] = value
    }
  }
  return record
}

/**
 * Convert a key-value record to Saleor metadata input format.
 * Objects are serialized to JSON strings.
 */
export function recordToMetadataInput(record: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }))
}

/**
 * Get a single parsed value from Saleor metadata.
 */
export function getMetadataValue<T = unknown>(
  metadata: SaleorMetadataItem[],
  key: string,
): T | undefined {
  const item = metadata.find((m) => m.key === key)
  if (!item) return undefined
  try {
    return JSON.parse(item.value) as T
  } catch {
    return item.value as unknown as T
  }
}
