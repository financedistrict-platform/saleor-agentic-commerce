import { afterEach, describe, expect, it, vi } from "vitest"
import { createMemoryPaymentReplayStore, resolvePaymentReplayStore } from "./payment-replay.js"

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
