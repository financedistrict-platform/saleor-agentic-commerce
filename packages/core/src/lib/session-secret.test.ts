import { describe, it, expect } from "vitest"
import { issueSessionSecret, secretsMatch, SESSION_SECRET_METADATA_KEY, sessionSecretMatches } from "./session-secret.js"

describe("secretsMatch", () => {
  it("accepts only an identical secret", () => {
    expect(secretsMatch("acp_key", "acp_key")).toBe(true)
    expect(secretsMatch("acp_kez", "acp_key")).toBe(false)
    expect(secretsMatch("acp_ke", "acp_key")).toBe(false)
    expect(secretsMatch("acp_key ", "acp_key")).toBe(false)
  })

  it("never matches an empty expected secret", () => {
    expect(secretsMatch("", "")).toBe(false)
    expect(secretsMatch("anything", "")).toBe(false)
  })
})

describe("issueSessionSecret", () => {
  it("returns a high-entropy secret that differs every time", () => {
    const first = issueSessionSecret()
    const second = issueSessionSecret()

    expect(first.secret).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(first.secret).not.toBe(second.secret)
    expect(first.record.sha256).not.toBe(second.record.sha256)
  })

  it("keeps only a hash in the stored record", () => {
    const { secret, record } = issueSessionSecret()

    expect(JSON.stringify(record)).not.toContain(secret)
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("sessionSecretMatches", () => {
  const { secret, record } = issueSessionSecret()
  const stored = { [SESSION_SECRET_METADATA_KEY]: record }

  it("accepts the issued secret", () => {
    expect(sessionSecretMatches(stored, secret)).toBe(true)
  })

  it("rejects a missing, empty or wrong secret", () => {
    expect(sessionSecretMatches(stored, null)).toBe(false)
    expect(sessionSecretMatches(stored, "")).toBe(false)
    expect(sessionSecretMatches(stored, `${secret}x`)).toBe(false)
    expect(sessionSecretMatches(stored, issueSessionSecret().secret)).toBe(false)
  })

  it("rejects when no record is stored", () => {
    expect(sessionSecretMatches({}, secret)).toBe(false)
  })

  it.each([
    ["a string", "garbage"],
    ["a number", 42],
    ["null", null],
    ["an object without a hash", {}],
    ["a hash of the wrong shape", { sha256: "abc" }],
    ["a non-string hash", { sha256: 1 }],
  ])("rejects a stored record that is %s", (_label, value) => {
    expect(sessionSecretMatches({ [SESSION_SECRET_METADATA_KEY]: value }, secret)).toBe(false)
  })
})
