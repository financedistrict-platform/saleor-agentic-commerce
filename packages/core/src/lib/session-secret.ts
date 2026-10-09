import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

export const SESSION_SECRET_METADATA_KEY = "agentic_commerce__session"
export const SESSION_SECRET_HEADER = "UCP-Session-Secret"

export type SessionSecretRecord = { sha256: string }

const SHA256_HEX = /^[0-9a-f]{64}$/

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

export function secretsMatch(supplied: string, expected: string): boolean {
  if (expected.length === 0) return false
  return timingSafeEqual(digest(supplied), digest(expected))
}

export function issueSessionSecret(): { secret: string; record: SessionSecretRecord } {
  const secret = randomBytes(32).toString("base64url")
  return { secret, record: { sha256: digest(secret).toString("hex") } }
}

export function sessionSecretMatches(metadata: Record<string, unknown>, supplied: string | null): boolean {
  if (!supplied) return false
  const stored = metadata[SESSION_SECRET_METADATA_KEY]
  if (typeof stored !== "object" || stored === null) return false
  const { sha256 } = stored as Record<string, unknown>
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) return false
  return timingSafeEqual(digest(supplied), Buffer.from(sha256, "hex"))
}
