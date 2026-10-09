import { describe, it, expect } from "vitest"
import { AmountPrecisionError, UnsupportedCurrencyError, currencyExponent, fromMinor, minorToDecimalString, toMinor } from "./money.js"

describe("currencyExponent", () => {
  it("uses each currency's own minor unit", () => {
    expect(currencyExponent("USD")).toBe(2)
    expect(currencyExponent("JPY")).toBe(0)
    expect(currencyExponent("KWD")).toBe(3)
    expect(currencyExponent("BHD")).toBe(3)
    expect(currencyExponent("usd")).toBe(2)
  })

  it("rejects codes with no known minor unit instead of assuming two decimals", () => {
    expect(() => currencyExponent("ZZZ")).toThrow(UnsupportedCurrencyError)
    expect(() => currencyExponent("XXX")).toThrow(UnsupportedCurrencyError)
    expect(() => currencyExponent("")).toThrow(UnsupportedCurrencyError)
  })
})

describe("toMinor", () => {
  it("converts by the currency exponent", () => {
    expect(toMinor({ amount: 114.8, currency: "USD" })).toBe(11480)
    expect(toMinor({ amount: 10.5, currency: "KWD" })).toBe(10500)
    expect(toMinor({ amount: 10.505, currency: "BHD" })).toBe(10505)
    expect(toMinor({ amount: 1500, currency: "JPY" })).toBe(1500)
    expect(toMinor({ amount: 0, currency: "USD" })).toBe(0)
  })

  it("is exact where floating multiplication is not", () => {
    expect(toMinor({ amount: 1.15, currency: "USD" })).toBe(115)
    expect(toMinor({ amount: 4.35, currency: "USD" })).toBe(435)
    expect(toMinor({ amount: 1.001, currency: "KWD" })).toBe(1001)
  })

  it("rejects amounts finer than the currency allows instead of rounding them away", () => {
    expect(() => toMinor({ amount: 1.005, currency: "USD" })).toThrow(AmountPrecisionError)
    expect(() => toMinor({ amount: 1500.5, currency: "JPY" })).toThrow(AmountPrecisionError)
    expect(() => toMinor({ amount: Number.NaN, currency: "USD" })).toThrow(AmountPrecisionError)
    expect(() => toMinor({ amount: 1e21, currency: "USD" })).toThrow(AmountPrecisionError)
  })

  it("rejects unsupported currencies", () => {
    expect(() => toMinor({ amount: 1, currency: "ZZZ" })).toThrow(UnsupportedCurrencyError)
  })
})

describe("minorToDecimalString and fromMinor", () => {
  it("formats major units by the currency exponent", () => {
    expect(minorToDecimalString(11480, "USD")).toBe("114.80")
    expect(minorToDecimalString(1, "USD")).toBe("0.01")
    expect(minorToDecimalString(0, "USD")).toBe("0.00")
    expect(minorToDecimalString(11480, "JPY")).toBe("11480")
    expect(minorToDecimalString(0, "JPY")).toBe("0")
    expect(minorToDecimalString(11480, "KWD")).toBe("11.480")
    expect(minorToDecimalString(1, "KWD")).toBe("0.001")
    expect(minorToDecimalString(-150, "USD")).toBe("-1.50")
  })

  it("round-trips with toMinor", () => {
    for (const money of [{ amount: 54.97, currency: "USD" }, { amount: 54.97, currency: "KWD" }, { amount: 5497, currency: "JPY" }]) {
      expect(fromMinor(toMinor(money), money.currency)).toEqual(money)
    }
  })

  it("rejects unsupported currencies and non-integer minor amounts", () => {
    expect(() => minorToDecimalString(11480, "ZZZ")).toThrow(UnsupportedCurrencyError)
    expect(() => minorToDecimalString(1.5, "USD")).toThrow(AmountPrecisionError)
  })
})
