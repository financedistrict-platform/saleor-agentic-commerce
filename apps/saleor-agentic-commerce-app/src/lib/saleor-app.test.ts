import { describe, it, expect, afterEach, vi } from "vitest"
import { resolveAplType } from "./saleor-app.js"

// GH-62: the APL backend is chosen explicitly; a bad/missing selection must
// THROW at startup, never silently degrade to a throwaway file (losing the
// token). resolveAplType is the synchronous, dependency-free validation.

describe("resolveAplType — explicit selection, fail-fast (GH-62)", () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    vi.unstubAllEnvs()
    process.env = { ...ORIGINAL }
  })

  it("throws when APL is unset — no silent FileAPL fallback", () => {
    expect(() => resolveAplType(undefined)).toThrow(/APL is not set/)
    expect(() => resolveAplType("")).toThrow(/APL is not set/)
  })

  it("throws on an unknown APL value (a typo must not degrade storage)", () => {
    expect(() => resolveAplType("postgres")).toThrow(/Unknown APL/)
  })

  it("accepts file in development", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(resolveAplType("file")).toBe("file")
  })

  it("throws for file under NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(() => resolveAplType("file")).toThrow(/local-development only/)
  })

  it("env requires the App auth data (token, appId, apiUrl)", () => {
    delete process.env.SALEOR_APP_TOKEN
    delete process.env.SALEOR_APP_ID
    delete process.env.SALEOR_API_URL
    expect(() => resolveAplType("env")).toThrow(/SALEOR_APP_TOKEN/)
  })

  it("accepts env when the App auth data is present (the FD test/prod deploy)", () => {
    process.env.SALEOR_APP_TOKEN = "tok"
    process.env.SALEOR_APP_ID = "app"
    process.env.SALEOR_API_URL = "https://saleor.example/graphql/"
    // env is a valid PRODUCTION backend — unlike file, it must not be refused.
    vi.stubEnv("NODE_ENV", "production")
    expect(resolveAplType("env")).toBe("env")
  })

  it("redis requires REDIS_URL", () => {
    delete process.env.REDIS_URL
    expect(() => resolveAplType("redis")).toThrow(/REDIS_URL/)
  })

  it("accepts redis when REDIS_URL is set", () => {
    process.env.REDIS_URL = "redis://localhost:6379/2"
    expect(resolveAplType("redis")).toBe("redis")
  })

  it("dynamodb requires DYNAMODB_TABLE", () => {
    delete process.env.DYNAMODB_TABLE
    expect(() => resolveAplType("dynamodb")).toThrow(/DYNAMODB_TABLE/)
  })

  it("upstash requires UPSTASH_URL and UPSTASH_TOKEN", () => {
    delete process.env.UPSTASH_URL
    delete process.env.UPSTASH_TOKEN
    expect(() => resolveAplType("upstash")).toThrow(/UPSTASH_URL and UPSTASH_TOKEN/)
  })
})
