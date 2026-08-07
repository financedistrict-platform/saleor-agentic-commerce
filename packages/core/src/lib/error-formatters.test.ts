import { describe, it, expect } from "vitest"
import { formatUcpError, saleorErrorsToUcpMessages } from "./error-formatters.js"

const V = "2026-04-08"

describe("formatUcpError (SAC-5)", () => {
  it("emits a single message, defaulting severity to unrecoverable", () => {
    const r = formatUcpError({ ucpVersion: V, code: "x", content: "boom" })
    expect(r.ucp.status).toBe("error")
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]).toMatchObject({ type: "error", code: "x", content: "boom", severity: "unrecoverable" })
  })

  it("carries severity and path when provided (the spec slot for field errors)", () => {
    const r = formatUcpError({
      ucpVersion: V,
      code: "x",
      content: "bad email",
      severity: "requires_buyer_input",
      path: "$.buyer.email",
    })
    expect(r.messages[0].severity).toBe("requires_buyer_input")
    expect(r.messages[0].path).toBe("$.buyer.email")
  })

  it("emits multiple messages when given an array (no errors[0] truncation)", () => {
    const r = formatUcpError({
      ucpVersion: V,
      messages: [
        { code: "a", content: "one", severity: "recoverable" },
        { code: "b", content: "two", severity: "recoverable" },
      ],
    })
    expect(r.messages).toHaveLength(2)
    expect(r.messages.map((m) => m.content)).toEqual(["one", "two"])
  })
})

describe("saleorErrorsToUcpMessages (SAC-5)", () => {
  it("maps each Saleor error, preserving the field in content", () => {
    const msgs = saleorErrorsToUcpMessages(
      [
        { field: "postalCode", message: "This field is required.", code: "REQUIRED" },
        { field: "country", message: "Invalid value.", code: "INVALID" },
      ],
      { code: "shipping_address_update_failed", severity: "recoverable" },
    )
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({
      code: "shipping_address_update_failed",
      content: "postalCode: This field is required.",
      severity: "recoverable",
    })
    expect(msgs[1].content).toBe("country: Invalid value.")
  })

  it("omits the field prefix when there is no field, defaulting to recoverable", () => {
    const msgs = saleorErrorsToUcpMessages([{ field: null, message: "Nope" }], { code: "c" })
    expect(msgs[0].content).toBe("Nope")
    expect(msgs[0].severity).toBe("recoverable")
  })

  it("returns a fallback message when there are no structured errors", () => {
    const msgs = saleorErrorsToUcpMessages(undefined, {
      code: "c",
      fallbackContent: "fallback",
      severity: "unrecoverable",
    })
    expect(msgs).toEqual([{ code: "c", content: "fallback", severity: "unrecoverable" }])
  })

  it("returns [] when there are no errors and no fallback", () => {
    expect(saleorErrorsToUcpMessages([], { code: "c" })).toEqual([])
  })
})
