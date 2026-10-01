import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { loadConfigFromAppCached, clearAppConfigCache } from "./app-config-loader.js"

// Minimal Saleor `{ app { privateMetadata } }` response whose store_name echoes
// the apiUrl, so we can tell two tenants' configs apart.
function fetchEchoingUrl() {
  return vi.fn(async (url: string) => ({
    ok: true,
    json: async () => ({
      data: {
        app: {
          id: "app",
          privateMetadata: [{ key: "agentic_commerce__store_name", value: String(url) }],
        },
      },
    }),
  }))
}

describe("loadConfigFromAppCached — per-tenant cache key (U-5)", () => {
  const realFetch = global.fetch
  let fetchMock: ReturnType<typeof fetchEchoingUrl>

  beforeEach(() => {
    clearAppConfigCache()
    fetchMock = fetchEchoingUrl()
    global.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => {
    global.fetch = realFetch
    clearAppConfigCache()
  })

  it("does not serve one Saleor instance's config to another", async () => {
    const a = await loadConfigFromAppCached("https://a.example/graphql/", "tok")
    const b = await loadConfigFromAppCached("https://b.example/graphql/", "tok")
    expect(a.storeName).toBe("https://a.example/graphql/")
    expect(b.storeName).toBe("https://b.example/graphql/")
  })

  it("caches per (apiUrl, token): the same key fetches only once", async () => {
    await loadConfigFromAppCached("https://a.example/graphql/", "tok")
    await loadConfigFromAppCached("https://a.example/graphql/", "tok")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("treats a different token as a different tenant", async () => {
    await loadConfigFromAppCached("https://a.example/graphql/", "tok1")
    await loadConfigFromAppCached("https://a.example/graphql/", "tok2")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("clearAppConfigCache forces a reload", async () => {
    await loadConfigFromAppCached("https://a.example/graphql/", "tok")
    clearAppConfigCache()
    await loadConfigFromAppCached("https://a.example/graphql/", "tok")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
