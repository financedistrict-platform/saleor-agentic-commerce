import { describe, it, expect, vi, afterEach } from "vitest"
import { createUcpVersionRegistry } from "@financedistrict/saleor-agentic-commerce-core"
import {
  applyUcpSessionPin,
  logUcpResolution,
  resolveUcpVersion,
  sessionPinFor,
} from "../middleware/ucp-version.js"
import {
  AGENT_0123,
  AGENT_0408,
  AGENT_0825,
  AGENT_DOWN,
  AGENT_UNDECLARED,
  AGENT_UNKNOWN,
  fixedFetcher,
  PROFILES,
  ucpRequest,
} from "./__tests__/harness.js"

const URL_ = "https://store.test/api/ucp/checkout-sessions"
const lenient = createUcpVersionRegistry()
const strict = createUcpVersionRegistry({ ucpVersionNegotiation: "strict" })
const only0408 = createUcpVersionRegistry({ ucpSupportedVersions: [] })

async function resolve(registry: typeof lenient, agent?: string) {
  return resolveUcpVersion(registry, ucpRequest(URL_, { agent }), fixedFetcher(PROFILES))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("resolveUcpVersion", () => {
  it("serves the current version without a fetch when UCP-Agent is missing", async () => {
    const fetcher = fixedFetcher(PROFILES)
    const resolution = await resolveUcpVersion(lenient, ucpRequest(URL_), fetcher)
    expect(resolution).toMatchObject({ version: "2026-04-08", outcome: "none" })
    expect(fetcher.calls).toEqual([])
  })

  it.each([
    [AGENT_0825, "2026-08-25"],
    [AGENT_0408, "2026-04-08"],
    [AGENT_0123, "2026-01-23"],
  ])("serves the matched version declared by %s", async (agent, version) => {
    const resolution = await resolve(lenient, agent)
    expect(resolution).toMatchObject({ version, outcome: "matched", declared: version, host: "agent.example" })
    expect(resolution.wire.version).toBe(version)
    expect(resolution.rejection).toBeUndefined()
  })

  it.each([
    [AGENT_DOWN, "unreachable"],
    [AGENT_UNDECLARED, "undeclared"],
    [AGENT_UNKNOWN, "unknown"],
  ])("falls back to the current version for %s under lenient negotiation", async (agent, outcome) => {
    const resolution = await resolve(lenient, agent)
    expect(resolution).toMatchObject({ version: "2026-04-08", outcome })
    expect(resolution.rejection).toBeUndefined()
  })

  it.each([
    [AGENT_DOWN, 424, "agent_profile_unavailable"],
    [AGENT_UNDECLARED, 422, "version_unsupported"],
    [AGENT_UNKNOWN, 422, "version_unsupported"],
  ])("rejects %s under strict negotiation", async (agent, status, code) => {
    const resolution = await resolve(strict, agent)
    expect(resolution.rejection).toMatchObject({ status, code })
    expect(resolution.wire.version).toBe("2026-04-08")
  })

  it.each(["lenient", "strict"])(
    "rejects a known but disabled version with 422 under %s negotiation",
    async (negotiation) => {
      const registry = createUcpVersionRegistry({ ucpSupportedVersions: [], ucpVersionNegotiation: negotiation })
      const resolution = await resolve(registry, AGENT_0825)
      expect(resolution.rejection).toEqual({
        status: 422,
        code: "version_unsupported",
        content: "Version 2026-08-25 is not supported. This business implements versions 2026-04-08.",
      })
    },
  )

  it("lists every enabled version in the 422 message", async () => {
    const resolution = await resolve(strict, AGENT_UNKNOWN)
    expect(resolution.rejection?.content).toBe(
      "Version 2027-01-01 is not supported. This business implements versions 2026-04-08, 2026-08-25, 2026-01-23.",
    )
    expect((await resolve(only0408, AGENT_0408)).rejection).toBeUndefined()
  })
})

describe("applyUcpSessionPin", () => {
  it("rejects a matched version that differs from the pinned one", async () => {
    const pinned = applyUcpSessionPin(lenient, await resolve(lenient, AGENT_0408), "2026-08-25")
    expect(pinned.rejection).toMatchObject({ status: 422, code: "version_unsupported" })
  })

  it("keeps a matched version equal to the pinned one", async () => {
    const pinned = applyUcpSessionPin(lenient, await resolve(lenient, AGENT_0825), "2026-08-25")
    expect(pinned).toMatchObject({ version: "2026-08-25", outcome: "matched" })
    expect(pinned.rejection).toBeUndefined()
  })

  it.each([AGENT_DOWN, AGENT_UNDECLARED, AGENT_UNKNOWN, undefined])(
    "serves the pinned version for a fallback outcome (%s)",
    async (agent) => {
      const pinned = applyUcpSessionPin(lenient, await resolve(lenient, agent), "2026-08-25")
      expect(pinned.version).toBe("2026-08-25")
      expect(pinned.wire.version).toBe("2026-08-25")
      expect(pinned.rejection).toBeUndefined()
    },
  )

  it("ignores a session without a pin or with an unknown pin", async () => {
    const resolution = await resolve(lenient, AGENT_0825)
    expect(applyUcpSessionPin(lenient, resolution, undefined)).toBe(resolution)
    expect(applyUcpSessionPin(lenient, resolution, "2020-01-01")).toBe(resolution)
  })

  it("pins a new session only on a matched outcome", async () => {
    expect(sessionPinFor(await resolve(lenient, AGENT_0825))).toBe("2026-08-25")
    expect(sessionPinFor(await resolve(lenient, AGENT_DOWN))).toBeUndefined()
    expect(sessionPinFor(await resolve(lenient))).toBeUndefined()
  })
})

describe("logUcpResolution", () => {
  it("writes one structured warning for a fallback outcome and nothing for matched or none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    logUcpResolution(await resolve(lenient, AGENT_DOWN))
    logUcpResolution(await resolve(lenient, AGENT_0825))
    logUcpResolution(await resolve(lenient))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({
      ucp_profile_resolution: "unreachable",
      served: "2026-04-08",
      host: "agent.example",
    })
  })
})
