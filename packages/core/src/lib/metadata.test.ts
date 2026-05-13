import { describe, it, expect } from "vitest"
import { metadataToRecord, recordToMetadataInput, getMetadataValue } from "./metadata.js"

describe("metadataToRecord", () => {
  it("parses JSON object values back into objects", () => {
    const out = metadataToRecord([{ key: "cfg", value: '{"a":1,"b":"two"}' }])
    expect(out.cfg).toEqual({ a: 1, b: "two" })
  })

  it("parses bare scalar values into their typed JSON equivalents", () => {
    // This pins a load-bearing behavior: route guards write { value: "true" }
    // and read it back expecting boolean `true`. If this contract ever changes
    // (e.g. someone makes metadataToRecord skip JSON.parse for bare scalars),
    // the cancel guards in ucp-routes/acp-routes will silently break — agents
    // could keep settling on cancelled sessions.
    expect(metadataToRecord([{ key: "flag", value: "true" }]).flag).toBe(true)
    expect(metadataToRecord([{ key: "flag", value: "false" }]).flag).toBe(false)
    expect(metadataToRecord([{ key: "n", value: "42" }]).n).toBe(42)
    expect(metadataToRecord([{ key: "z", value: "null" }]).z).toBeNull()
  })

  it("falls back to the raw string when the value is not valid JSON", () => {
    const out = metadataToRecord([{ key: "msg", value: "hello world" }])
    expect(out.msg).toBe("hello world")
  })

  it("preserves the value for non-JSON strings like ISO timestamps", () => {
    const ts = "2026-05-13T03:01:00.000Z"
    const out = metadataToRecord([{ key: "at", value: ts }])
    expect(out.at).toBe(ts)
  })
})

describe("recordToMetadataInput → metadataToRecord round-trip", () => {
  it("round-trips boolean true unchanged", () => {
    // Documents the canonical contract used by the cancel guards.
    const input = recordToMetadataInput({ ucp_canceled: true })
    expect(input).toEqual([{ key: "ucp_canceled", value: "true" }])
    const out = metadataToRecord(input)
    expect(out.ucp_canceled).toBe(true)
    expect(out.ucp_canceled === true).toBe(true)
    expect((out.ucp_canceled as unknown) === "true").toBe(false)
  })

  it("round-trips a nested object unchanged", () => {
    const input = recordToMetadataInput({ cfg: { handler: "prism", chain: 84532 } })
    const out = metadataToRecord(input)
    expect(out.cfg).toEqual({ handler: "prism", chain: 84532 })
  })

  it("round-trips a plain string unchanged", () => {
    const input = recordToMetadataInput({ note: "hello" })
    expect(input).toEqual([{ key: "note", value: "hello" }])
    const out = metadataToRecord(input)
    expect(out.note).toBe("hello")
  })
})

describe("getMetadataValue", () => {
  it("returns the parsed typed value when present", () => {
    expect(getMetadataValue([{ key: "flag", value: "true" }], "flag")).toBe(true)
  })

  it("returns undefined when the key is missing", () => {
    expect(getMetadataValue([{ key: "other", value: "1" }], "flag")).toBeUndefined()
  })
})
