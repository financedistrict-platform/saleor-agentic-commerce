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

describe("PrismClient — settle reply", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function replying(reply: unknown) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => reply }))
    return new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" }).settle({ paymentPayload: {}, paymentRequirements: {} })
  }

  it.each([
    ["no success flag", { transaction: "0x1" }],
    ["a success flag that is not true", { success: 1, transaction: "0x1" }],
    ["no transaction reference", { success: true }],
    ["an empty transaction reference", { success: true, transaction: "" }],
    ["a network that is not a string", { success: true, transaction: "0x1", network: 8453 }],
    ["a payer that is not a string", { success: true, transaction: "0x1", payer: {} }],
    ["no object", null],
  ])("fails a reply with %s", async (_case, reply) => {
    expect((await replying(reply)).success).toBe(false)
  })

  it("passes on the transaction, network and payer of a successful reply", async () => {
    expect(await replying({ success: true, transaction: "0x1", network: "eip155:8453", payer: "0xbuyer" })).toEqual({
      success: true,
      transactionHash: "0x1",
      network: "eip155:8453",
      payer: "0xbuyer",
    })
  })
})

describe("PrismClient — settle outcome of a failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function answering(response: { ok: boolean; status?: number; text?: string; json?: () => Promise<unknown> }) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ text: async () => response.text ?? "", ...response }))
    return new PrismClient({ apiUrl: "https://prism.test", apiKey: "k" }).settle({ paymentPayload: {}, paymentRequirements: {} })
  }

  it.each([400, 402, 422, 429])("treats an HTTP %i as declined", async (status) => {
    expect(await answering({ ok: false, status })).toMatchObject({ success: false, outcome: "declined" })
  })

  it.each([408, 409, 500, 502, 504])("treats an HTTP %i as unknown, since the gateway may still have settled", async (status) => {
    expect(await answering({ ok: false, status })).toMatchObject({ success: false, outcome: "unknown" })
  })

  it("treats a reply that says success is false as declined and keeps its reason", async () => {
    expect(await answering({ ok: true, json: async () => ({ success: false, errorReason: "insufficient_funds" }) })).toEqual({
      success: false,
      outcome: "declined",
      error: "insufficient_funds",
    })
  })

  it.each([
    ["an unreadable body", async () => { throw new SyntaxError("Unexpected token") }],
    ["no object", async () => null],
    ["no success flag", async () => ({ transaction: "0x1" })],
    ["a success flag that is not a boolean", async () => ({ success: "true", transaction: "0x1" })],
    ["success without a transaction", async () => ({ success: true })],
    ["success with an unreadable network", async () => ({ success: true, transaction: "0x1", network: 8453 })],
    ["success with an unreadable payer", async () => ({ success: true, transaction: "0x1", payer: {} })],
  ])("treats a reply with %s as unknown", async (_case, json) => {
    expect(await answering({ ok: true, json })).toMatchObject({ success: false, outcome: "unknown" })
  })

  it("treats a missing API key as declined, since nothing was sent", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv("PRISM_API_KEY", "")

    const result = await new PrismClient({ apiUrl: "https://prism.test" }).settle({ paymentPayload: {}, paymentRequirements: {} })

    expect(result).toMatchObject({ success: false, outcome: "declined" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
