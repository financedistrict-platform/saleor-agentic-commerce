import { describe, it, expect, vi } from "vitest"
import { PrismPaymentHandler, PRISM_HANDLER_ID } from "./handler.js"
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
  prepareUcpPayment: ReturnType<typeof vi.fn>
  prepareAcpPayment: ReturnType<typeof vi.fn>
  settle: ReturnType<typeof vi.fn>
}

function makeHandler() {
  const handler = new PrismPaymentHandler({ apiUrl: "https://test.example", apiKey: "k" })
  // Replace the client with a mock
  const mock: MockedClient = {
    fetchUcpHandlers: vi.fn(),
    fetchAcpHandlers: vi.fn(),
    prepareUcpPayment: vi.fn(),
    prepareAcpPayment: vi.fn(),
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
      id: "x402",
      version: "2026-01-15",
      spec: "https://test.example/ucp/prism.md",
      schema: "https://test.example/ucp/schema.json",
      config: {},
    },
  ],
}

const samplePaymentHandlerConfig: PaymentHandlerConfig = {
  x402Version: 2,
  resource: { url: "https://store.test/checkout/abc" },
  accepts: [
    {
      scheme: "exact",
      network: "base-sepolia",
      payTo: "0xabc",
      maxTimeoutSeconds: 600,
      asset: "USDC",
      amount: "1000000",
    },
  ],
}

const sampleUcpPrepare: UcpCheckoutPrepareResponse = {
  "xyz.fd.prism_payment": [
    {
      id: "x402",
      version: "2026-01-15",
      config: samplePaymentHandlerConfig,
    },
  ],
}

const sampleAcpHandler: AcpHandler = {
  id: "x402",
  name: "xyz.fd.prism_payment",
  version: "2026-01-15",
  spec: "https://test.example/acp/spec.md",
  requires_delegate_payment: false,
  requires_pci_compliance: false,
  psp: "prism",
  config_schema: "https://test.example/acp/config_schema.json",
  instrument_schemas: ["https://test.example/acp/instrument_schema.json"],
  config: samplePaymentHandlerConfig,
}

const baseInput = {
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

    const result = await handler.getUcpDiscoveryHandlers()

    expect(result).toEqual(sampleUcpDiscovery)
    expect(mock.fetchUcpHandlers).toHaveBeenCalledOnce()
  })

  it("includes the spec and schema fields that the legacy payment-profile endpoint omitted", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)

    const result = await handler.getUcpDiscoveryHandlers()

    const entry = result["xyz.fd.prism_payment"][0]
    expect(entry).toHaveProperty("spec")
    expect(entry).toHaveProperty("schema")
  })

  it("passes Prism's ACP discovery response through unchanged (no hand-construction)", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchAcpHandlers.mockResolvedValue([sampleAcpHandler])

    const result = await handler.getAcpDiscoveryHandlers()

    expect(result).toEqual([sampleAcpHandler])
    expect(mock.fetchAcpHandlers).toHaveBeenCalledOnce()
  })

  it("uses Prism's authoritative requires_delegate_payment instead of hardcoding false", async () => {
    const { handler, mock } = makeHandler()
    const handlerWithDelegate = { ...sampleAcpHandler, requires_delegate_payment: true }
    mock.fetchAcpHandlers.mockResolvedValue([handlerWithDelegate])

    const result = await handler.getAcpDiscoveryHandlers()

    expect((result[0] as AcpHandler).requires_delegate_payment).toBe(true)
  })

  it("caches discovery responses (TTL)", async () => {
    const { handler, mock } = makeHandler()
    mock.fetchUcpHandlers.mockResolvedValue(sampleUcpDiscovery)

    await handler.getUcpDiscoveryHandlers()
    await handler.getUcpDiscoveryHandlers()

    expect(mock.fetchUcpHandlers).toHaveBeenCalledOnce()
  })
})

describe("PrismPaymentHandler — prepareCheckoutPayment", () => {
  it("calls both UCP and ACP prepare endpoints in parallel", async () => {
    const { handler, mock } = makeHandler()
    mock.prepareUcpPayment.mockResolvedValue(sampleUcpPrepare)
    mock.prepareAcpPayment.mockResolvedValue(sampleAcpHandler)

    await handler.prepareCheckoutPayment(baseInput)

    expect(mock.prepareUcpPayment).toHaveBeenCalledOnce()
    expect(mock.prepareAcpPayment).toHaveBeenCalledOnce()
  })

  it("stores both UCP and ACP responses keyed for later retrieval", async () => {
    const { handler, mock } = makeHandler()
    mock.prepareUcpPayment.mockResolvedValue(sampleUcpPrepare)
    mock.prepareAcpPayment.mockResolvedValue(sampleAcpHandler)

    const data = await handler.prepareCheckoutPayment(baseInput)

    expect(data).not.toBeNull()
    expect(data!.ucp).toEqual(sampleUcpPrepare)
    expect(data!.acp).toEqual(sampleAcpHandler)
    expect(data!.preparedAmount).toBe(1099)
    expect(data!.preparedResourceUrl).toBe("https://store.test/checkout/abc")
  })

  it("succeeds when one protocol prepare fails (fail-soft per protocol)", async () => {
    const { handler, mock } = makeHandler()
    mock.prepareUcpPayment.mockResolvedValue(sampleUcpPrepare)
    mock.prepareAcpPayment.mockRejectedValue(new Error("ACP unavailable"))

    const data = await handler.prepareCheckoutPayment(baseInput)

    expect(data).not.toBeNull()
    expect(data!.ucp).toEqual(sampleUcpPrepare)
    expect(data!.acp).toBeNull()
  })

  it("returns null when both protocols fail", async () => {
    const { handler, mock } = makeHandler()
    mock.prepareUcpPayment.mockRejectedValue(new Error("UCP down"))
    mock.prepareAcpPayment.mockRejectedValue(new Error("ACP down"))

    const data = await handler.prepareCheckoutPayment(baseInput)

    expect(data).toBeNull()
  })

  it("is idempotent — same checkout + same total returns cached blob without re-calling Prism", async () => {
    const { handler, mock } = makeHandler()

    const stored = {
      ucp: sampleUcpPrepare,
      acp: sampleAcpHandler,
      preparedAmount: 1099,
      preparedResourceUrl: "https://store.test/checkout/abc",
    }

    const result = await handler.prepareCheckoutPayment({
      ...baseInput,
      checkoutMetadata: { [PRISM_HANDLER_ID]: stored },
    })

    expect(result).toEqual(stored)
    expect(mock.prepareUcpPayment).not.toHaveBeenCalled()
    expect(mock.prepareAcpPayment).not.toHaveBeenCalled()
  })

  it("re-prepares when the total changes", async () => {
    const { handler, mock } = makeHandler()
    mock.prepareUcpPayment.mockResolvedValue(sampleUcpPrepare)
    mock.prepareAcpPayment.mockResolvedValue(sampleAcpHandler)

    const stored = {
      ucp: sampleUcpPrepare,
      acp: sampleAcpHandler,
      preparedAmount: 999, // different from baseInput.total
      preparedResourceUrl: "https://store.test/checkout/abc",
    }

    await handler.prepareCheckoutPayment({
      ...baseInput,
      checkoutMetadata: { [PRISM_HANDLER_ID]: stored },
    })

    expect(mock.prepareUcpPayment).toHaveBeenCalledOnce()
    expect(mock.prepareAcpPayment).toHaveBeenCalledOnce()
  })
})

describe("PrismPaymentHandler — checkout-context handlers", () => {
  it("returns the stored UCP shape verbatim from getUcpCheckoutHandlers", () => {
    const { handler } = makeHandler()
    const stored = {
      ucp: sampleUcpPrepare,
      acp: sampleAcpHandler,
      preparedAmount: 1099,
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
      preparedAmount: 1099,
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

    const credential = { x402Version: 2, scheme: "exact", network: "base-sepolia", payload: {} }

    const result = await handler.settlePayment({
      checkoutId: "abc",
      handlerId: PRISM_HANDLER_ID,
      credential,
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: {
          ucp: sampleUcpPrepare,
          acp: null,
          preparedAmount: 1099,
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

    const credential = { x402Version: 2, scheme: "exact", network: "base-sepolia", payload: {} }

    await handler.settlePayment({
      checkoutId: "abc",
      handlerId: PRISM_HANDLER_ID,
      credential,
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: {
          ucp: null,
          acp: sampleAcpHandler,
          preparedAmount: 1099,
          preparedResourceUrl: "https://store.test/checkout/abc",
        },
      },
    })

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
      "xyz.fd.prism_payment": [{ id: "x402", version: "2026-01-15", config: multiAcceptsConfig }],
    }

    await handler.settlePayment({
      checkoutId: "abc",
      handlerId: PRISM_HANDLER_ID,
      credential: { x402Version: 2, scheme: "exact", network: "base-sepolia", payload: {} },
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: {
          ucp: multiUcp,
          acp: null,
          preparedAmount: 1099,
          preparedResourceUrl: "https://store.test/checkout/abc",
        },
      },
    })

    expect(mock.settle).toHaveBeenCalledWith({
      paymentPayload: expect.anything(),
      paymentRequirements: baseEntry,
    })
  })

  it("fails clearly when no Prism config is stored", async () => {
    const { handler } = makeHandler()

    const result = await handler.settlePayment({
      checkoutId: "abc",
      handlerId: PRISM_HANDLER_ID,
      credential: {},
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
      "xyz.fd.prism_payment": [{ id: "x402", version: "2026-01-15", config: multiAcceptsConfig }],
    }

    const result = await handler.settlePayment({
      checkoutId: "abc",
      handlerId: PRISM_HANDLER_ID,
      credential: { x402Version: 2, scheme: "exact", network: "polygon-mumbai", payload: {} },
      checkoutMetadata: {
        [PRISM_HANDLER_ID]: {
          ucp: multiUcp,
          acp: null,
          preparedAmount: 1099,
          preparedResourceUrl: "https://store.test/checkout/abc",
        },
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/could not match/i)
    expect(mock.settle).not.toHaveBeenCalled()
  })
})
