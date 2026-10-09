import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect, vi } from "vitest"
import { PrismPaymentHandler, PRISM_HANDLER_ID } from "./handler.js"
import { PrismClient } from "./prism-client.js"
import { samplePaymentHandlerConfig, sampleAcpHandler, sampleAcpDeclaration } from "./__tests__/acp-handler-fixture.js"
import type {
  AcpHandler,
  PaymentHandlerConfig,
  UcpCheckoutPrepareResponse,
  UcpHandlersDiscoveryResponse,
} from "./prism-client.js"

// =====================================================
// Mock client
// =====================================================

type MockedClient = {
  fetchUcpHandlers: ReturnType<typeof vi.fn>
  fetchAcpHandlers: ReturnType<typeof vi.fn>
  preparePayment: ReturnType<typeof vi.fn>
  settle: ReturnType<typeof vi.fn>
}

function makeHandler() {
  const handler = new PrismPaymentHandler({ apiUrl: "https://test.example", apiKey: "k" })
  // Replace the client with a mock
  const mock: MockedClient = {
    fetchUcpHandlers: vi.fn(),
    fetchAcpHandlers: vi.fn(),
    preparePayment: vi.fn(),
    settle: vi.fn(),
  }
  // @ts-expect-error - injecting mock
  handler.client = mock
  return { handler, mock }
}

// =====================================================
// Fixtures matching Prism OpenAPI shapes
// =====================================================

const sampleUcpDiscovery: UcpHandlersDiscoveryResponse = {
  "xyz.fd.prism_payment": [
    {
      id: "xyz.fd.prism_payment",
      version: "2026-10-07",
      spec: "https://test.example/ucp/prism.md",
      schema: "https://test.example/ucp/schema.json",
      available_instruments: [{ type: "x402" }],
      config: {},
    },
  ],
}

const sampleUcpPrepare: UcpCheckoutPrepareResponse = {
  "xyz.fd.prism_payment": [
    {
      id: "xyz.fd.prism_payment",
      version: "2026-10-07",
      config: samplePaymentHandlerConfig,
    },
  ],
}

const TEST_UCP_VERSION = "2026-08-25"

function signedFor(entry: { scheme: string; network: string; asset: string; payTo: string; amount?: string | null }, value = entry.amount ?? "0") {
  return {
    x402Version: 2,
    accepted: { scheme: entry.scheme, network: entry.network, asset: entry.asset, payTo: entry.payTo, amount: value },
    payload: { signature: "0xsig", authorization: { from: "0xbuyer", to: entry.payTo, value, validAfter: "0", validBefore: "9999999999", nonce: "0x01" } },
  }
}

const SIGNED = signedFor(samplePaymentHandlerConfig.accepts[0])

const baseInput = {
  ucpVersion: TEST_UCP_VERSION,
  checkoutId: "abc",
  total: 1099,
  currencyCode: "USD",
  checkoutBaseUrl: "https://store.test/checkout",
  storeName: "Test Store",
}

// =====================================================
// Tests
// =====================================================

describe("PrismPaymentHandler — discovery", () => {
  it("passes Prism's UCP discovery response through unchanged", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)

    const result = await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)

    expect(result).toEqual(sampleUcpDiscovery)
    expect(mock.fetchUcpHandlers).toHaveBeenCalledOnce()
  })

  it("includes the spec and schema fields that the legacy payment-profile endpoint omitted", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)

    const result = await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)

    const entry = result["xyz.fd.prism_payment"][0]
    expect(entry).toHaveProperty("spec")
    expect(entry).toHaveProperty("schema")
  })

  it("passes Prism's ACP discovery response through unchanged (no hand-construction)", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpDeclaration])

    const result = await handler.getAcpDiscoveryHandlers(TEST_UCP_VERSION)

    expect(result).toEqual([sampleAcpDeclaration])
    expect(mock.fetchAcpHandlers).toHaveBeenCalledOnce()
  })

  it("uses Prism's authoritative requires_delegate_payment instead of hardcoding false", async () => {
    const { handler, mock } = makeHandler()
    const handlerWithDelegate = { ...sampleAcpDeclaration, requires_delegate_payment: true }
    mock.fetchAcpHandlers.mockResolvedValue([handlerWithDelegate])

    const result = await handler.getAcpDiscoveryHandlers(TEST_UCP_VERSION)

    expect((result[0] as AcpHandler).requires_delegate_payment).toBe(true)
  })

  it("advertises nothing when the fetched entry is missing schema", async () => {
    const { handler, mock } = makeHandler()
    const { schema: _schema, ...withoutSchema } = sampleUcpDiscovery["xyz.fd.prism_payment"][0]
    mock.fetchUcpHandlers.mockResolvedValue({ "xyz.fd.prism_payment": [withoutSchema] })

    expect(await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)).toEqual({})
  })

  it("advertises nothing when the fetched entry has a non-contract id", async () => {
    const { handler, mock } = makeHandler()
    const entry = { ...sampleUcpDiscovery["xyz.fd.prism_payment"][0], id: "other" }
    mock.fetchUcpHandlers.mockResolvedValue({ "xyz.fd.prism_payment": [entry] })

    expect(await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)).toEqual({})
  })

  it("advertises only the validated Prism entry", async () => {
    const { handler, mock } = makeHandler()
    const entry = sampleUcpDiscovery["xyz.fd.prism_payment"][0]
    mock.fetchUcpHandlers.mockResolvedValue({
      "xyz.fd.prism_payment": [entry, { id: "other" }],
      "com.example.extra": [{ id: "com.example.extra" }],
    })

    expect(await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)).toEqual({ "xyz.fd.prism_payment": [entry] })
  })

  it("advertises nothing when the first fetch is malformed", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue({ "xyz.fd.prism_payment": [{ id: "xyz.fd.prism_payment" }] })

    expect(await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)).toEqual({})
  })

  it("never serves a malformed refetch after the cached entry expires", async () => {
    vi.useFakeTimers()
    try {
      const { handler, mock } = makeHandler()
      mock.fetchUcpHandlers.mockResolvedValueOnce(sampleUcpDiscovery)
      expect(await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)).toEqual(sampleUcpDiscovery)

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      mock.fetchUcpHandlers.mockResolvedValueOnce({ "xyz.fd.prism_payment": [{ id: "other" }] })

      expect(await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)).toEqual({})
    } finally {
      vi.useRealTimers()
    }
  })

  it("waits 60 s after a failed discovery before refetching", async () => {
    vi.useFakeTimers()
    try {
      const { handler, mock } = makeHandler()
      mock.fetchUcpHandlers.mockRejectedValueOnce(new Error("down"))
      expect(await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)).toEqual({})

      mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)
      expect(await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)).toEqual({})
      expect(mock.fetchUcpHandlers).toHaveBeenCalledOnce()

      vi.advanceTimersByTime(60 * 1000 + 1)
      expect(await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)).toEqual(sampleUcpDiscovery)
      expect(mock.fetchUcpHandlers).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("caches discovery responses (TTL)", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)

    await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)
    await handler.getUcpDiscoveryHandlers(TEST_UCP_VERSION)

    expect(mock.fetchUcpHandlers).toHaveBeenCalledOnce()
  })
})

describe("PrismPaymentHandler — prepareCheckoutPayment", () => {
  it("calls Prism once for payment requirements and composes both entries", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpDeclaration])
    mock.preparePayment.mockResolvedValue(samplePaymentHandlerConfig)

    const data = await handler.prepareCheckoutPayment(baseInput)

    expect(mock.preparePayment).toHaveBeenCalledOnce()
    expect(mock.fetchUcpHandlers).toHaveBeenCalledWith(TEST_UCP_VERSION)
    expect(mock.preparePayment.mock.calls[0][0]).not.toHaveProperty("ucpVersion")
    expect(data!.ucp).toEqual(sampleUcpPrepare)
    expect(data!.acp).toEqual(sampleAcpHandler)
  })

  it("composes the ACP entry static fields from the cached ACP declaration", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpDeclaration])
    mock.preparePayment.mockResolvedValue(samplePaymentHandlerConfig)

    const data = await handler.prepareCheckoutPayment(baseInput)
    const [discovered] = await handler.getAcpDiscoveryHandlers(TEST_UCP_VERSION)

    const staticKeys = [
      "id",
      "name",
      "version",
      "spec",
      "requires_delegate_payment",
      "requires_pci_compliance",
      "psp",
      "config_schema",
      "instrument_schemas",
    ] as const
    for (const key of staticKeys) {
      expect(data!.acp![key]).toEqual(discovered[key])
    }
    expect(data!.acp!.config).toEqual(samplePaymentHandlerConfig)
    expect(discovered.config).toEqual({})
    expect(mock.fetchAcpHandlers).toHaveBeenCalledOnce()
  })

  it("stores both UCP and ACP responses keyed for later retrieval", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)
    mock.preparePayment.mockResolvedValue(samplePaymentHandlerConfig)
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpDeclaration])

    const data = await handler.prepareCheckoutPayment(baseInput)

    expect(data).not.toBeNull()
    expect(data!.ucp).toEqual(sampleUcpPrepare)
    expect(data!.acp).toEqual(sampleAcpHandler)
    expect(data!.preparedAmount).toBe(1099)
    expect(data!.preparedResourceUrl).toBe("https://store.test/checkout/abc")
  })

  it("omits the ACP entry when ACP discovery is empty", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)
    mock.fetchAcpHandlers.mockResolvedValue([])
    mock.preparePayment.mockResolvedValue(samplePaymentHandlerConfig)

    const data = await handler.prepareCheckoutPayment(baseInput)

    expect(data).not.toBeNull()
    expect(data!.ucp).toEqual(sampleUcpPrepare)
    expect(data!.acp).toBeNull()
    expect(mock.preparePayment).toHaveBeenCalledOnce()
  })

  it("returns null when payment-requirements fails", async () => {
    const { handler, mock } = makeHandler()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpDeclaration])
    mock.preparePayment.mockRejectedValue(new Error("Prism down"))

    const data = await handler.prepareCheckoutPayment(baseInput)

    expect(data).toBeNull()
    error.mockRestore()
  })

  it("returns null instead of the stale quote when a re-prepare fails after the total changed", async () => {
    const { handler, mock } = makeHandler()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpDeclaration])
    mock.preparePayment.mockRejectedValue(new Error("Prism down"))
    const stale = {
      ucp: sampleUcpPrepare,
      acp: sampleAcpHandler,
      preparedAmount: 999, preparedCurrency: "USD",
      preparedResourceUrl: "https://store.test/checkout/abc",
    }

    const data = await handler.prepareCheckoutPayment({
      ...baseInput,
      checkoutMetadata: { [PRISM_HANDLER_ID]: stale },
    })

    expect(data).toBeNull()
    expect(handler.getUcpCheckoutHandlers({ [PRISM_HANDLER_ID]: data })).toEqual({})
    expect(handler.getAcpCheckoutHandlers({ [PRISM_HANDLER_ID]: data })).toEqual([])
    error.mockRestore()
  })

  it("is idempotent — same checkout + same total returns cached blob without re-calling Prism", async () => {
    const { handler, mock } = makeHandler()

    const stored = {
      ucp: sampleUcpPrepare,
      acp: sampleAcpHandler,
      preparedAmount: 1099, preparedCurrency: "USD",
      preparedResourceUrl: "https://store.test/checkout/abc",
    }

    const result = await handler.prepareCheckoutPayment({
      ...baseInput,
      checkoutMetadata: { [PRISM_HANDLER_ID]: stored },
    })

    expect(result).toEqual(stored)
    expect(mock.preparePayment).not.toHaveBeenCalled()
  })

  it("re-prepares when the total changes", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)
    mock.preparePayment.mockResolvedValue(samplePaymentHandlerConfig)
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpDeclaration])

    const stored = {
      ucp: sampleUcpPrepare,
      acp: sampleAcpHandler,
      preparedAmount: 999, preparedCurrency: "USD", // different from baseInput.total
      preparedResourceUrl: "https://store.test/checkout/abc",
    }

    await handler.prepareCheckoutPayment({
      ...baseInput,
      checkoutMetadata: { [PRISM_HANDLER_ID]: stored },
    })

    expect(mock.preparePayment).toHaveBeenCalledOnce()
  })

  it("composes the UCP entry id and version from discovery for the same UCP version", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockImplementation(async (version: string) => ({
      [PRISM_HANDLER_ID]: [{ ...sampleUcpDiscovery[PRISM_HANDLER_ID][0], version: `decl-${version}` }],
    }))
    mock.preparePayment.mockResolvedValue(samplePaymentHandlerConfig)
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpDeclaration])

    const data = await handler.prepareCheckoutPayment({ ...baseInput, ucpVersion: "2026-04-08" })
    const [declared] = (await handler.getUcpDiscoveryHandlers("2026-04-08"))[PRISM_HANDLER_ID]

    expect(data!.ucp).toEqual({
      [PRISM_HANDLER_ID]: [{ id: declared.id, version: declared.version, config: samplePaymentHandlerConfig }],
    })
    expect(declared.version).toBe("decl-2026-04-08")
    expect(mock.fetchUcpHandlers.mock.calls).toEqual([["2026-04-08"]])
  })

  it("omits the UCP entry when discovery has no declaration for the UCP version", async () => {
    const { handler, mock } = makeHandler()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    mock.fetchUcpHandlers.mockResolvedValue({})
    mock.preparePayment.mockResolvedValue(samplePaymentHandlerConfig)
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpDeclaration])

    const data = await handler.prepareCheckoutPayment(baseInput)

    expect(data!.ucp).toBeNull()
    expect(data!.acp).toEqual(sampleAcpHandler)
    expect(mock.preparePayment).toHaveBeenCalledOnce()
    expect(handler.getUcpCheckoutHandlers({ [PRISM_HANDLER_ID]: data })).toEqual({})
    error.mockRestore()
  })

  it("settles against the composed raw x402 config", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)
    mock.preparePayment.mockResolvedValue(samplePaymentHandlerConfig)
    mock.fetchAcpHandlers.mockResolvedValue([])
    const data = await handler.prepareCheckoutPayment(baseInput)
    mock.settle.mockResolvedValue({ success: true, transactionHash: "0xabc" })

    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "ucp",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential: { type: "x402", ...SIGNED },
      checkoutMetadata: { [PRISM_HANDLER_ID]: data },
    })

    expect(result.success).toBe(true)
    expect(mock.settle.mock.calls[0][0].paymentRequirements).toEqual(samplePaymentHandlerConfig.accepts[0])
  })
})

describe("PrismPaymentHandler — checkout-context handlers", () => {
  it("returns the stored UCP shape verbatim from getUcpCheckoutHandlers", () => {
    const { handler } = makeHandler()
    const stored = {
      ucp: sampleUcpPrepare,
      acp: sampleAcpHandler,
      preparedAmount: 1099, preparedCurrency: "USD",
      preparedResourceUrl: "https://store.test/checkout/abc",
    }

    const result = handler.getUcpCheckoutHandlers({ [PRISM_HANDLER_ID]: stored })

    expect(result).toEqual(sampleUcpPrepare)
  })

  it("returns the stored ACP shape wrapped in an array from getAcpCheckoutHandlers", () => {
    const { handler } = makeHandler()
    const stored = {
      ucp: sampleUcpPrepare,
      acp: sampleAcpHandler,
      preparedAmount: 1099, preparedCurrency: "USD",
      preparedResourceUrl: "https://store.test/checkout/abc",
    }

    const result = handler.getAcpCheckoutHandlers({ [PRISM_HANDLER_ID]: stored })

    expect(result).toEqual([sampleAcpHandler])
  })

  it("returns empty when no Prism data is stored", () => {
    const { handler } = makeHandler()
    expect(handler.getUcpCheckoutHandlers({})).toEqual({})
    expect(handler.getAcpCheckoutHandlers({})).toEqual([])
  })
})

describe("PrismPaymentHandler — settlement", () => {
  it("submits a single accepts entry as paymentRequirements (not the wrapper config)", async () => {
    const { handler, mock } = makeHandler()
    mock.settle.mockResolvedValue({ success: true, transactionHash: "0xdeadbeef" })

    const credential = { type: "x402", ...SIGNED }

    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "ucp",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential,
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: {
          ucp: sampleUcpPrepare,
          acp: null,
          preparedAmount: 1099, preparedCurrency: "USD",
          preparedResourceUrl: "https://store.test/checkout/abc",
        },
      },
    })

    expect(result.success).toBe(true)
    expect(result.transactionReference).toBe("0xdeadbeef")
    expect(mock.settle).toHaveBeenCalledWith({
      paymentPayload: credential,
      paymentRequirements: samplePaymentHandlerConfig.accepts[0],
    })
  })

  it("falls back to ACP-stored config when UCP is missing", async () => {
    const { handler, mock } = makeHandler()
    mock.settle.mockResolvedValue({ success: true })

    const credential = { type: "x402", ...SIGNED }

    await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "ucp",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential,
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: {
          ucp: null,
          acp: sampleAcpHandler,
          preparedAmount: 1099, preparedCurrency: "USD",
          preparedResourceUrl: "https://store.test/checkout/abc",
        },
      },
    })

    expect(mock.settle).toHaveBeenCalledWith({
      paymentPayload: credential,
      paymentRequirements: samplePaymentHandlerConfig.accepts[0],
    })
  })

  it("settles an ACP credential without applying the UCP type rule", async () => {
    const { handler, mock } = makeHandler()
    mock.settle.mockResolvedValue({ success: true, transactionHash: "0xacp" })

    const credential = SIGNED

    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "acp",
      handlerId: PRISM_HANDLER_ID,
      credential,
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: {
          ucp: null,
          acp: sampleAcpHandler,
          preparedAmount: 1099, preparedCurrency: "USD",
          preparedResourceUrl: "https://store.test/checkout/abc",
        },
      },
    })

    expect(result.success).toBe(true)
    expect(mock.settle).toHaveBeenCalledWith({
      paymentPayload: credential,
      paymentRequirements: samplePaymentHandlerConfig.accepts[0],
    })
  })

  it("picks the accepts entry matching the credential's network when multiple are offered", async () => {
    const { handler, mock } = makeHandler()
    mock.settle.mockResolvedValue({ success: true })

    const baseEntry = samplePaymentHandlerConfig.accepts[0]
    const arbEntry = { ...baseEntry, network: "arbitrum-sepolia", asset: "USDC-arb" }
    const multiAcceptsConfig: PaymentHandlerConfig = {
      ...samplePaymentHandlerConfig,
      accepts: [arbEntry, baseEntry],
    }
    const multiUcp: UcpCheckoutPrepareResponse = {
      "xyz.fd.prism_payment": [{ id: "xyz.fd.prism_payment", version: "2026-10-07", config: multiAcceptsConfig }],
    }

    await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "ucp",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential: { type: "x402", ...SIGNED },
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: {
          ucp: multiUcp,
          acp: null,
          preparedAmount: 1099, preparedCurrency: "USD",
          preparedResourceUrl: "https://store.test/checkout/abc",
        },
      },
    })

    expect(mock.settle).toHaveBeenCalledWith({
      paymentPayload: expect.anything(),
      paymentRequirements: baseEntry,
    })
  })

  const storedUcpOnly = {
    [PRISM_HANDLER_ID]: {
      ucp: sampleUcpPrepare,
      acp: null,
      preparedAmount: 1099, preparedCurrency: "USD",
      preparedResourceUrl: "https://store.test/checkout/abc",
    },
  }

  it("rejects an instrument whose type is not an x402-era type without settling", async () => {
    const { handler, mock } = makeHandler()

    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "ucp",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "card",
      credential: { type: "x402", x402Version: 2, network: "base-sepolia", payload: {} },
      checkoutMetadata: storedUcpOnly,
    })

    expect(result).toEqual({ success: false, error: 'Prism instrument and credential type must be "x402"' })
    expect(mock.settle).not.toHaveBeenCalled()
  })

  it("rejects a credential whose type is not x402 without settling", async () => {
    const { handler, mock } = makeHandler()

    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "ucp",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential: { type: "card", x402Version: 2, network: "base-sepolia", payload: {} },
      checkoutMetadata: storedUcpOnly,
    })

    expect(result).toEqual({ success: false, error: 'Prism instrument and credential type must be "x402"' })
    expect(mock.settle).not.toHaveBeenCalled()
  })

  it("settles a typed wrapper credential with only the inner paymentPayload", async () => {
    const { handler, mock } = makeHandler()
    mock.settle.mockResolvedValue({ success: true, transactionHash: "0xabc" })
    const paymentPayload = SIGNED

    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "ucp",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential: { type: "x402", x402Version: 2, paymentPayload, paymentRequirements: {} },
      checkoutMetadata: storedUcpOnly,
    })

    expect(result.success).toBe(true)
    expect(mock.settle).toHaveBeenCalledWith({
      paymentPayload,
      paymentRequirements: samplePaymentHandlerConfig.accepts[0],
    })
  })

  it("fails clearly when no Prism config is stored", async () => {
    const { handler } = makeHandler()

    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "ucp",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential: { type: "x402" },
      checkoutMetadata: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no prism payment config/i)
  })

  it("fails clearly when the credential's network can't be matched to any accepts entry", async () => {
    const { handler, mock } = makeHandler()

    const baseEntry = samplePaymentHandlerConfig.accepts[0]
    const arbEntry = { ...baseEntry, network: "arbitrum-sepolia", asset: "USDC-arb" }
    const multiAcceptsConfig: PaymentHandlerConfig = {
      ...samplePaymentHandlerConfig,
      accepts: [arbEntry, baseEntry],
    }
    const multiUcp: UcpCheckoutPrepareResponse = {
      "xyz.fd.prism_payment": [{ id: "xyz.fd.prism_payment", version: "2026-10-07", config: multiAcceptsConfig }],
    }

    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      protocol: "ucp",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential: { type: "x402", ...signedFor({ ...baseEntry, network: "polygon-mumbai" }) },
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: {
          ucp: multiUcp,
          acp: null,
          preparedAmount: 1099, preparedCurrency: "USD",
          preparedResourceUrl: "https://store.test/checkout/abc",
        },
      },
    })

    expect(result).toMatchObject({ success: false, code: "no_matching_accepts_entry" })
    expect(mock.settle).not.toHaveBeenCalled()
  })
})

const HERE = dirname(fileURLToPath(import.meta.url))
const recordedPrism = (name: string) =>
  JSON.parse(readFileSync(join(HERE, "..", "..", "core", "src", "__fixtures__", "prism", name), "utf8"))

describe("PrismPaymentHandler — multi-version UCP", () => {
  it("puts the UCP version only in the handlers path", async () => {
    const calls: { url: string }[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input) })
      return new Response(JSON.stringify({ success: true, transaction: "0x1" }), { status: 200 })
    }) as typeof fetch
    try {
      const client = new PrismClient({ apiUrl: "https://gw.example", apiKey: "k" })
      const prepare = { amount: 100, currency: "USD", resourceUrl: "https://store.test/c/1" }
      await client.fetchUcpHandlers("2026-01-23")
      await client.fetchAcpHandlers()
      await client.preparePayment(prepare)
      await client.settle({ paymentPayload: {}, paymentRequirements: {} })
    } finally {
      globalThis.fetch = original
    }

    expect(calls.map((c) => c.url)).toEqual([
      "https://gw.example/ucp/2026-01-23/handlers",
      "https://gw.example/api/v2/merchant/acp/handlers",
      "https://gw.example/api/v2/merchant/payment-requirements",
      "https://gw.example/api/v2/payment/settle",
    ])
  })

  it("caches discovery per UCP version", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockImplementation(async (version?: string) => recordedPrism(`current-handlers-${version}.json`))

    await handler.getUcpDiscoveryHandlers("2026-04-08")
    await handler.getUcpDiscoveryHandlers("2026-01-23")
    await handler.getUcpDiscoveryHandlers("2026-04-08")
    const v0123 = await handler.getUcpDiscoveryHandlers("2026-01-23")

    expect(mock.fetchUcpHandlers.mock.calls).toEqual([["2026-04-08"], ["2026-01-23"]])
    expect(v0123[PRISM_HANDLER_ID][0].spec).toContain("2026-01-23")
  })

  it("accepts a 2026-01-23 entry without available_instruments", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(recordedPrism("current-handlers-2026-01-23.json"))
    const [entry] = (await handler.getUcpDiscoveryHandlers("2026-01-23"))[PRISM_HANDLER_ID]
    expect(entry.available_instruments).toBeUndefined()
    expect(entry.schema).toBe("https://gw.example/ucp/2026-01-23/schema.json")
  })

  it.each(["legacy-handlers.json", "legacy-namespace-id-handlers.json"])(
    "maps the legacy entry in %s to one canonical entry",
    async (fixture) => {
      const { handler, mock } = makeHandler()
      mock.fetchUcpHandlers.mockResolvedValue(recordedPrism(fixture))
      const discovered = await handler.getUcpDiscoveryHandlers("2026-04-08")

      expect(discovered[PRISM_HANDLER_ID]).toHaveLength(1)
      expect(discovered[PRISM_HANDLER_ID][0]).toMatchObject({
        id: PRISM_HANDLER_ID,
        version: "2026-01-15",
        spec: "https://gw.example/ucp/prism.md",
        schema: "https://gw.example/ucp/schema.json",
        config: {},
      })
    },
  )

  it("answers to the x402 alias", () => {
    expect(new PrismPaymentHandler({ apiKey: "k" }).aliases).toEqual(["x402"])
  })

  it.each([
    ["tokenized", { type: "x402" }],
    ["default", { type: "x402" }],
    [undefined, { type: "x402" }],
    ["x402", {}],
    [undefined, {}],
  ])("settles an original-era instrument with type %s and credential %j", async (instrumentType, credentialType) => {
    const { handler, mock } = makeHandler()
    mock.settle.mockResolvedValue({ success: true, transactionHash: "0xabc" })
    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      handlerId: PRISM_HANDLER_ID,
      instrumentType,
      credential: { ...credentialType, ...SIGNED },
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: { ucp: sampleUcpPrepare, acp: null, preparedAmount: 1099, preparedCurrency: "USD", preparedResourceUrl: "https://store.test/checkout/abc" },
      },
    })

    expect(result).toEqual({ success: true, transactionReference: "0xabc", settled: { amount: 1099, currency: "USD" } })
  })
})

describe("PrismPaymentHandler — settled amount", () => {
  const credential = { type: "x402", ...SIGNED }

  it("refuses to settle when the stored config has no prepared amount", async () => {
    const { handler, mock } = makeHandler()
    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential,
      checkoutMetadata: { [PRISM_HANDLER_ID]: { ucp: sampleUcpPrepare, acp: null, preparedResourceUrl: "https://store.test/checkout/abc" } },
    })

    expect(result).toEqual({ success: false, error: "Prism payment config has no prepared amount" })
    expect(mock.settle).not.toHaveBeenCalled()
  })

  it("fails when the gateway reports success without a transaction reference", async () => {
    const { handler, mock } = makeHandler()
    mock.settle.mockResolvedValue({ success: true })
    const result = await handler.settlePayment({
      ucpVersion: TEST_UCP_VERSION,
      checkoutId: "abc",
      handlerId: PRISM_HANDLER_ID,
      instrumentType: "x402",
      credential,
      checkoutMetadata: { [PRISM_HANDLER_ID]: { ucp: sampleUcpPrepare, acp: null, preparedAmount: 1099, preparedCurrency: "USD", preparedResourceUrl: "https://store.test/checkout/abc" } },
    })

    expect(result).toEqual({ success: false, error: "Prism settlement returned no transaction reference" })
  })
})

describe("PrismPaymentHandler — signed credential check", () => {
  const stored = { [PRISM_HANDLER_ID]: { ucp: sampleUcpPrepare, acp: null, preparedAmount: 1099, preparedCurrency: "USD", preparedResourceUrl: "https://store.test/checkout/abc" } }
  const settle = (handler: PrismPaymentHandler, credential: unknown) =>
    handler.settlePayment({ ucpVersion: TEST_UCP_VERSION, checkoutId: "abc", protocol: "acp", handlerId: PRISM_HANDLER_ID, credential, checkoutMetadata: stored })

  it("settles the decoded payload of a base64 credential, the same object it checked", async () => {
    const { handler, mock } = makeHandler()
    mock.settle.mockResolvedValue({ success: true, transactionHash: "0xb64" })

    const result = await settle(handler, btoa(JSON.stringify(SIGNED)))

    expect(result.success).toBe(true)
    expect(mock.settle).toHaveBeenCalledWith({ paymentPayload: SIGNED, paymentRequirements: samplePaymentHandlerConfig.accepts[0] })
  })

  it.each([
    ["a payload without a signed authorization", { ...SIGNED, payload: { signature: "0xsig" } }],
    ["a base64 credential that does not decode", "%%%"],
    ["a non-object credential", 42],
  ])("refuses %s without settling", async (_label, credential) => {
    const { handler, mock } = makeHandler()

    const result = await settle(handler, credential)

    expect(result).toMatchObject({ success: false, code: "unreadable_payment_credential" })
    expect(mock.settle).not.toHaveBeenCalled()
  })

  const withAccepts = (accepts: PaymentHandlerConfig["accepts"]) => ({
    [PRISM_HANDLER_ID]: {
      ucp: { [PRISM_HANDLER_ID]: [{ id: PRISM_HANDLER_ID, version: "2026-10-07", config: { ...samplePaymentHandlerConfig, accepts } }] },
      acp: null, preparedAmount: 1099, preparedCurrency: "USD", preparedResourceUrl: "https://store.test/checkout/abc",
    },
  })
  const settleAgainst = (handler: PrismPaymentHandler, credential: unknown, accepts: PaymentHandlerConfig["accepts"]) =>
    handler.settlePayment({ ucpVersion: TEST_UCP_VERSION, checkoutId: "abc", protocol: "acp", handlerId: PRISM_HANDLER_ID, credential, checkoutMetadata: withAccepts(accepts) })

  it("matches an EVM recipient and asset regardless of checksum case", async () => {
    const { handler, mock } = makeHandler()
    mock.settle.mockResolvedValue({ success: true, transactionHash: "0xevm" })
    const entry = { ...samplePaymentHandlerConfig.accepts[0], network: "eip155:84532", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", payTo: "0xAbCdEf0000000000000000000000000000000001" }
    const credential = signedFor({ ...entry, asset: entry.asset.toLowerCase(), payTo: entry.payTo.toLowerCase() })

    const result = await settleAgainst(handler, credential, [entry])

    expect(result.success).toBe(true)
    expect(mock.settle).toHaveBeenCalledWith({ paymentPayload: credential, paymentRequirements: entry })
  })

  it("compares a non-EVM recipient exactly", async () => {
    const { handler, mock } = makeHandler()
    const entry = { ...samplePaymentHandlerConfig.accepts[0], network: "solana:devnet", asset: "MintAbc", payTo: "PayToAbc" }

    const result = await settleAgainst(handler, signedFor({ ...entry, payTo: "paytoabc" }), [entry])

    expect(result).toMatchObject({ success: false, code: "wrong_recipient" })
    expect(mock.settle).not.toHaveBeenCalled()
  })

  it("refuses a quote with two entries for the same network and asset", async () => {
    const { handler, mock } = makeHandler()
    const entry = samplePaymentHandlerConfig.accepts[0]

    const result = await settleAgainst(handler, SIGNED, [entry, { ...entry, payTo: "0xother" }])

    expect(result).toMatchObject({ success: false, code: "no_matching_accepts_entry", error: expect.stringMatching(/more than one entry/) })
    expect(mock.settle).not.toHaveBeenCalled()
  })

  it("refuses a hex-encoded signed value instead of reading it as the same amount", async () => {
    const { handler, mock } = makeHandler()

    const result = await settle(handler, signedFor(samplePaymentHandlerConfig.accepts[0], "0xF4240"))

    expect(result).toMatchObject({ success: false, code: "amount_mismatch" })
    expect(mock.settle).not.toHaveBeenCalled()
  })
})
