export type PaymentReplayClaim =
  | { ok: true }
  | { ok: false; key: string; heldBy: string }

export interface PaymentReplayStore {
  claim(keys: readonly string[], checkoutId: string): Promise<PaymentReplayClaim>
}

export function createMemoryPaymentReplayStore(): PaymentReplayStore {
  const owners = new Map<string, string>()
  return {
    async claim(keys, checkoutId) {
      for (const key of keys) {
        const heldBy = owners.get(key)
        if (heldBy !== undefined && heldBy !== checkoutId) return { ok: false, key, heldBy }
      }
      for (const key of keys) owners.set(key, checkoutId)
      return { ok: true }
    },
  }
}

export function resolvePaymentReplayStore(store: PaymentReplayStore | undefined): PaymentReplayStore {
  if (store) return store
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return createMemoryPaymentReplayStore()
  throw new Error("paymentReplayStore is required outside development and test, so one settled payment cannot complete two checkouts")
}

export function settlementReplayKey(handlerId: string, reference: string): string {
  return JSON.stringify(["settlement", handlerId, reference])
}
