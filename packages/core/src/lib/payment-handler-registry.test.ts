import { describe, expect, it } from "vitest"
import { PaymentHandlerRegistry } from "./payment-handler-registry.js"
import type { PaymentHandlerAdapter, PaymentSettleInput, SettlementDeclaration } from "../types/payment-handler-adapter.js"

function adapter(settlementKeys?: (input: PaymentSettleInput) => SettlementDeclaration | null): PaymentHandlerAdapter {
  return {
    id: "test.pay",
    name: "Test Pay",
    getUcpDiscoveryHandlers: async () => ({}),
    getAcpDiscoveryHandlers: async () => [],
    prepareCheckoutPayment: async () => null,
    settlePayment: async () => ({ success: false, error: "not used" }),
    getUcpCheckoutHandlers: () => ({}),
    getAcpCheckoutHandlers: () => [],
    ...(settlementKeys ? { settlementKeys } : {}),
  } as PaymentHandlerAdapter
}

const input: PaymentSettleInput = {
  checkoutId: "c1",
  channel: "default-channel",
  handlerId: "test.pay",
  ucpVersion: "2026-04-08",
  credential: {},
  checkoutMetadata: { "test.pay": { prepared: true } },
}

function registryWith(handler: PaymentHandlerAdapter, channels: readonly string[] | null = null) {
  const registry = new PaymentHandlerRegistry()
  registry.registerAdapter(handler, channels)
  return registry
}

describe("PaymentHandlerRegistry settlement resolution", () => {
  it("passes on the keys and the expiry a handler declares", () => {
    const registry = registryWith(adapter(() => ({ ok: true, keys: ["k1", "k2"], expiresAt: 1234 })))

    expect(registry.resolveSettlement(input)).toEqual({ kind: "declared", handlerId: "test.pay", keys: ["k1", "k2"], expiresAt: 1234 })
  })

  it("passes on the amount a handler declares it will settle", () => {
    const settled = { amount: 5497, currency: "USD" }
    const registry = registryWith(adapter(() => ({ ok: true, keys: ["k1"], settled })))

    expect(registry.resolveSettlement(input)).toEqual({ kind: "declared", handlerId: "test.pay", keys: ["k1"], settled })
  })

  it("passes on the details a handler declares for whoever has to look the payment up", () => {
    const details = { network: "eip155:84532", nonce: "0x01" }
    const registry = registryWith(adapter(() => ({ ok: true, keys: ["k1"], details })))

    expect(registry.resolveSettlement(input)).toEqual({ kind: "declared", handlerId: "test.pay", keys: ["k1"], details })
  })

  it("omits the expiry when the handler declares none", () => {
    const registry = registryWith(adapter(() => ({ ok: true, keys: ["k1"] })))

    expect(registry.resolveSettlement(input)).toEqual({ kind: "declared", handlerId: "test.pay", keys: ["k1"] })
  })

  it("reports the canonical handler id when the request names an alias", () => {
    const registry = registryWith({ ...adapter(() => ({ ok: true, keys: ["k1"] })), aliases: ["pay-alias"] })

    expect(registry.resolveSettlement({ ...input, handlerId: "pay-alias" })).toMatchObject({ kind: "declared", handlerId: "test.pay" })
  })

  it.each([
    ["has no way to declare keys", undefined],
    ["declares nothing", () => null],
    ["declares an empty list", () => ({ ok: true as const, keys: [] })],
    ["declares an empty key", () => ({ ok: true as const, keys: ["k1", ""] })],
  ])("treats a handler that %s as unchecked", (_case, declare) => {
    expect(registryWith(adapter(declare)).resolveSettlement(input)).toEqual({ kind: "unchecked", handlerId: "test.pay" })
  })

  it("passes on a refusal from the handler", () => {
    const registry = registryWith(adapter(() => ({ ok: false, code: "payment_expired", error: "expired" })))

    expect(registry.resolveSettlement(input)).toEqual({ kind: "refused", code: "payment_expired", error: "expired" })
  })

  it("refuses an unknown handler, a channel it is not enabled for and an unprepared checkout without asking the handler", () => {
    let asked = 0
    const handler = adapter(() => { asked++; return { ok: true, keys: ["k1"] } })

    expect(registryWith(handler).resolveSettlement({ ...input, handlerId: "other" })).toMatchObject({ kind: "refused" })
    expect(registryWith(handler, ["another-channel"]).resolveSettlement(input)).toMatchObject({ kind: "refused", code: "payment_handler_unavailable" })
    expect(registryWith(handler).resolveSettlement({ ...input, checkoutMetadata: {} })).toMatchObject({ kind: "refused", code: "payment_handler_not_prepared" })
    expect(asked).toBe(0)
  })

  it("marks every refusal made before the handler runs as declined", async () => {
    const registry = registryWith(adapter(), ["another-channel"])

    expect(await registry.settlePayment(input)).toMatchObject({ success: false, outcome: "declined", code: "payment_handler_unavailable" })
    expect(await registry.settlePayment({ ...input, handlerId: "other" })).toMatchObject({ success: false, outcome: "declined" })
    expect(await registryWith(adapter()).settlePayment({ ...input, checkoutMetadata: {} })).toMatchObject({ success: false, outcome: "declined", code: "payment_handler_not_prepared" })
  })
})
