import http from "node:http"
import type { AddressInfo } from "node:net"
import { describe, it, expect, vi, afterEach } from "vitest"
import { createUcpVersionRegistry } from "@financedistrict/saleor-agentic-commerce-core"
import { createAgentProfileFetcher } from "@financedistrict/saleor-agentic-commerce-core/agent-profile-fetcher"
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
  AGENT_REDIRECTED,
  AGENT_REDIRECTED_NO_LOCATION,
  AGENT_UNDECLARED,
  AGENT_UNKNOWN,
  fixedFetcher,
  PROFILES,
  ucpRequest,
} from "./__tests__/harness.js"

const URL_ = "https://store.test/api/ucp/checkout-sessions"
const pinned = { ucpVersion: "2026-04-08", ucpSupportedVersions: ["2026-08-25", "2026-01-23"] }
const lenient = createUcpVersionRegistry(pinned)
const strict = createUcpVersionRegistry({ ...pinned, ucpVersionNegotiation: "strict" })
const only0408 = createUcpVersionRegistry({ ucpVersion: "2026-04-08", ucpSupportedVersions: [] })

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

  it("serves the latest version when the registry is left at its defaults", async () => {
    const resolution = await resolveUcpVersion(createUcpVersionRegistry(), ucpRequest(URL_), fixedFetcher(PROFILES))
    expect(resolution).toMatchObject({ version: "2026-08-25", outcome: "none" })
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
  ])("falls back to the current version for %s under lenient negotiation", async (agent, outcome) => {
    const resolution = await resolve(lenient, agent)
    expect(resolution).toMatchObject({ version: "2026-04-08", outcome })
    expect(resolution.rejection).toBeUndefined()
  })

  it.each([
    [AGENT_DOWN, 424, "profile_unreachable"],
    [AGENT_UNDECLARED, 422, "profile_malformed"],
    [AGENT_UNKNOWN, 422, "version_unsupported"],
  ])("rejects %s under strict negotiation", async (agent, status, code) => {
    const resolution = await resolve(strict, agent)
    expect(resolution.rejection).toMatchObject({ status, code })
    expect(resolution.wire.version).toBe("2026-04-08")
  })

  it.each([lenient, strict])("rejects an unknown declared version with 422", async (registry) => {
    const resolution = await resolve(registry, AGENT_UNKNOWN)
    expect(resolution.outcome).toBe("unknown")
    expect(resolution.rejection).toEqual({
      status: 422,
      code: "version_unsupported",
      content: "Version 2027-01-01 is not supported. This business implements versions 2026-04-08, 2026-08-25, 2026-01-23.",
    })
  })

  it.each([lenient, strict])("rejects a redirected profile with 424 and the location", async (registry) => {
    const resolution = await resolve(registry, AGENT_REDIRECTED)
    expect(resolution).toMatchObject({ outcome: "redirected", location: "https://elsewhere.example/profile" })
    expect(resolution.rejection).toEqual({
      status: 424,
      code: "profile_redirected",
      content: "Agent profile URL redirects to https://elsewhere.example/profile; use the final URL.",
    })
  })

  it.each([lenient, strict])("rejects a redirected profile without a location", async (registry) => {
    const resolution = await resolve(registry, AGENT_REDIRECTED_NO_LOCATION)
    expect(resolution.outcome).toBe("redirected")
    expect(resolution.rejection).toEqual({
      status: 424,
      code: "profile_redirected",
      content: "Agent profile URL redirects; use the final URL.",
    })
  })

  it("keeps credentials from the Location out of the rejection and the log", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: "https://user:secret@elsewhere.example/p" }).end()
    })
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen))
    try {
      const agent = `http://127.0.0.1:${(server.address() as AddressInfo).port}/profile`
      const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const resolution = await resolveUcpVersion(lenient, ucpRequest(URL_, { agent }), fetcher)
      logUcpResolution(resolution)
      expect(resolution.location).toBe("https://elsewhere.example/p")
      expect(resolution.rejection?.content).toBe("Agent profile URL redirects to https://elsewhere.example/p; use the final URL.")
      expect(String(warn.mock.calls[0][0])).not.toContain("secret")
      expect(String(warn.mock.calls[0][0])).not.toContain("user")
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
  })

  it("serves the current version without a fetch when UCP-Agent has no profile", async () => {
    const fetcher = fixedFetcher(PROFILES)
    const request = new Request(URL_, { headers: { "UCP-Agent": "agent-a/1.0" } })
    const resolution = await resolveUcpVersion(strict, request, fetcher)
    expect(resolution).toMatchObject({ version: "2026-04-08", outcome: "none" })
    expect(resolution.rejection).toBeUndefined()
    expect(fetcher.calls).toEqual([])
  })

  it.each(["lenient", "strict"])(
    "rejects a known but disabled version with 422 under %s negotiation",
    async (negotiation) => {
      const registry = createUcpVersionRegistry({ ucpVersion: "2026-04-08", ucpSupportedVersions: [], ucpVersionNegotiation: negotiation })
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
    expect(pinned.rejection).toMatchObject({
      status: 422,
      code: "version_unsupported",
      content: "This session is bound to UCP version 2026-08-25; the agent profile now declares 2026-04-08.",
    })
  })

  it("keeps a matched version equal to the pinned one", async () => {
    const pinned = applyUcpSessionPin(lenient, await resolve(lenient, AGENT_0825), "2026-08-25")
    expect(pinned).toMatchObject({ version: "2026-08-25", outcome: "matched" })
    expect(pinned.rejection).toBeUndefined()
  })

  it.each([AGENT_DOWN, AGENT_UNDECLARED, undefined])(
    "serves the pinned version for a fallback outcome (%s)",
    async (agent) => {
      const pinned = applyUcpSessionPin(lenient, await resolve(lenient, agent), "2026-08-25")
      expect(pinned.version).toBe("2026-08-25")
      expect(pinned.wire.version).toBe("2026-08-25")
      expect(pinned.rejection).toBeUndefined()
    },
  )

  it("keeps the rejection for an unknown declared version on a pinned session", async () => {
    const resolution = await resolve(lenient, AGENT_UNKNOWN)
    const pinned = applyUcpSessionPin(lenient, resolution, "2026-08-25")
    expect(pinned).toBe(resolution)
    expect(pinned.rejection).toMatchObject({ status: 422, code: "version_unsupported" })
    expect(pinned.wire.version).toBe("2026-04-08")
  })

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

  it("writes the location for a redirected profile", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    logUcpResolution(await resolve(lenient, AGENT_REDIRECTED))
    logUcpResolution(await resolve(lenient, AGENT_REDIRECTED_NO_LOCATION))
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({
      ucp_profile_resolution: "redirected",
      served: "2026-04-08",
      host: "agent.example",
      location: "https://elsewhere.example/profile",
    })
    expect(JSON.parse(String(warn.mock.calls[1][0])).location).toBeNull()
  })
})
