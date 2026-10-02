import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PrismClient, minorUnitsToDecimalString } from "./prism-client.js"

describe("minorUnitsToDecimalString", () => {
  it("formats USD cents as a 2-decimal major-unit string", () => {
    expect(minorUnitsToDecimalString(11480, "USD")).toBe("114.80")
    expect(minorUnitsToDecimalString(1, "USD")).toBe("0.01")
    expect(minorUnitsToDecimalString(100, "USD")).toBe("1.00")
  })

  it("formats JPY (zero-decimal currency) as an integer string", () => {
    expect(minorUnitsToDecimalString(100, "JPY")).toBe("100")
    expect(minorUnitsToDecimalString(11480, "JPY")).toBe("11480")
  })

  it("formats KWD (3-decimal currency) with 3 fractional digits", () => {
    expect(minorUnitsToDecimalString(11480, "KWD")).toBe("11.480")
    expect(minorUnitsToDecimalString(1, "KWD")).toBe("0.001")
  })

  it("is case-insensitive on the currency code", () => {
    expect(minorUnitsToDecimalString(11480, "usd")).toBe("114.80")
  })

  it("falls back to 2 decimals for unknown currency codes", () => {
    expect(minorUnitsToDecimalString(11480, "XYZ")).toBe("114.80")
  })

  it("handles zero", () => {
    expect(minorUnitsToDecimalString(0, "USD")).toBe("0.00")
    expect(minorUnitsToDecimalString(0, "JPY")).toBe("0")
  })
})

describe("PrismClient — payload formatting", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts the amount to /payment-requirements as a major-unit decimal string", async () => {
    const client = new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" })

    await client.prepareUcpPayment({
      ucpVersion: "2026-08-25",
      amount: 11480,
      currency: "USD",
      resourceUrl: "https://store.test/checkout/abc",
      resourceDescription: "Test",
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.amount).toBe("114.80")
    expect(body.currency).toBe("USD")
  })

  it("uppercases the currency code on the wire", async () => {
    const client = new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" })

    await client.prepareAcpPayment({
      ucpVersion: "2026-08-25",
      amount: 100,
      currency: "jpy",
      resourceUrl: "https://store.test/checkout/abc",
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.amount).toBe("100")
    expect(body.currency).toBe("JPY")
  })

  it("sends the UCP version as the User-Agent and adds no query to the handlers URL", async () => {
    const client = new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" })

    await client.fetchUcpHandlers("2026-04-08")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://prism.test/api/v2/merchant/ucp/handlers")
    expect(init.headers["User-Agent"]).toBe("fd-saleor-prism/2026-04-08")
  })

  it("keeps the UCP version out of the settle body", async () => {
    const client = new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" })

    await client.settle({ ucpVersion: "2026-01-23", paymentPayload: { a: 1 }, paymentRequirements: { b: 2 } })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers["User-Agent"]).toBe("fd-saleor-prism/2026-01-23")
    expect(JSON.parse(init.body as string)).toEqual({ x402Version: 2, paymentPayload: { a: 1 }, paymentRequirements: { b: 2 } })
  })
})
