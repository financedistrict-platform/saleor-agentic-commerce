import { describe, it, expect } from "vitest"
import { isWellFormedInstrument } from "./ucp-instrument.js"

const valid = {
  id: "inst_1",
  handler_id: "xyz.fd.prism_payment",
  type: "x402",
  credential: { type: "x402", x402Version: 2 },
}

describe("isWellFormedInstrument", () => {
  it("accepts an instrument with id, handler_id, type and credential.type", () => {
    expect(isWellFormedInstrument(valid)).toBe(true)
  })

  it("accepts an instrument without a credential", () => {
    const { credential: _credential, ...withoutCredential } = valid
    expect(isWellFormedInstrument(withoutCredential)).toBe(true)
  })

  it.each(["id", "handler_id", "type"])("rejects an instrument missing %s", (key) => {
    const instrument: Record<string, unknown> = { ...valid }
    delete instrument[key]
    expect(isWellFormedInstrument(instrument)).toBe(false)
  })

  it("rejects a credential without type", () => {
    expect(isWellFormedInstrument({ ...valid, credential: { x402Version: 2 } })).toBe(false)
  })

  it("rejects a non-string credential type", () => {
    expect(isWellFormedInstrument({ ...valid, credential: { type: 402 } })).toBe(false)
  })

  it("rejects a non-object instrument", () => {
    expect(isWellFormedInstrument(null)).toBe(false)
    expect(isWellFormedInstrument("inst_1")).toBe(false)
  })
})
