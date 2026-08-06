import { describe, it, expect } from "vitest"
import { unwrapCredentialForSettle } from "./handler.js"

describe("unwrapCredentialForSettle (SAC-3)", () => {
  it("unwraps the wallet's wrapper to the inner paymentPayload", () => {
    const inner = { x402Version: 2, resource: "r", accepted: { network: "eip155:97" }, payload: { sig: "0x" } }
    const wrapper = { x402Version: 2, paymentPayload: inner, paymentRequirements: {} }
    // Prism's /settle wants `inner`, not the wrapper (wrapper -> opaque 400).
    expect(unwrapCredentialForSettle(wrapper)).toBe(inner)
  })

  it("passes a flat payload (no wrapper) through unchanged", () => {
    const flat = { x402Version: 2, accepted: {}, payload: {} }
    expect(unwrapCredentialForSettle(flat)).toBe(flat)
  })

  it("returns non-objects unchanged", () => {
    expect(unwrapCredentialForSettle(null)).toBe(null)
    expect(unwrapCredentialForSettle("x")).toBe("x")
  })
})
