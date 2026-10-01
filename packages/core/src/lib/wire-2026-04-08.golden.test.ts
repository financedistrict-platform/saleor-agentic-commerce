import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import { DEFAULT_SUPPORTED_UCP_VERSIONS } from "./ucp-version-registry.js"
import { readFixture, renderFixtures, serialize, supportedLinks, UCP_FIXTURES, type RenderedFixtures } from "./__tests__/render-wire.js"

const VERSION = "2026-04-08"
const goldens = readdirSync(join(UCP_FIXTURES, VERSION)).filter((name) => name.endsWith(".json"))

describe("2026-04-08 wire against the 0.7.1 goldens with an empty payment registry", () => {
  let rendered: RenderedFixtures

  beforeAll(async () => {
    rendered = await renderFixtures({ version: VERSION, supported: [] })
  })

  it("covers every golden", () => {
    expect(Object.keys(rendered).sort()).toEqual([...goldens].sort())
  })

  it.each(goldens)("renders %s byte-equal to the original release", (name) => {
    expect(serialize(rendered[name])).toBe(readFixture(VERSION, name))
  })

  it("adds only ucp.supported_versions to the profile with the default supported list", async () => {
    const withSupported = await renderFixtures({ version: VERSION, supported: [...DEFAULT_SUPPORTED_UCP_VERSIONS] })
    const profile = withSupported["profile.json"] as { ucp: Record<string, unknown> }
    const original = JSON.parse(readFixture(VERSION, "profile.json"))

    expect(profile.ucp.supported_versions).toEqual(supportedLinks(DEFAULT_SUPPORTED_UCP_VERSIONS))
    const { supported_versions: _added, ...rest } = profile.ucp
    expect(serialize({ ...profile, ucp: rest })).toBe(serialize(original))
    expect(Object.keys(profile.ucp)).toEqual(["version", "supported_versions", ...Object.keys(original.ucp).slice(1)])

    for (const name of goldens.filter((n) => n !== "profile.json")) {
      expect(serialize(withSupported[name])).toBe(readFixture(VERSION, name))
    }
  })
})
