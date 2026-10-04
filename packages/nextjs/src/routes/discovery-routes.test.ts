import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createAgenticCommerce } from "../config.js"
import { AGENT_0123, AGENT_0825, buildRoutes, PINNED_0408_CONFIG, params, readFixture, stubPrismGateway, ucpRequest } from "./__tests__/harness.js"

const WELL_KNOWN = "https://store.test/.well-known/ucp"

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("GET /.well-known/ucp", () => {
  it("serves the original 0.7.1 profile bytes when no other version is enabled", async () => {
    const { routes } = buildRoutes({ config: { ucpVersion: "2026-04-08", ucpSupportedVersions: [] } })
    const response = await routes.discovery.GET(ucpRequest(WELL_KNOWN))
    expect(JSON.stringify(await response.json(), null, 2)).toBe(readFixture("ucp/2026-04-08/profile.json"))
  })

  it("serves the latest version and links the others by default", async () => {
    const { routes } = buildRoutes()
    const profile = await (await routes.discovery.GET(ucpRequest(WELL_KNOWN))).json()
    expect(profile.ucp.version).toBe("2026-08-25")
    expect(profile.ucp.supported_versions).toEqual({
      "2026-04-08": `${WELL_KNOWN}/2026-04-08`,
      "2026-01-23": `${WELL_KNOWN}/2026-01-23`,
    })
  })

  it("serves 2026-04-08 as the root profile when the store pins it", async () => {
    const { routes } = buildRoutes({ config: PINNED_0408_CONFIG })
    const profile = await (await routes.discovery.GET(ucpRequest(WELL_KNOWN))).json()
    expect(profile.ucp.version).toBe("2026-04-08")
    expect(profile.ucp.supported_versions).toEqual({
      "2026-08-25": `${WELL_KNOWN}/2026-08-25`,
      "2026-01-23": `${WELL_KNOWN}/2026-01-23`,
    })
  })

  it("asks Prism for the served version in the path", async () => {
    const gateway = stubPrismGateway()
    try {
      const { routes } = buildRoutes({ prism: true, config: PINNED_0408_CONFIG })
      const profile = await (await routes.discovery.GET(ucpRequest(WELL_KNOWN))).json()
      const discovery = gateway.requests.filter((r) => r.url.endsWith("/handlers"))

      expect(discovery.map((r) => r.url)).toEqual(["https://gw.example/api/v2/merchant/ucp/2026-04-08/handlers"])
      expect(profile.ucp.payment_handlers["xyz.fd.prism_payment"][0].id).toBe("xyz.fd.prism_payment")
    } finally {
      gateway.restore()
    }
  })
})

describe("GET /.well-known/ucp/[version]", () => {
  it.each(["2026-08-25", "2026-01-23", "2026-04-08"])("serves the %s leaf profile without supported_versions", async (version) => {
    const { routes } = buildRoutes()
    const response = await routes.discoveryVersion.GET(ucpRequest(`${WELL_KNOWN}/${version}`), params({ version }))
    const profile = await response.json()

    expect(response.status).toBe(200)
    expect(profile.ucp.version).toBe(version)
    expect(profile.ucp.supported_versions).toBeUndefined()
  })

  it.each(["2026-04-08", "2027-01-01"])("answers 404 version_unsupported for %s when it is not enabled", async (version) => {
    const { routes } = buildRoutes({ config: { ucpSupportedVersions: [] } })
    const response = await routes.discoveryVersion.GET(ucpRequest(`${WELL_KNOWN}/${version}`), params({ version }))

    expect(response.status).toBe(404)
    expect((await response.json()).messages[0].code).toBe("version_unsupported")
  })
})

describe("routes not available in a UCP version", () => {
  it.each(["catalogSearch", "catalogLookup"] as const)("answer %s with 404 capabilities_incompatible in the 2026-01-23 shape", async (route) => {
    const { routes } = buildRoutes()
    const response = await routes[route].POST(ucpRequest("https://store.test/api/ucp/catalog", { agent: AGENT_0123, body: { query: "x", ids: ["p1"] } }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      ucp: { version: "2026-01-23" },
      status: "requires_escalation",
      messages: [{
        type: "error",
        code: "capabilities_incompatible",
        content: "Catalog is not available in UCP version 2026-01-23.",
        severity: "requires_buyer_input",
      }],
    })
  })

  it("keeps catalog routes for 2026-08-25 agents", async () => {
    const { routes, instance } = buildRoutes()
    instance.saleorClient.searchProducts = (async () => ({ ok: false, error: "down" })) as typeof instance.saleorClient.searchProducts
    const response = await routes.catalogSearch.POST(ucpRequest("https://store.test/api/ucp/catalog/search", { agent: AGENT_0825, body: { query: "x" } }))

    expect(response.status).toBe(422)
    expect((await response.json()).ucp.version).toBe("2026-08-25")
  })
})

describe("createAgenticCommerce configuration", () => {
  const base = { saleorApiUrl: "https://saleor.test/graphql/", saleorAuthToken: "t", storefrontUrl: "https://store.test" }

  it("defaults the current version to the latest known version", () => {
    const instance = createAgenticCommerce(base)
    expect(instance.config.ucpVersion).toBe("2026-08-25")
    expect(instance.ucpRegistry?.enabled()).toEqual(["2026-08-25", "2026-04-08", "2026-01-23"])
  })

  it.each([
    [{ ucpVersion: "2026-09-30" }],
    [{ ucpSupportedVersions: ["2025-01-01"] }],
    [{ ucpVersionNegotiation: "loose" as "strict" }],
  ])("fails at boot on unknown configuration %j", (override) => {
    expect(() => createAgenticCommerce({ ...base, ...override })).toThrow(/Unknown/)
  })
})
