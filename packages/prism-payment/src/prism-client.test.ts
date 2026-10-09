import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PrismClient } from "./prism-client.js"

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

  it("posts the amount to /api/v2/merchant/payment-requirements as a major-unit decimal string", async () => {
    const client = new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" })

    await client.preparePayment({
      amount: 11480,
      currency: "USD",
      resourceUrl: "https://store.test/checkout/abc",
      resourceDescription: "Test",
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe("https://prism.test/api/v2/merchant/payment-requirements")
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.amount).toBe("114.80")
    expect(body.currency).toBe("USD")
  })

  it("uppercases the currency code on the wire", async () => {
    const client = new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" })

    await client.preparePayment({
      amount: 100,
      currency: "jpy",
      resourceUrl: "https://store.test/checkout/abc",
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.amount).toBe("100")
    expect(body.currency).toBe("JPY")
  })

  it("puts the UCP version in the handlers path", async () => {
    const client = new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" })

    await client.fetchUcpHandlers("2026-04-08")

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe("https://prism.test/ucp/2026-04-08/handlers")
  })

  it("keeps the UCP version out of the settle request", async () => {
    const client = new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" })

    await client.settle({ paymentPayload: { a: 1 }, paymentRequirements: { b: 2 } })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string)).toEqual({ x402Version: 2, paymentPayload: { a: 1 }, paymentRequirements: { b: 2 } })
  })
})
