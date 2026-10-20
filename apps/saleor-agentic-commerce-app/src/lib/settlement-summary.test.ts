import { describe, it, expect } from "vitest"
import {
  UNAVAILABLE_TEXT,
  fromPrism,
  netReceivedText,
  refundLimitText,
} from "./settlement-summary"

const CONFIRMED_BODY = {
  transaction: "0xabc",
  network: "eip155:84532",
  asset: "USDC",
  status: "confirmed",
  gross: "100.00",
  fee: "1.50",
  cashback: "5.00",
  net: "93.50",
}

describe("fromPrism", () => {
  it("maps a confirmed body", () => {
    expect(fromPrism(CONFIRMED_BODY)).toEqual({
      state: "confirmed",
      net: "93.50",
      cashback: "5.00",
      fee: "1.50",
      asset: "USDC",
    })
  })

  it("maps broadcasted to pending", () => {
    expect(fromPrism({ ...CONFIRMED_BODY, status: "broadcasted" })).toEqual({ state: "pending" })
  })

  it.each([
    ["rejected", { status: "rejected" }],
    ["null", null],
    ["string", "x"],
    ["confirmed without net", { ...CONFIRMED_BODY, net: undefined }],
    ["confirmed with empty asset", { ...CONFIRMED_BODY, asset: "" }],
  ])("maps %s to unavailable", (_name, body) => {
    expect(fromPrism(body)).toEqual({ state: "unavailable" })
  })
})

describe("display text", () => {
  const confirmed = fromPrism(CONFIRMED_BODY)

  it("shows the net for both rows when confirmed", () => {
    expect(netReceivedText(confirmed)).toBe("93.50 USDC")
    expect(refundLimitText(confirmed)).toBe("93.50 USDC")
  })

  it("shows Pending on both rows when pending", () => {
    expect(netReceivedText({ state: "pending" })).toBe("Pending")
    expect(refundLimitText({ state: "pending" })).toBe("Pending")
  })

  it("shows the unavailable text otherwise", () => {
    expect(netReceivedText({ state: "unavailable" })).toBe("Unavailable")
    expect(refundLimitText({ state: "unavailable" })).toBe(UNAVAILABLE_TEXT)
  })
})
