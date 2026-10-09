import { describe, it, expect, vi } from "vitest"
import { PaymentHandlerRegistry } from "./payment-handler-registry.js"
import type { PaymentHandlerAdapter, PaymentSettleInput } from "../types/payment-handler-adapter.js"

function adapter(id: string, aliases?: readonly string[]) {
  const settled: PaymentSettleInput[] = []
  const instance: PaymentHandlerAdapter = {
    id,
    name: id,
    aliases,
    getUcpDiscoveryHandlers: async () => ({}),
    getAcpDiscoveryHandlers: async () => [],
    prepareCheckoutPayment: async () => null,
    settlePayment: async (input) => {
      settled.push(input)
      return { success: true, transactionReference: "0xabc", settled: { amount: 1000, currency: "USD" }, replayKeys: [] }
    },
    getUcpCheckoutHandlers: () => ({}),
    getAcpCheckoutHandlers: () => [],
  }
  return { instance, settled }
}

describe("PaymentHandlerRegistry handler aliases", () => {
  it("resolves an alias to its adapter and settles under the canonical id", async () => {
    const prism = adapter("xyz.fd.prism_payment", ["x402"])
    const registry = new PaymentHandlerRegistry()
    registry.registerAdapter(prism.instance)

    expect(registry.getAdapter("x402")).toBe(prism.instance)
    const result = await registry.settlePayment({
      checkoutId: "c1",
      channel: "default-channel",
      handlerId: "x402",
      ucpVersion: "2026-04-08",
      credential: {},
      checkoutMetadata: { "xyz.fd.prism_payment": { prepared: true } },
    })

    expect(result.success).toBe(true)
    expect(prism.settled[0].handlerId).toBe("xyz.fd.prism_payment")
  })

  it("prefers an exact id over an alias of another adapter", () => {
    const aliased = adapter("xyz.fd.prism_payment", ["x402"])
    const exact = adapter("x402")
    const registry = new PaymentHandlerRegistry()
    registry.registerAdapter(aliased.instance)
    registry.registerAdapter(exact.instance)
    expect(registry.getAdapter("x402")).toBe(exact.instance)
  })

  it("still rejects an unknown handler id", async () => {
    const registry = new PaymentHandlerRegistry()
    registry.registerAdapter(adapter("xyz.fd.prism_payment", ["x402"]).instance)
    expect(await registry.settlePayment({ checkoutId: "c1", handlerId: "other", credential: {} })).toEqual({
      success: false,
      error: "Unknown payment handler: other",
    })
  })

  it("passes the requested UCP version to the discovery of every adapter", async () => {
    const seen: (string | undefined)[] = []
    const registry = new PaymentHandlerRegistry()
    registry.registerAdapter({
      ...adapter("a").instance,
      getUcpDiscoveryHandlers: async (version?: string) => {
        seen.push(version)
        return {}
      },
    })
    await registry.getUcpDiscoveryHandlers("2026-01-23")
    await registry.getUcpDiscoveryHandlers()
    expect(seen).toEqual(["2026-01-23", undefined])
  })
})

describe("PaymentHandlerRegistry checkout prepare", () => {
  it("returns null for an adapter whose prepare throws, so its old requirements are cleared with the new quote", async () => {
    const healthy = adapter("healthy")
    healthy.instance.prepareCheckoutPayment = async () => ({ prepared: true })
    const broken = adapter("broken")
    broken.instance.prepareCheckoutPayment = async () => { throw new Error("gateway unavailable") }
    const registry = new PaymentHandlerRegistry()
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    registry.registerAdapter(healthy.instance)
    registry.registerAdapter(broken.instance)

    const output = await registry.prepareCheckoutPayment({
      checkoutId: "c1",
      total: 1000,
      currencyCode: "USD",
      checkoutBaseUrl: "https://store.test",
      storeName: "Store",
      ucpVersion: "2026-04-08",
    })

    expect(output).toEqual({ healthy: { prepared: true }, broken: null })
  })
})
