import { afterEach, describe, expect, it, vi } from "vitest"
import { createMemoryPaymentReplayStore, resolvePaymentReplayStore, settledReferenceFromKeys, settlementReplayKey } from "./payment-replay.js"

describe("memory payment replay store", () => {
  it("lets the same checkout claim its keys again", async () => {
    const store = createMemoryPaymentReplayStore()

    expect(await store.claim(["a", "b"], "checkout-1")).toEqual({ ok: true })
    expect(await store.claim(["a", "b"], "checkout-1")).toEqual({ ok: true })
  })

  it("refuses a key held by another checkout and claims none of the others", async () => {
    const store = createMemoryPaymentReplayStore()
    await store.claim(["a"], "checkout-1")

    expect(await store.claim(["b", "a"], "checkout-2")).toEqual({ ok: false, key: "a", heldBy: "checkout-1" })
    expect(await store.claim(["b"], "checkout-3")).toEqual({ ok: true })
  })

  it("lets only one of two concurrent claims on the same key win", async () => {
    const store = createMemoryPaymentReplayStore()

    const results = await Promise.all([store.claim(["a"], "checkout-1"), store.claim(["a"], "checkout-2")])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })
})

describe("resolvePaymentReplayStore", () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each(["production", "staging", undefined])("requires a store when NODE_ENV is %s", (env) => {
    vi.stubEnv("NODE_ENV", env)
    expect(() => resolvePaymentReplayStore(undefined)).toThrow(/paymentReplayStore/)
  })

  it.each(["development", "test"])("falls back to a memory store when NODE_ENV is %s", (env) => {
    vi.stubEnv("NODE_ENV", env)
    expect(resolvePaymentReplayStore(undefined)).toBeDefined()
  })
})

describe("payment replay store claims by checkout", () => {
  it("lists every key a checkout claimed and nothing claimed by others", async () => {
    const store = createMemoryPaymentReplayStore()
    await store.claim(["a", "b"], "checkout-1")
    await store.claim(["c"], "checkout-2")

    expect(await store.claimedBy("checkout-1")).toEqual(["a", "b"])
    expect(await store.claimedBy("checkout-2")).toEqual(["c"])
    expect(await store.claimedBy("checkout-3")).toEqual([])
  })

  it("finds the one settled reference a handler claimed", () => {
    const keys = ["x402-authorization", settlementReplayKey("test.pay", "0xtx"), "not json", JSON.stringify(["x402-transaction", "n", "0xtx"])]
    expect(settledReferenceFromKeys(keys, "test.pay")).toBe("0xtx")
  })

  it("ignores references claimed under another handler", () => {
    expect(settledReferenceFromKeys([settlementReplayKey("other.pay", "0xtx")], "test.pay")).toBeNull()
  })

  it("finds nothing when no settlement was claimed, or when more than one was", () => {
    expect(settledReferenceFromKeys([JSON.stringify(["x402-authorization", "n"])], "test.pay")).toBeNull()
    expect(settledReferenceFromKeys([settlementReplayKey("test.pay", "0x1"), settlementReplayKey("test.pay", "0x2")], "test.pay")).toBeNull()
  })

  it("finds the same reference when it was claimed twice", () => {
    const key = settlementReplayKey("test.pay", "0x1")
    expect(settledReferenceFromKeys([key, key], "test.pay")).toBe("0x1")
  })
})
