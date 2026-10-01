import { describe, it, expect } from "vitest"
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
      return { success: true, transactionReference: "0xabc" }
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
    const result = await registry.settlePayment({ checkoutId: "c1", handlerId: "x402", credential: {} })

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
