import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { settlementReplayKey } from "@financedistrict/saleor-agentic-commerce-core"
import type { PaymentHandlerAdapter, PaymentSettleInput, SaleorCheckout } from "@financedistrict/saleor-agentic-commerce-core"
import { ACP_AUTH, buildRoutes, checkoutTemplate, CHECKOUT_ID, freshQuote, params, stubPrismGateway, ucpRequest } from "./__tests__/harness.js"
import { resolvePendingSettlement } from "./resolve-pending-settlement.js"

const UCP_SESSIONS = "https://store.test/api/ucp/checkout-sessions"
const PRISM = "xyz.fd.prism_payment"
const OTHER_ID = "Q2hlY2tvdXQ6Mg=="
const QUOTE_KEY = "agentic_commerce__quote"
const SETTLEMENT_KEY = "agentic_commerce__settlement"
const QUOTED = {
  scheme: "exact",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x1111111111111111111111111111111111111111",
  amount: "1000000",
}

type Built = ReturnType<typeof buildRoutes>

let gateway: ReturnType<typeof stubPrismGateway>

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  gateway?.restore()
  vi.restoreAllMocks()
})

const settleRequests = () => gateway.requests.filter((r) => r.url.endsWith("/api/v2/payment/settle"))
const idle = () => new Promise<void>((resolve) => setTimeout(resolve, 10))

const LOOKUP_DETAILS = {
  network: QUOTED.network,
  asset: QUOTED.asset,
  payer: "0xbuyer",
  nonce: "0x01",
  validBefore: "9999999999",
}

function reviewLines(): string[] {
  return vi.mocked(console.error).mock.calls.map((call) => String(call[0])).filter((line) => line.includes("needs review"))
}

function reviewFields(line: string) {
  return JSON.parse(line.slice(line.indexOf("{")))
}

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

function signed(nonce = "0x01", validBefore = "9999999999") {
  return {
    type: "x402",
    x402Version: 2,
    accepted: { ...QUOTED, maxTimeoutSeconds: 300 },
    payload: {
      signature: "0xsig",
      authorization: { from: "0xbuyer", to: QUOTED.payTo, value: QUOTED.amount, validAfter: "0", validBefore, nonce },
    },
  }
}

function prismRoutes() {
  const other = checkoutTemplate()
  other.id = OTHER_ID
  return buildRoutes({ prism: true, checkouts: [checkoutTemplate(), other] })
}

function pay(routes: Built["routes"], id: string, credential: object = signed()) {
  return routes.checkoutSessionComplete.POST(
    ucpRequest(`${UCP_SESSIONS}/${id}/complete`, {
      body: { payment: { instruments: [{ id: "inst_1", handler_id: PRISM, type: "x402", credential }] } },
    }),
    params({ id }),
  )
}

async function code(response: Response): Promise<string> {
  return (await response.json()).messages[0].code
}

function record(saleor: Built["saleor"], id: string) {
  const raw = saleor.checkouts.get(id)!.privateMetadata.find((m) => m.key === SETTLEMENT_KEY)?.value
  return raw === undefined ? undefined : JSON.parse(raw)
}

function failRecordWrites(saleor: Built["saleor"], states: readonly string[]) {
  const original = saleor.client.updatePrivateMetadata.bind(saleor.client)
  const outage = { down: true }
  saleor.client.updatePrivateMetadata = async (id, items) => {
    const hit = items.some((item) => item.key === SETTLEMENT_KEY && states.includes(JSON.parse(item.value).state))
    return outage.down && hit ? { ok: false as const, error: "saleor unavailable" } : original(id, items)
  }
  return outage
}

const SETTLED_WRITES = ["settled", "held", "failed"]

function acpPay(acpRoutes: Built["acpRoutes"], id: string, credential: object = signed()) {
  return acpRoutes.checkoutSessionComplete.POST(
    new Request(`https://store.test/api/acp/checkout_sessions/${id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACP_AUTH },
      body: JSON.stringify({ payment_data: { handler_id: PRISM, instrument: { credential } } }),
    }),
    params({ id }),
  )
}

describe("Complete after the gateway settled but the settlement could not be saved", () => {
  it("finishes the retry from the transaction already claimed, without calling the gateway again", async () => {
    let calls = 0
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: `0xtx${++calls}` }) })
    const { routes, saleor } = prismRoutes()
    const outage = failRecordWrites(saleor, SETTLED_WRITES)

    const first = await pay(routes, CHECKOUT_ID)
    outage.down = false
    const retry = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(422)
    expect(await code(first)).toBe("settlement_not_recorded")
    expect(retry.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.transactions).toEqual([
      { checkoutId: CHECKOUT_ID, name: "Finance District Prism", pspReference: "0xtx1", amountCharged: { amount: 54.97, currency: "USD" } },
    ])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "settled", reference: "0xtx1" })
  })

  it("never calls the gateway again while retries keep failing, even when the gateway answers a repeated authorization with a generic error", async () => {
    let calls = 0
    gateway = stubPrismGateway({
      settle: () => (++calls === 1 ? { success: true, transaction: "0xtx1" } : { success: false, errorReason: "authorization is already used" }),
    })
    const { routes, saleor } = prismRoutes()
    const outage = failRecordWrites(saleor, SETTLED_WRITES)

    const first = await pay(routes, CHECKOUT_ID)
    const second = await pay(routes, CHECKOUT_ID)
    outage.down = false
    const third = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(422)
    expect(second.status).toBe(422)
    expect(await code(second)).toBe("settlement_not_recorded")
    expect(third.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})

describe("Complete when the gateway gives no answer", () => {
  it("holds the checkout as pending and does not call the gateway on the retry", async () => {
    gateway = stubPrismGateway({ settle: () => { throw new Error("socket hang up") } })
    const { routes, saleor } = prismRoutes()

    const first = await pay(routes, CHECKOUT_ID)
    const retry = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(409)
    expect(await code(first)).toBe("settlement_pending")
    expect(retry.status).toBe(409)
    expect(await code(retry)).toBe("settlement_pending")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({
      state: "pending",
      handlerId: PRISM,
      amount: 5497,
      currency: "USD",
      expiresAt: new Date(9999999999 * 1000).toISOString(),
      details: LOOKUP_DETAILS,
    })
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("logs one line a person can search by checkout, without the signature", async () => {
    gateway = stubPrismGateway({ settle: () => { throw new Error("socket hang up") } })
    const { routes, saleor } = prismRoutes()

    await pay(routes, CHECKOUT_ID)
    await pay(routes, CHECKOUT_ID)

    const lines = reviewLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("[ucp-routes] settlement pending needs review")
    expect(reviewFields(lines[0])).toMatchObject({
      checkoutId: CHECKOUT_ID,
      state: "pending",
      handlerId: PRISM,
      attemptId: record(saleor, CHECKOUT_ID).attemptId,
      startedAt: record(saleor, CHECKOUT_ID).startedAt,
      expiresAt: new Date(9999999999 * 1000).toISOString(),
      ...LOOKUP_DETAILS,
    })
    expect(lines[0]).not.toContain("0xsig")
    expect(JSON.stringify(record(saleor, CHECKOUT_ID))).not.toContain("0xsig")
  })

  it("answers an ACP complete the same way", async () => {
    gateway = stubPrismGateway({ settle: () => { throw new Error("socket hang up") } })
    const { acpRoutes, saleor } = buildRoutes({ prism: true, checkouts: [checkoutTemplate()], config: { acpEnabled: true } })

    const first = await acpPay(acpRoutes, CHECKOUT_ID)
    const retry = await acpPay(acpRoutes, CHECKOUT_ID)

    expect(first.status).toBe(409)
    expect((await first.json()).code).toBe("settlement_pending")
    expect((await retry.json()).code).toBe("settlement_pending")
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toHaveLength(0)
  })

  it("does not submit the payment when the pending record cannot be saved", async () => {
    gateway = stubPrismGateway()
    const { routes, saleor } = prismRoutes()
    failRecordWrites(saleor, ["pending"])

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(422)
    expect(await code(response)).toBe("settlement_not_started")
    expect(settleRequests()).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("treats a failure that names no outcome as having no known outcome", async () => {
    const { adapter, settled } = handlerWith(() => ({ success: false, error: "gateway said something unreadable" }), () => ["handler-key"])
    const { routes, saleor } = buildRoutes({ handlers: [adapter], checkouts: [handlerCheckout()] })

    const first = await completeWith(routes)
    const retry = await completeWith(routes)

    expect(first.status).toBe(409)
    expect(await code(first)).toBe("settlement_pending")
    expect(retry.status).toBe(409)
    expect(settled).toHaveLength(1)
    expect(saleor.completed).toHaveLength(0)
  })

  it("treats a handler that throws as having no known outcome", async () => {
    const { adapter } = handlerWith(() => { throw new Error("handler crashed") }, () => ["handler-key"])
    const { routes, saleor } = buildRoutes({ handlers: [adapter], checkouts: [handlerCheckout()] })

    const response = await completeWith(routes)

    expect(response.status).toBe(409)
    expect(await code(response)).toBe("settlement_pending")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "pending" })
  })
})

describe("Complete when the gateway declines the payment", () => {
  it("records the failure and settles again on the retry", async () => {
    let calls = 0
    gateway = stubPrismGateway({
      settle: () => (++calls === 1 ? { success: false, errorReason: "insufficient_funds" } : { success: true, transaction: "0xtx2" }),
    })
    const { routes, saleor } = prismRoutes()

    const first = await pay(routes, CHECKOUT_ID)
    const failed = record(saleor, CHECKOUT_ID)
    const retry = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(422)
    expect(failed).toMatchObject({ state: "failed", amount: 5497, currency: "USD" })
    expect(retry.status).toBe(200)
    expect(settleRequests()).toHaveLength(2)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})

describe("Complete when a decline arrives after another attempt took over the record", () => {
  it("leaves the record of the other attempt alone", async () => {
    const built = prismRoutes()
    const other = { state: "pending", attemptId: "attempt-other", handlerId: PRISM, keys: ["k"], amount: 5497, currency: "USD", startedAt: "2026-10-09T00:00:00.000Z" }
    gateway = stubPrismGateway({
      settle: async () => {
        await built.saleor.client.updatePrivateMetadata(CHECKOUT_ID, [{ key: SETTLEMENT_KEY, value: JSON.stringify(other) }])
        return { success: false, errorReason: "insufficient_funds" }
      },
    })

    const response = await pay(built.routes, CHECKOUT_ID)

    expect(response.status).toBe(422)
    expect(record(built.saleor, CHECKOUT_ID)).toMatchObject({ state: "pending", attemptId: "attempt-other" })
  })
})

describe("Complete when the gateway settled something other than what was signed", () => {
  it("holds the checkout and never calls the gateway again", async () => {
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: "0xmoved", payer: "0xsomeoneelse" }) })
    const { routes, saleor } = prismRoutes()

    const first = await pay(routes, CHECKOUT_ID)
    const retry = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(409)
    expect(await code(first)).toBe("settled_payment_mismatch")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "held", reference: "0xmoved", handlerId: PRISM, details: LOOKUP_DETAILS })
    expect(record(saleor, CHECKOUT_ID)).toHaveProperty("attemptId")
    expect(record(saleor, CHECKOUT_ID)).toHaveProperty("startedAt")
    expect(record(saleor, CHECKOUT_ID)).toHaveProperty("expiresAt", new Date(9999999999 * 1000).toISOString())
    expect(JSON.stringify(record(saleor, CHECKOUT_ID))).not.toContain("0xsig")
    const lines = reviewLines()
    expect(lines).toHaveLength(1)
    expect(reviewFields(lines[0])).toMatchObject({ checkoutId: CHECKOUT_ID, state: "held", reference: "0xmoved", code: "settled_payment_mismatch", ...LOOKUP_DETAILS })
    expect(lines[0]).not.toContain("0xsig")
    expect(retry.status).toBe(409)
    expect(await code(retry)).toBe("settled_payment_mismatch")
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })
})

describe("Two completes in flight at the same time", () => {
  it("lets one of two checkouts paying with the same authorization reach the gateway", async () => {
    const gate = deferred()
    let calls = 0
    gateway = stubPrismGateway({ settle: async () => { await gate.promise; return { success: true, transaction: `0xtx${++calls}` } } })
    const { routes, saleor } = prismRoutes()

    const both = Promise.all([pay(routes, CHECKOUT_ID), pay(routes, OTHER_ID)])
    await idle()
    gate.release()
    const responses = await both

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    const refused = responses.find((r) => r.status === 409)!
    expect(await code(refused)).toBe("payment_already_used")
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toHaveLength(1)
  })

  it("places one transaction and one order when the same checkout is completed twice", async () => {
    const gate = deferred()
    gateway = stubPrismGateway({ settle: async () => { await gate.promise; return { success: true, transaction: "0xtx1" } } })
    const { routes, saleor } = prismRoutes()

    const both = Promise.all([pay(routes, CHECKOUT_ID), pay(routes, CHECKOUT_ID)])
    await idle()
    gate.release()
    const responses = await both

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    const refused = responses.find((r) => r.status === 409)!
    expect(await code(refused)).toBe("settlement_in_progress")
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.transactions).toHaveLength(1)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "settled", reference: "0xtx1" })
  })
})

function handlerWith(settle: () => unknown, keys?: () => readonly string[], declaredAmount?: { amount: number; currency: string }) {
  const settled: PaymentSettleInput[] = []
  const adapter = {
    id: "test.handler",
    name: "Test Handler",
    async getUcpDiscoveryHandlers() { return {} },
    async getAcpDiscoveryHandlers() { return [] },
    async prepareCheckoutPayment() { return null },
    async settlePayment(input) {
      settled.push(input)
      return settle() as never
    },
    getUcpCheckoutHandlers() { return {} },
    getAcpCheckoutHandlers() { return [] },
    ...(keys ? { settlementKeys: () => ({ ok: true as const, keys: keys(), ...(declaredAmount ? { settled: declaredAmount } : {}) }) } : {}),
  } as PaymentHandlerAdapter
  return { adapter, settled }
}

function handlerCheckout(extra: { key: string; value: string }[] = []): SaleorCheckout {
  const checkout = checkoutTemplate()
  checkout.privateMetadata = [
    { key: QUOTE_KEY, value: freshQuote({ amount: 5497, currency: "USD" }) },
    { key: "test.handler", value: JSON.stringify({ prepared: true }) },
    ...extra,
  ]
  return checkout
}

function completeWith(routes: Built["routes"], id = CHECKOUT_ID) {
  return routes.checkoutSessionComplete.POST(
    ucpRequest(`${UCP_SESSIONS}/${id}/complete`, {
      body: { payment: { instruments: [{ id: "inst_1", handler_id: "test.handler", type: "test", credential: { token: "none" } }] } },
    }),
    params({ id }),
  )
}

const OK_SETTLE = { success: true, transactionReference: "0xhandler", settled: { amount: 5497, currency: "USD" }, replayKeys: [] }

describe("Complete through a handler that does not declare what it settles", () => {
  it.each([
    ["no settlement keys", undefined],
    ["an empty list of settlement keys", () => []],
  ])("refuses before settling when the handler gives %s", async (_case, keys) => {
    const { adapter, settled } = handlerWith(() => OK_SETTLE, keys)
    const { routes, saleor } = buildRoutes({ handlers: [adapter], checkouts: [handlerCheckout()] })

    const response = await completeWith(routes)

    expect(response.status).toBe(409)
    expect(await code(response)).toBe("settled_payment_unchecked")
    expect(settled).toHaveLength(0)
    expect(record(saleor, CHECKOUT_ID)).toBeUndefined()
    expect(saleor.completed).toHaveLength(0)
  })

  it("completes from a settlement record written before settlement states existed", async () => {
    const { adapter, settled } = handlerWith(() => OK_SETTLE)
    const legacy = { key: SETTLEMENT_KEY, value: JSON.stringify({ handlerId: "test.handler", reference: "0xprior", amount: 5497, currency: "USD", settledAt: "2026-10-09T00:00:00.000Z" }) }
    const { routes, saleor } = buildRoutes({ handlers: [adapter], checkouts: [handlerCheckout([legacy])] })

    const response = await completeWith(routes)

    expect(response.status).toBe(200)
    expect(settled).toHaveLength(0)
    expect(saleor.transactions.map((t) => t.pspReference)).toEqual(["0xprior"])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})

describe("Complete with a credential that has already expired", () => {
  it("refuses before the gateway and records nothing", async () => {
    gateway = stubPrismGateway()
    const { routes, saleor } = prismRoutes()

    const response = await pay(routes, CHECKOUT_ID, signed("0x01", "1"))

    expect(response.status).toBe(422)
    expect(await code(response)).toBe("payment_expired")
    expect(settleRequests()).toHaveLength(0)
    expect(record(saleor, CHECKOUT_ID)).toBeUndefined()
    expect(saleor.completed).toHaveLength(0)
  })
})

describe("Complete when the settled payment cannot be accepted", () => {
  const kept = () => ["handler-key"]

  it("holds a settlement whose handler reported no way to detect reuse, and does not settle again", async () => {
    const { adapter, settled } = handlerWith(() => ({ success: true, transactionReference: "0xhandler", settled: { amount: 5497, currency: "USD" } }), kept)
    const { routes, saleor } = buildRoutes({ handlers: [adapter], checkouts: [handlerCheckout()] })

    const first = await completeWith(routes)
    const retry = await completeWith(routes)

    expect(first.status).toBe(409)
    expect(await code(first)).toBe("settled_payment_unchecked")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "held", reference: "0xhandler", code: "settled_payment_unchecked" })
    expect(retry.status).toBe(409)
    expect(await code(retry)).toBe("settled_payment_unchecked")
    expect(settled).toHaveLength(1)
    expect(saleor.completed).toHaveLength(0)
  })

  it("holds a settlement whose transaction another checkout already used, and does not settle again", async () => {
    let calls = 0
    gateway = stubPrismGateway({ settle: () => { calls++; return { success: true, transaction: "0xsame" } } })
    const { routes, saleor } = prismRoutes()

    const first = await pay(routes, CHECKOUT_ID, signed("0x01"))
    const second = await pay(routes, OTHER_ID, signed("0x02"))
    const retry = await pay(routes, OTHER_ID, signed("0x02"))

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(await code(second)).toBe("payment_already_used")
    expect(record(saleor, OTHER_ID)).toMatchObject({ state: "held", reference: "0xsame", code: "payment_already_used" })
    expect(retry.status).toBe(409)
    expect(await code(retry)).toBe("payment_already_used")
    expect(calls).toBe(2)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("holds a mismatching settlement even when saving the hold fails, and still refuses the retry", async () => {
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: "0xmoved", payer: "0xsomeoneelse" }) })
    const { routes, saleor } = prismRoutes()
    failRecordWrites(saleor, ["held"])

    const first = await pay(routes, CHECKOUT_ID)
    const retry = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(409)
    expect(await code(first)).toBe("settled_payment_mismatch")
    expect(retry.status).toBe(409)
    expect(await code(retry)).toBe("settlement_pending")
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toHaveLength(0)
  })
})

describe("Resolving a pending settlement", () => {
  async function pendingCheckout() {
    gateway = stubPrismGateway({ settle: () => { throw new Error("socket hang up") } })
    const built = prismRoutes()
    await pay(built.routes, CHECKOUT_ID)
    return built
  }

  it("completes the order from the reference found at the gateway, without settling again", async () => {
    const { routes, saleor, instance } = await pendingCheckout()

    const resolved = await resolvePendingSettlement(instance, CHECKOUT_ID, { settled: true, reference: "0xfound" })
    const retry = await pay(routes, CHECKOUT_ID)

    expect(resolved).toEqual({ ok: true, state: "settled" })
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "settled", reference: "0xfound", amount: 5497, currency: "USD" })
    expect(retry.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.transactions.map((t) => t.pspReference)).toEqual(["0xfound"])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("lets the same authorization be settled again once it is resolved as not settled", async () => {
    const { routes, saleor, instance } = await pendingCheckout()
    gateway.restore()
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: "0xtx2" }) })

    const resolved = await resolvePendingSettlement(instance, CHECKOUT_ID, { settled: false })
    const retry = await pay(routes, CHECKOUT_ID)

    expect(resolved).toEqual({ ok: true, state: "failed" })
    expect(retry.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("keeps the authorization out of reach of other checkouts after it is resolved as not settled", async () => {
    const { routes, instance } = await pendingCheckout()

    await resolvePendingSettlement(instance, CHECKOUT_ID, { settled: false })
    const other = await pay(routes, OTHER_ID)

    expect(other.status).toBe(409)
    expect(await code(other)).toBe("payment_already_used")
  })

  it.each([
    ["has no settlement record", () => [] as { key: string; value: string }[]],
    ["is already settled", () => [{ key: SETTLEMENT_KEY, value: JSON.stringify({ state: "settled", handlerId: PRISM, reference: "0xdone", amount: 5497, currency: "USD", settledAt: "2026-10-09T00:00:00.000Z" }) }]],
  ])("refuses to resolve a checkout that %s", async (_case, metadata) => {
    gateway = stubPrismGateway()
    const checkout = checkoutTemplate()
    checkout.privateMetadata = [...checkout.privateMetadata, ...metadata()]
    const { saleor, instance } = buildRoutes({ prism: true, checkouts: [checkout] })
    const before = saleor.checkouts.get(CHECKOUT_ID)!.privateMetadata

    const resolved = await resolvePendingSettlement(instance, CHECKOUT_ID, { settled: false })

    expect(resolved).toMatchObject({ ok: false, code: "not_pending" })
    expect(saleor.checkouts.get(CHECKOUT_ID)!.privateMetadata).toEqual(before)
  })

  it("refuses a checkout that does not exist", async () => {
    gateway = stubPrismGateway()
    const { instance } = prismRoutes()

    expect(await resolvePendingSettlement(instance, "missing", { settled: false })).toMatchObject({ ok: false, code: "checkout_not_found" })
  })

  it("refuses a reference that another checkout already used and leaves the settlement pending", async () => {
    const { saleor, instance } = await pendingCheckout()
    await instance.paymentReplayStore.claim([settlementReplayKey(PRISM, "0xfound")], OTHER_ID)

    const resolved = await resolvePendingSettlement(instance, CHECKOUT_ID, { settled: true, reference: "0xfound" })

    expect(resolved).toMatchObject({ ok: false, code: "reference_already_used" })
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "pending" })
  })

  it("refuses a settled outcome without a reference", async () => {
    const { saleor, instance } = await pendingCheckout()

    const resolved = await resolvePendingSettlement(instance, CHECKOUT_ID, { settled: true, reference: "" })

    expect(resolved).toMatchObject({ ok: false, code: "invalid_reference" })
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "pending" })
  })

  it("reports a record that could not be saved", async () => {
    const { saleor, instance } = await pendingCheckout()
    failRecordWrites(saleor, ["settled"])

    expect(await resolvePendingSettlement(instance, CHECKOUT_ID, { settled: true, reference: "0xfound" })).toMatchObject({ ok: false, code: "not_recorded" })
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "pending" })
  })
})

describe("Complete when another request already settled the payment", () => {
  const WON = "0xwon"
  const FAILED_RECORD = {
    key: SETTLEMENT_KEY,
    value: JSON.stringify({ state: "failed", attemptId: "attempt-lost", amount: 5497, currency: "USD", reason: "declined", failedAt: "2026-10-09T00:00:00.000Z" }),
  }
  const FAILED_WITHOUT_AMOUNT = {
    key: SETTLEMENT_KEY,
    value: JSON.stringify({ state: "failed", attemptId: "attempt-lost", reason: "declined", failedAt: "2026-10-09T00:00:00.000Z" }),
  }

  async function heldByStore(extra: { key: string; value: string }[], options: { total?: number; quoted?: number } = {}) {
    gateway = stubPrismGateway()
    const checkout = checkoutTemplate()
    checkout.privateMetadata = [...checkout.privateMetadata, ...extra]
    if (options.total !== undefined) checkout.totalPrice.gross.amount = options.total
    if (options.quoted !== undefined) {
      checkout.privateMetadata = checkout.privateMetadata.map((m) =>
        m.key === QUOTE_KEY ? { key: m.key, value: freshQuote({ amount: options.quoted!, currency: "USD" }) } : m,
      )
    }
    const built = buildRoutes({ prism: true, checkouts: [checkout] })
    await built.instance.paymentReplayStore.claim([settlementReplayKey(PRISM, WON)], CHECKOUT_ID)
    return built
  }

  it("settles at the amount the failed record carries, not at a larger quote made since", async () => {
    const { routes, saleor } = await heldByStore([FAILED_RECORD], { total: 154.97, quoted: 15497 })

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(409)
    expect(await code(response)).toBe("order_total_changed_after_settlement")
    expect(settleRequests()).toHaveLength(0)
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "settled", reference: WON, amount: 5497, currency: "USD" })
    expect(saleor.transactions.map((t) => t.amountCharged)).toEqual([{ amount: 54.97, currency: "USD" }])
    expect(saleor.completed).toHaveLength(0)
  })

  it("holds a failed record that carries no amount when the store holds a settlement, and does not guess from the quote", async () => {
    const { routes, saleor } = await heldByStore([FAILED_WITHOUT_AMOUNT])

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(409)
    expect(await code(response)).toBe("settlement_pending")
    expect(settleRequests()).toHaveLength(0)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("holds a checkout with no record when the store holds a settlement, and does not guess from the quote", async () => {
    const { routes, saleor } = await heldByStore([])

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(409)
    expect(await code(response)).toBe("settlement_pending")
    expect(settleRequests()).toHaveLength(0)
    expect(record(saleor, CHECKOUT_ID)).toBeUndefined()
    expect(saleor.transactions).toHaveLength(0)
  })

  it("finishes from the settlement the store holds instead of submitting again after a decline was recorded", async () => {
    gateway = stubPrismGateway()
    const checkout = checkoutTemplate()
    checkout.privateMetadata = [...checkout.privateMetadata, FAILED_RECORD]
    const { routes, saleor, instance } = buildRoutes({ prism: true, checkouts: [checkout] })
    await instance.paymentReplayStore.claim([settlementReplayKey(PRISM, WON)], CHECKOUT_ID)

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(200)
    expect(settleRequests()).toHaveLength(0)
    expect(saleor.transactions.map((t) => t.pspReference)).toEqual([WON])
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "settled", reference: WON, amount: 5497, currency: "USD" })
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("does not record a decline over a settlement the store already holds, and finishes from it on the retry", async () => {
    let calls = 0
    const built = prismRoutes()
    gateway = stubPrismGateway({
      settle: async () => {
        calls++
        await built.instance.paymentReplayStore.claim([settlementReplayKey(PRISM, WON)], CHECKOUT_ID)
        return { success: false, errorReason: "authorization is already used" }
      },
    })

    const first = await pay(built.routes, CHECKOUT_ID)
    const afterDecline = record(built.saleor, CHECKOUT_ID)
    const retry = await pay(built.routes, CHECKOUT_ID)

    expect(first.status).toBe(409)
    expect(await code(first)).toBe("settlement_in_progress")
    expect(afterDecline).toMatchObject({ state: "pending" })
    expect(retry.status).toBe(200)
    expect(calls).toBe(1)
    expect(built.saleor.transactions.map((t) => t.pspReference)).toEqual([WON])
    expect(built.saleor.completed).toEqual([CHECKOUT_ID])
  })
})

describe("Complete with a handler that declares the amount it will settle", () => {
  it("refuses before submitting when the declared amount is not the quoted amount", async () => {
    const { adapter, settled } = handlerWith(() => OK_SETTLE, () => ["handler-key"], { amount: 2000, currency: "USD" })
    const { routes, saleor } = buildRoutes({ handlers: [adapter], checkouts: [handlerCheckout()] })

    const response = await completeWith(routes)

    expect(response.status).toBe(422)
    expect(await code(response)).toBe("payment_amount_mismatch")
    expect(settled).toHaveLength(0)
    expect(record(saleor, CHECKOUT_ID)).toBeUndefined()
    expect(saleor.completed).toHaveLength(0)
  })

  it("submits and keeps the declared amount in the pending record when it is the quoted amount", async () => {
    const { adapter, settled } = handlerWith(() => { throw new Error("no answer") }, () => ["handler-key"], { amount: 5497, currency: "USD" })
    const { routes, saleor } = buildRoutes({ handlers: [adapter], checkouts: [handlerCheckout()] })

    const response = await completeWith(routes)

    expect(response.status).toBe(409)
    expect(settled).toHaveLength(1)
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "pending", amount: 5497, currency: "USD" })
  })
})

describe("Complete when the pending record cannot be read back", () => {
  function unreadableAfterPending(saleor: Built["saleor"], failures: number) {
    const originalWrite = saleor.client.updatePrivateMetadata.bind(saleor.client)
    const originalRead = saleor.client.getCheckout.bind(saleor.client)
    const state = { remaining: 0, armed: true, reads: 0 }
    saleor.client.updatePrivateMetadata = async (id, items) => {
      const result = await originalWrite(id, items)
      if (state.armed && items.some((item) => item.key === SETTLEMENT_KEY && JSON.parse(item.value).state === "pending")) {
        state.armed = false
        state.remaining = failures
      }
      return result
    }
    saleor.client.getCheckout = async (id) => {
      if (state.remaining > 0) {
        state.remaining--
        state.reads++
        return { ok: false as const, error: "saleor unavailable" }
      }
      return originalRead(id)
    }
    return state
  }

  it("keeps the settlement pending, and never submits or records a failure, when it stays unreadable", async () => {
    gateway = stubPrismGateway()
    const { routes, saleor } = prismRoutes()
    const reads = unreadableAfterPending(saleor, 3)

    const first = await pay(routes, CHECKOUT_ID)
    const kept = record(saleor, CHECKOUT_ID)
    const retry = await pay(routes, CHECKOUT_ID)

    expect(reads.reads).toBe(3)
    expect(first.status).toBe(409)
    expect(await code(first)).toBe("settlement_pending")
    expect(kept).toMatchObject({ state: "pending" })
    expect(retry.status).toBe(409)
    expect(await code(retry)).toBe("settlement_pending")
    expect(settleRequests()).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("submits when a later read shows the pending record is its own", async () => {
    gateway = stubPrismGateway()
    const { routes, saleor } = prismRoutes()
    const reads = unreadableAfterPending(saleor, 2)

    const response = await pay(routes, CHECKOUT_ID)

    expect(reads.reads).toBe(2)
    expect(response.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})
