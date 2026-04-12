/**
 * Payment Handler Registry
 *
 * Manages registered payment handler adapters and delegates calls to all of them.
 *
 * When multiple adapters are registered:
 * - Discovery: merges all handler definitions (UCP: merge objects, ACP: concatenate arrays)
 * - Checkout prepare: calls all adapters in parallel
 * - Settlement: routes to the specific adapter by handler ID
 * - Response formatting: merges all handler blocks
 *
 * When zero adapters are registered (degraded mode):
 * - All methods return empty results
 * - The store still works, just without payment handler info in responses
 */

import type {
  PaymentHandlerAdapter,
  CheckoutPrepareInput,
  PaymentSettleInput,
  PaymentSettleResult,
} from "../types/payment-handler-adapter.js"

export class PaymentHandlerRegistry {
  private adapters: PaymentHandlerAdapter[] = []

  /**
   * Register a payment handler adapter.
   * Prevents duplicate registration by adapter ID.
   */
  registerAdapter(adapter: PaymentHandlerAdapter): void {
    if (this.adapters.some((a) => a.id === adapter.id)) {
      console.warn(`[payment-handler-registry] Adapter "${adapter.id}" already registered, skipping`)
      return
    }

    this.adapters.push(adapter)
    console.log(`[payment-handler-registry] Registered: ${adapter.name} (${adapter.id})`)
  }

  getAdapters(): readonly PaymentHandlerAdapter[] {
    return this.adapters
  }

  getAdapterCount(): number {
    return this.adapters.length
  }

  // -------------------------------------------------
  // Discovery
  // -------------------------------------------------

  async getUcpDiscoveryHandlers(): Promise<Record<string, unknown[]>> {
    if (this.adapters.length === 0) return {}

    const results = await Promise.allSettled(
      this.adapters.map((a) => a.getUcpDiscoveryHandlers()),
    )

    const merged: Record<string, unknown[]> = {}
    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const [namespace, entries] of Object.entries(result.value)) {
          if (!merged[namespace]) merged[namespace] = []
          merged[namespace].push(...entries)
        }
      } else {
        console.warn(`[payment-handler-registry] Discovery failed:`, result.reason)
      }
    }

    return merged
  }

  async getAcpDiscoveryHandlers(): Promise<unknown[]> {
    if (this.adapters.length === 0) return []

    const results = await Promise.allSettled(
      this.adapters.map((a) => a.getAcpDiscoveryHandlers()),
    )

    const merged: unknown[] = []
    for (const result of results) {
      if (result.status === "fulfilled") {
        merged.push(...result.value)
      } else {
        console.warn(`[payment-handler-registry] ACP discovery failed:`, result.reason)
      }
    }

    return merged
  }

  // -------------------------------------------------
  // Checkout preparation
  // -------------------------------------------------

  async prepareCheckoutPayment(
    input: CheckoutPrepareInput,
  ): Promise<Record<string, unknown | null>> {
    if (this.adapters.length === 0) return {}

    const results = await Promise.allSettled(
      this.adapters.map(async (a) => ({
        id: a.id,
        result: await a.prepareCheckoutPayment(input),
      })),
    )

    const output: Record<string, unknown | null> = {}
    for (const result of results) {
      if (result.status === "fulfilled") {
        output[result.value.id] = result.value.result
      } else {
        console.error(`[payment-handler-registry] Checkout-prepare failed:`, result.reason)
      }
    }

    return output
  }

  // -------------------------------------------------
  // Settlement — routes to specific adapter
  // -------------------------------------------------

  async settlePayment(input: PaymentSettleInput): Promise<PaymentSettleResult> {
    const adapter = this.adapters.find((a) => a.id === input.handlerId)
    if (!adapter) {
      return {
        success: false,
        error: `Unknown payment handler: ${input.handlerId}`,
      }
    }

    return adapter.settlePayment(input)
  }

  // -------------------------------------------------
  // Response formatting
  // -------------------------------------------------

  getUcpCheckoutHandlers(checkoutMetadata?: Record<string, unknown>): Record<string, unknown[]> {
    if (this.adapters.length === 0) return {}

    const merged: Record<string, unknown[]> = {}
    for (const adapter of this.adapters) {
      const handlers = adapter.getUcpCheckoutHandlers(checkoutMetadata)
      for (const [namespace, entries] of Object.entries(handlers)) {
        if (!merged[namespace]) merged[namespace] = []
        merged[namespace].push(...entries)
      }
    }

    return merged
  }

  getAcpCheckoutHandlers(checkoutMetadata?: Record<string, unknown>): unknown[] {
    if (this.adapters.length === 0) return []

    const merged: unknown[] = []
    for (const adapter of this.adapters) {
      merged.push(...adapter.getAcpCheckoutHandlers(checkoutMetadata))
    }

    return merged
  }
}
