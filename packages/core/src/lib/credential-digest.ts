import { createHash } from "node:crypto"

export function credentialSha256(credential: unknown): string {
  const text = typeof credential === "string" ? credential : JSON.stringify(sortKeys(credential)) ?? "null"
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value !== "object" || value === null) return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]))
}
