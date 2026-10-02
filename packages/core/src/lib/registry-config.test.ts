import { describe, it, expect } from "vitest"
import {
  createUcpVersionRegistry,
  DEFAULT_CURRENT_UCP_VERSION,
  DEFAULT_SUPPORTED_UCP_VERSIONS,
  KNOWN_UCP_VERSIONS,
  LATEST_UCP_VERSION,
} from "./ucp-version-registry.js"

describe("createUcpVersionRegistry", () => {
  it("defaults to 2026-08-25 with 2026-04-08 and 2026-01-23 supported, lenient", () => {
    const registry = createUcpVersionRegistry()
    expect(registry.current).toBe("2026-08-25")
    expect(DEFAULT_CURRENT_UCP_VERSION).toBe("2026-08-25")
    expect([...DEFAULT_SUPPORTED_UCP_VERSIONS]).toEqual(["2026-04-08", "2026-01-23"])
    expect(registry.enabled()).toEqual(["2026-08-25", "2026-04-08", "2026-01-23"])
    expect(registry.negotiation).toBe("lenient")
    expect([...KNOWN_UCP_VERSIONS].sort()).toEqual(["2026-01-23", "2026-04-08", "2026-08-25"])
  })

  it("derives the default current version from the newest known version", () => {
    expect(LATEST_UCP_VERSION).toBe([...KNOWN_UCP_VERSIONS].sort().at(-1))
    expect(DEFAULT_CURRENT_UCP_VERSION).toBe(LATEST_UCP_VERSION)
  })

  it("keeps the default supported list and the latest version equal to the known versions", () => {
    expect(new Set([...DEFAULT_SUPPORTED_UCP_VERSIONS, LATEST_UCP_VERSION])).toEqual(new Set(KNOWN_UCP_VERSIONS))
    expect(DEFAULT_SUPPORTED_UCP_VERSIONS).not.toContain(LATEST_UCP_VERSION)
  })

  it.each(KNOWN_UCP_VERSIONS)("keys the %s wire by an ISO date", (version) => {
    expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("keeps 2026-04-08 as the current version when the store pins it", () => {
    const registry = createUcpVersionRegistry({ ucpVersion: "2026-04-08" })
    expect(registry.current).toBe("2026-04-08")
    expect(registry.enabled()).toEqual(["2026-04-08", "2026-01-23"])
  })

  it("removes the current version from the supported list without an error", () => {
    const registry = createUcpVersionRegistry({ ucpVersion: "2026-08-25", ucpSupportedVersions: ["2026-08-25", "2026-04-08"] })
    expect(registry.supported).toEqual(["2026-04-08"])
    expect(registry.enabled()).toEqual(["2026-08-25", "2026-04-08"])
  })

  it("disables versions left out of the supported list", () => {
    const registry = createUcpVersionRegistry({ ucpSupportedVersions: [] })
    expect(registry.isKnown("2026-04-08")).toBe(true)
    expect(registry.isEnabled("2026-04-08")).toBe(false)
  })

  it.each([
    [{ ucpVersion: "2026-09-30" }, "Unknown UCP version: 2026-09-30"],
    [{ ucpSupportedVersions: ["2025-01-01"] }, "Unknown supported UCP version: 2025-01-01"],
    [{ ucpVersionNegotiation: "loose" }, "Unknown UCP version negotiation: loose"],
  ])("throws on unknown configuration %j", (options, message) => {
    expect(() => createUcpVersionRegistry(options)).toThrow(message)
  })

  it("returns the wire of every known version", () => {
    const registry = createUcpVersionRegistry()
    for (const version of KNOWN_UCP_VERSIONS) expect(registry.wire(version).version).toBe(version)
    expect(() => registry.wire("2026-09-30")).toThrow("Unknown UCP version")
  })
})
