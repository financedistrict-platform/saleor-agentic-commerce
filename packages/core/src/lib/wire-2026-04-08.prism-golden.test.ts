import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  outsidePrismEntries,
  PRISM_HANDLER_ID,
  readFixture,
  renderFixtures,
  serialize,
  UCP_FIXTURES,
  withoutPrismOwnedKeys,
} from "./__tests__/render-wire.js"

const VERSION = "2026-04-08"
const GOLDEN = "2026-04-08-prism-nsid"
const goldens = readdirSync(join(UCP_FIXTURES, GOLDEN)).filter((name) => name.endsWith(".json"))

type Entry = Record<string, unknown>

function prismEntries(document: unknown): Entry[] {
  const found: Entry[] = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (typeof value !== "object" || value === null) return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === PRISM_HANDLER_ID && Array.isArray(child)) found.push(...(child as Entry[]))
      else walk(child)
    }
  }
  walk(document)
  return found
}

describe.each([
  ["the current 2026-04-08 Prism entry", "current-handlers-2026-04-08.json"],
  ["the legacy Prism entry served by prod", "legacy-handlers.json"],
])("2026-04-08 wire fed %s against the 0.7.1 + 1.0.0 namespace-id goldens", (_label, recorded) => {
  it.each(goldens)("keeps %s equal once Prism-owned handler fields are removed", async (name) => {
    const rendered = await renderFixtures({ version: VERSION, supported: [], recordedPrism: recorded })
    const original = JSON.parse(readFixture(GOLDEN, name))
    expect(serialize(withoutPrismOwnedKeys(rendered[name]))).toBe(serialize(withoutPrismOwnedKeys(original)))
  })

  it.each(goldens)("keeps everything outside the Prism entries byte-equal in %s", async (name) => {
    const rendered = await renderFixtures({ version: VERSION, supported: [], recordedPrism: recorded })
    const original = JSON.parse(readFixture(GOLDEN, name))
    expect(serialize(outsidePrismEntries(rendered[name]))).toBe(serialize(outsidePrismEntries(original)))
  })

  it.each(goldens)("keeps the plugin-authored config of every Prism entry in %s", async (name) => {
    const rendered = await renderFixtures({ version: VERSION, supported: [], recordedPrism: recorded })
    const original = JSON.parse(readFixture(GOLDEN, name))
    expect(prismEntries(rendered[name]).map((e) => serialize(e.config))).toEqual(prismEntries(original).map((e) => serialize(e.config)))
  })

  it("advertises one canonical Prism entry", async () => {
    const rendered = await renderFixtures({ version: VERSION, supported: [], recordedPrism: recorded })
    const entries = (rendered["profile.json"] as { ucp: { payment_handlers: Record<string, Entry[]> } }).ucp.payment_handlers[PRISM_HANDLER_ID]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: PRISM_HANDLER_ID, version: expect.any(String), spec: expect.any(String), schema: expect.any(String) })
  })
})
