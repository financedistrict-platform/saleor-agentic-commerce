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

  it("rejects an instrument missing handler_id", () => {
    const { handler_id: _handlerId, ...withoutHandler } = valid
    expect(isWellFormedInstrument(withoutHandler)).toBe(false)
  })

  it.each([
    ["no id", { handler_id: "xyz.fd.prism_payment", type: "x402", credential: { type: "x402" } }],
    ["type tokenized", { ...valid, type: "tokenized" }],
    ["type default", { ...valid, type: "default" }],
    ["no type", { id: "inst_1", handler_id: "xyz.fd.prism_payment", credential: { type: "x402" } }],
    ["credential without type", { ...valid, credential: { x402Version: 2 } }],
    ["handler_id x402", { ...valid, handler_id: "x402" }],
  ])("accepts an original-era instrument with %s", (_label, instrument) => {
    expect(isWellFormedInstrument(instrument)).toBe(true)
  })

  it("rejects a non-object credential", () => {
    expect(isWellFormedInstrument({ ...valid, credential: "x402" })).toBe(false)
  })

  it("rejects a non-object instrument", () => {
    expect(isWellFormedInstrument(null)).toBe(false)
    expect(isWellFormedInstrument("inst_1")).toBe(false)
  })
})
