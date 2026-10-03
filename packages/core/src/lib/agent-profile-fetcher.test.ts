import { readFileSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import {
  AGENT_PROFILE_CACHE_MAX_ENTRIES,
  AGENT_PROFILE_CACHE_TTL_MS,
  AGENT_PROFILE_MAX_IN_FLIGHT,
  createAgentProfileFetcher,
  isPublicAddress,
} from "./agent-profile-fetcher.js"

const CORE_VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")).version

let server: http.Server
let base = ""
let hits: { url: string; userAgent?: string }[] = []
let hold: (() => void)[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push({ url: req.url ?? "", userAgent: req.headers["user-agent"] })
    if (req.url?.startsWith("/slow")) {
      hold.push(() => res.end(JSON.stringify({ ucp: { version: "2026-08-25" } })))
      return
    }
    if (req.url === "/big") {
      res.end(JSON.stringify({ ucp: { version: "2026-08-25" }, pad: "x".repeat(140_000) }))
      return
    }
    const redirects: Record<string, [number, string | undefined]> = {
      "/redirect": [302, "/profile"],
      "/r301": [301, "/profile"],
      "/r308": [308, "/profile"],
      "/r308-slash/": [308, "/r308-slash"],
      "/to-big": [302, "/big"],
      "/two-hops": [302, "/redirect"],
      "/cross": [302, "https://elsewhere.example/profile"],
      "/downgrade": [302, "https://127.0.0.1/profile"],
      "/userinfo": [302, "http://user:pass@127.0.0.1/profile"],
      "/secret": [302, "https://user:secret@elsewhere.example/p"],
      "/no-location": [302, undefined],
      "/long": [302, `https://elsewhere.example/${"a".repeat(600)}`],
    }
    const redirect = redirects[req.url ?? ""]
    if (redirect) {
      res.writeHead(redirect[0], redirect[1] ? { location: redirect[1] } : {}).end()
      return
    }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ ucp: { version: "2026-08-25" } }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const release of hold) release()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  hits = []
  hold = []
})

describe("isPublicAddress", () => {
  it.each(["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.5"])(
    "rejects %s", (address) => {
      expect(isPublicAddress(address)).toBe(false)
    })

  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])("accepts %s", (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })
})

describe("createAgentProfileFetcher", () => {
  it("reads ucp.version from a loopback profile only with the test flag and sends the plugin User-Agent", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/profile`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(hits[0].userAgent).toBe(`fd-saleor-ucp/${CORE_VERSION}`)
  })

  it("rejects the same loopback URL with the default fetcher without a request", async () => {
    expect(await createAgentProfileFetcher().lookup(`${base}/profile`)).toEqual({ status: "failed" })
    expect(hits).toHaveLength(0)
  })

  it("rejects an https host that resolves to a private address without connecting", async () => {
    const fetcher = createAgentProfileFetcher({ lookupHost: async () => [{ address: "10.0.0.5", family: 4 }] })
    expect(await fetcher.lookup("https://agent.example/.well-known/ucp")).toEqual({ status: "failed" })
  })

  it("rejects a host when any resolved address is private", async () => {
    const fetcher = createAgentProfileFetcher({
      lookupHost: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }],
    })
    expect(await fetcher.lookup("https://agent.example/.well-known/ucp")).toEqual({ status: "failed" })
  })

  it("caps the body at 128 KiB", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/big`)).toEqual({ status: "failed" })
  })

  it.each(["/r301", "/r308"])("follows one same-origin redirect from %s", async (path) => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}${path}`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(hits.map((h) => h.url)).toEqual([path, "/profile"])
  })

  it("follows a trailing-slash redirect to the same path without the slash", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/r308-slash/`)).toEqual({ status: "ok", version: "2026-08-25" })
    expect(hits.map((h) => h.url)).toEqual(["/r308-slash/", "/r308-slash"])
  })

  it("caches the followed result under the original URL only", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    await fetcher.lookup(`${base}/r308`)
    await fetcher.lookup(`${base}/r308`)
    expect(hits.map((h) => h.url)).toEqual(["/r308", "/profile"])
    await fetcher.lookup(`${base}/profile`)
    expect(hits).toHaveLength(3)
  })

  it("enforces the body cap after the redirect", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/to-big`)).toEqual({ status: "failed" })
    expect(hits.map((h) => h.url)).toEqual(["/to-big", "/big"])
  })

  it("reports a cross-origin redirect without following it", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/cross`)).toEqual({ status: "redirected", location: "https://elsewhere.example/profile" })
    expect(hits).toHaveLength(1)
  })

  it.each([
    ["/downgrade", "https://127.0.0.1/profile"],
    ["/userinfo", "http://127.0.0.1/profile"],
  ])("reports the %s redirect without following it", async (path, location) => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}${path}`)).toEqual({ status: "redirected", location })
    expect(hits).toHaveLength(1)
  })

  it("reports a second redirect after one followed hop", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/two-hops`)).toEqual({ status: "redirected", location: `${base}/profile` })
    expect(hits.map((h) => h.url)).toEqual(["/two-hops", "/redirect"])
  })

  it("strips credentials from the reported location", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    const result = await fetcher.lookup(`${base}/secret`)
    expect(result).toEqual({ status: "redirected", location: "https://elsewhere.example/p" })
  })

  it("reports a null location when the redirect has no Location", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    expect(await fetcher.lookup(`${base}/no-location`)).toEqual({ status: "redirected", location: null })
  })

  it("truncates a long reported location to 512 characters", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    const result = await fetcher.lookup(`${base}/long`)
    expect(result.status === "redirected" && result.location?.length).toBe(512)
  })

  it("caches a redirected result under the original URL", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    await fetcher.lookup(`${base}/cross`)
    await fetcher.lookup(`${base}/cross`)
    expect(hits).toHaveLength(1)
  })

  it("caches a failure for 600 s without fetching again", async () => {
    let now = 1_000_000
    let lookups = 0
    const fetcher = createAgentProfileFetcher({
      clock: () => now,
      lookupHost: async () => { lookups++; return [{ address: "10.0.0.5", family: 4 }] },
    })
    const url = "https://agent.example/.well-known/ucp"
    await fetcher.lookup(url)
    now += AGENT_PROFILE_CACHE_TTL_MS - 1
    expect(await fetcher.lookup(url)).toEqual({ status: "failed" })
    expect(lookups).toBe(1)
    now += 2
    await fetcher.lookup(url)
    expect(lookups).toBe(2)
  })

  it("caches a success for 600 s", async () => {
    let now = 5_000_000
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true, clock: () => now })
    await fetcher.lookup(`${base}/cached`)
    await fetcher.lookup(`${base}/cached`)
    expect(hits).toHaveLength(1)
    now += AGENT_PROFILE_CACHE_TTL_MS + 1
    await fetcher.lookup(`${base}/cached`)
    expect(hits).toHaveLength(2)
  })

  it("evicts the oldest entry when the 1001st profile is cached", async () => {
    const resolved: string[] = []
    const fetcher = createAgentProfileFetcher({
      lookupHost: async (host) => { resolved.push(host); return [{ address: "10.0.0.5", family: 4 }] },
    })
    for (let i = 0; i <= AGENT_PROFILE_CACHE_MAX_ENTRIES; i++) {
      await fetcher.lookup(`https://agent-${i}.example/profile`)
    }
    expect(resolved).toHaveLength(AGENT_PROFILE_CACHE_MAX_ENTRIES + 1)
    await fetcher.lookup(`https://agent-${AGENT_PROFILE_CACHE_MAX_ENTRIES}.example/profile`)
    expect(resolved).toHaveLength(AGENT_PROFILE_CACHE_MAX_ENTRIES + 1)
    await fetcher.lookup("https://agent-0.example/profile")
    expect(resolved).toHaveLength(AGENT_PROFILE_CACHE_MAX_ENTRIES + 2)
  })

  it("answers busy without a request when 16 fetches are already in flight", async () => {
    const fetcher = createAgentProfileFetcher({ allowLoopbackForTests: true })
    const pending = Array.from({ length: AGENT_PROFILE_MAX_IN_FLIGHT }, (_, i) => fetcher.lookup(`${base}/slow-${i}`))
    while (hits.length < AGENT_PROFILE_MAX_IN_FLIGHT) await new Promise((r) => setTimeout(r, 5))

    expect(await fetcher.lookup(`${base}/slow-extra`)).toEqual({ status: "busy" })
    expect(hits).toHaveLength(AGENT_PROFILE_MAX_IN_FLIGHT)

    for (const release of hold) release()
    expect(await Promise.all(pending)).toEqual(Array(AGENT_PROFILE_MAX_IN_FLIGHT).fill({ status: "ok", version: "2026-08-25" }))
  })
})
