import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { credentialSha256, settlementReplayKey } from "@financedistrict/saleor-agentic-commerce-core"
import type { PaymentHandlerAdapter, PaymentSettleInput, SaleorCheckout } from "@financedistrict/saleor-agentic-commerce-core"
import { ACP_AUTH, buildRoutes, checkoutTemplate, CHECKOUT_ID, freshQuote, params, sessionSecretItem, stubPrismGateway, ucpRequest } from "./__tests__/harness.js"
import { resolvePendingSettlement } from "./resolve-pending-settlement.js"
import { PrismClient } from "../../../prism-payment/src/prism-client.js"

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

type SettleRow = { name: string; http: number; body: Record<string, unknown> | null; first: string; resume: string }

const SETTLE_ROWS: SettleRow[] = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prism-payment", "src", "__fixtures__", "settle-replies.json"), "utf8"),
).rows

function settleRow(name: string): SettleRow {
  const row = SETTLE_ROWS.find((candidate) => candidate.name === name)
  if (!row) throw new Error(`settle fixture has no row ${name}`)
  return row
}

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

async function codes(response: Response): Promise<string[]> {
  return (await response.json()).messages.map((message: { code: string }) => message.code)
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
  it("holds the checkout as pending and asks the gateway again on a same-credential retry", async () => {
    gateway = stubPrismGateway({ settle: () => { throw new Error("socket hang up") } })
    const { routes, saleor } = prismRoutes()

    const first = await pay(routes, CHECKOUT_ID)
    const retry = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(202)
    expect(await code(first)).toBe("settlement_pending")
    expect(retry.status).toBe(202)
    expect(await code(retry)).toBe("settlement_pending")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({
      state: "pending",
      handlerId: PRISM,
      amount: 5497,
      currency: "USD",
      expiresAt: new Date(9999999999 * 1000).toISOString(),
      details: LOOKUP_DETAILS,
    })
    expect(settleRequests()).toHaveLength(2)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("logs one line per attempt a person can search by checkout, without the signature", async () => {
    gateway = stubPrismGateway({ settle: () => { throw new Error("socket hang up") } })
    const { routes, saleor } = prismRoutes()

    await pay(routes, CHECKOUT_ID)
    await pay(routes, CHECKOUT_ID)

    const lines = reviewLines()
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("[ucp-routes] settlement pending needs review")
    expect(reviewFields(lines[1])).toMatchObject({
      checkoutId: CHECKOUT_ID,
      state: "pending",
      handlerId: PRISM,
      attemptId: record(saleor, CHECKOUT_ID).attemptId,
      startedAt: record(saleor, CHECKOUT_ID).startedAt,
      expiresAt: new Date(9999999999 * 1000).toISOString(),
      ...LOOKUP_DETAILS,
    })
    expect(lines.join("\n")).not.toContain("0xsig")
    expect(JSON.stringify(record(saleor, CHECKOUT_ID))).not.toContain("0xsig")
  })

  it("answers an ACP complete the same way", async () => {
    gateway = stubPrismGateway({ settle: () => { throw new Error("socket hang up") } })
    const { acpRoutes, saleor } = buildRoutes({ prism: true, checkouts: [checkoutTemplate()], config: { acpEnabled: true } })

    const first = await acpPay(acpRoutes, CHECKOUT_ID)
    const retry = await acpPay(acpRoutes, CHECKOUT_ID)

    expect(first.status).toBe(409)
    expect((await first.json()).code).toBe("settlement_pending")
    expect(retry.status).toBe(409)
    expect((await retry.json()).code).toBe("settlement_pending")
    expect(settleRequests()).toHaveLength(2)
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

    expect(first.status).toBe(202)
    expect(await code(first)).toBe("settlement_pending")
    expect(retry.status).toBe(202)
    expect(settled).toHaveLength(2)
    expect(saleor.completed).toHaveLength(0)
  })

  it("treats a handler that throws as having no known outcome", async () => {
    const { adapter } = handlerWith(() => { throw new Error("handler crashed") }, () => ["handler-key"])
    const { routes, saleor } = buildRoutes({ handlers: [adapter], checkouts: [handlerCheckout()] })

    const response = await completeWith(routes)

    expect(response.status).toBe(202)
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

    expect(first.status).toBe(200)
    expect(await codes(first)).toEqual(["payment_requires_review", "settled_payment_mismatch"])
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "held", reference: "0xmoved", handlerId: PRISM, details: LOOKUP_DETAILS })
    expect(record(saleor, CHECKOUT_ID)).toHaveProperty("attemptId")
    expect(record(saleor, CHECKOUT_ID)).toHaveProperty("startedAt")
    expect(record(saleor, CHECKOUT_ID)).toHaveProperty("expiresAt", new Date(9999999999 * 1000).toISOString())
    expect(JSON.stringify(record(saleor, CHECKOUT_ID))).not.toContain("0xsig")
    const lines = reviewLines()
    expect(lines).toHaveLength(1)
    expect(reviewFields(lines[0])).toMatchObject({ checkoutId: CHECKOUT_ID, state: "held", reference: "0xmoved", code: "settled_payment_mismatch", ...LOOKUP_DETAILS })
    expect(lines[0]).not.toContain("0xsig")
    expect(retry.status).toBe(200)
    expect(await codes(retry)).toEqual(["payment_requires_review", "settled_payment_mismatch"])
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
    sessionSecretItem(),
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

    expect(first.status).toBe(200)
    expect(await codes(first)).toEqual(["payment_requires_review", "settled_payment_unchecked"])
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "held", reference: "0xhandler", code: "settled_payment_unchecked" })
    expect(retry.status).toBe(200)
    expect(await codes(retry)).toEqual(["payment_requires_review", "settled_payment_unchecked"])
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
    expect(second.status).toBe(200)
    expect(await codes(second)).toEqual(["payment_requires_review", "payment_already_used"])
    expect(record(saleor, OTHER_ID)).toMatchObject({ state: "held", reference: "0xsame", code: "payment_already_used" })
    expect(retry.status).toBe(200)
    expect(await codes(retry)).toEqual(["payment_requires_review", "payment_already_used"])
    expect(calls).toBe(2)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("holds a mismatching settlement even when saving the hold fails, and still refuses the retry", async () => {
    gateway = stubPrismGateway({ settle: () => ({ success: true, transaction: "0xmoved", payer: "0xsomeoneelse" }) })
    const { routes, saleor } = prismRoutes()
    failRecordWrites(saleor, ["held"])

    const first = await pay(routes, CHECKOUT_ID)
    const retry = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(200)
    expect(await codes(first)).toEqual(["payment_requires_review", "settled_payment_mismatch"])
    expect(retry.status).toBe(200)
    expect(await codes(retry)).toEqual(["payment_requires_review", "settled_payment_mismatch"])
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "pending" })
    expect(settleRequests()).toHaveLength(2)
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

    expect(response.status).toBe(200)
    expect(await codes(response)).toEqual(["payment_requires_review", "settlement_unresolved"])
    expect(settleRequests()).toHaveLength(0)
    expect(saleor.transactions).toHaveLength(0)
    expect(saleor.completed).toHaveLength(0)
  })

  it("holds a checkout with no record when the store holds a settlement, and does not guess from the quote", async () => {
    const { routes, saleor } = await heldByStore([])

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(200)
    expect(await codes(response)).toEqual(["payment_requires_review", "settlement_unresolved"])
    expect(settleRequests()).toHaveLength(0)
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "held", code: "settlement_unresolved" })
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
        return { success: false, errorReason: "credential_already_used" }
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

    expect(response.status).toBe(202)
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

  it("keeps the settlement pending without submitting or recording a failure while it stays unreadable, and resumes once it reads back", async () => {
    gateway = stubPrismGateway()
    const { routes, saleor } = prismRoutes()
    const reads = unreadableAfterPending(saleor, 3)

    const first = await pay(routes, CHECKOUT_ID)
    const kept = record(saleor, CHECKOUT_ID)
    const submittedWhileUnreadable = settleRequests().length
    const retry = await pay(routes, CHECKOUT_ID)

    expect(reads.reads).toBe(3)
    expect(first.status).toBe(202)
    expect(await code(first)).toBe("settlement_pending")
    expect(kept).toMatchObject({ state: "pending" })
    expect(submittedWhileUnreadable).toBe(0)
    expect(retry.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
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

describe("Complete when the gateway reply is classified by the settle contract", () => {
  it.each(["settlement_pending", "transaction_reverted"])("keeps the settlement pending for a %s reply that carries a transaction", async (name) => {
    const row = settleRow(name)
    gateway = stubPrismGateway({ settle: () => row.body })
    const { routes, saleor } = prismRoutes()
    const states: string[] = []
    const original = saleor.client.updatePrivateMetadata.bind(saleor.client)
    saleor.client.updatePrivateMetadata = async (id, items) => {
      for (const item of items) if (item.key === SETTLEMENT_KEY) states.push(JSON.parse(item.value).state)
      return original(id, items)
    }

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(202)
    expect(await code(response)).toBe("settlement_pending")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "pending", transaction: row.body!.transaction })
    expect(states).toEqual(["pending", "pending"])
    expect(saleor.transactions).toEqual([])
    expect(saleor.completed).toEqual([])
  })

  it("records a failure and answers payment_failed for a quote_not_found reply", async () => {
    const row = settleRow("quote_not_found")
    gateway = stubPrismGateway({ settle: () => row.body })
    const { routes, saleor } = prismRoutes()

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(422)
    expect(await code(response)).toBe("payment_failed")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "failed" })
  })
})

type GatewayReply = { http: number; body: unknown }

function replyingGateway(replies: GatewayReply[], onSettle?: (call: number) => void | Promise<void>) {
  gateway = stubPrismGateway()
  const inner = globalThis.fetch
  let call = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).endsWith("/api/v2/payment/settle")) return inner(input, init)
    await inner(input, init)
    const answer = replies[Math.min(call, replies.length - 1)]
    call++
    await onSettle?.(call)
    return new Response(answer.body === null ? "" : JSON.stringify(answer.body), { status: answer.http, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}

function reply(name: string): GatewayReply {
  const row = settleRow(name)
  return { http: row.http, body: row.body }
}

const SETTLED_REPLY: GatewayReply = { http: 200, body: { success: true, transaction: "0xresumed" } }
const CONSUMED_REPLY: GatewayReply = { http: 200, body: { success: false, errorReason: "authorization_consumed" } }
const FIRST_TX = String(settleRow("settlement_pending").body!.transaction)

function getSession(routes: Built["routes"], id = CHECKOUT_ID) {
  return routes.checkoutSession.GET(ucpRequest(`${UCP_SESSIONS}/${id}`), params({ id }))
}

function withSettlement(value: object) {
  const checkout = checkoutTemplate()
  checkout.privateMetadata = [...checkout.privateMetadata, { key: SETTLEMENT_KEY, value: JSON.stringify(value) }]
  return buildRoutes({ prism: true, checkouts: [checkout], config: { acpEnabled: true } })
}

const STORED_PENDING = {
  state: "pending",
  attemptId: "attempt-old",
  handlerId: PRISM,
  startedAt: "2026-10-19T00:00:00.000Z",
  amount: 5497,
  currency: "USD",
  keys: ["stored-key"],
}

const STORED_HELD = {
  state: "held",
  attemptId: "attempt-old",
  handlerId: PRISM,
  startedAt: "2026-10-19T00:00:00.000Z",
  reference: "0xheld",
  code: "settled_payment_mismatch",
  reason: "the settlement did not match the signed payment",
  heldAt: "2026-10-19T00:00:01.000Z",
}

const STORED_SETTLED = { state: "settled", amount: 5497, currency: "USD", handlerId: PRISM, reference: "0xdone", settledAt: "2026-10-19T00:00:01.000Z" }

describe("Resuming a pending settlement with the same payment credential", () => {
  it("answers a pending first attempt with 202 and keeps the credential digest and transaction on the record", async () => {
    replyingGateway([reply("settlement_pending")])
    const { routes, saleor } = prismRoutes()

    const response = await pay(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.status).toBe("complete_in_progress")
    expect(body.messages[0].code).toBe("settlement_pending")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "pending", credentialSha256: credentialSha256(signed()), transaction: FIRST_TX })
  })

  it("submits the same credential again as a resume and completes the order once the gateway settles", async () => {
    replyingGateway([reply("settlement_pending"), SETTLED_REPLY])
    const settle = vi.spyOn(PrismClient.prototype, "settle")
    const { routes, saleor } = prismRoutes()

    await pay(routes, CHECKOUT_ID)
    const retry = await pay(routes, CHECKOUT_ID)

    expect(retry.status).toBe(200)
    expect((await retry.json()).status).toBe("completed")
    expect(settleRequests()).toHaveLength(2)
    expect(settle.mock.calls[1][0]).toMatchObject({ resumed: true })
    expect(saleor.transactions.map((t) => t.pspReference)).toEqual(["0xresumed"])
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("still asks the gateway on a resume after the signed authorization has expired", async () => {
    replyingGateway([reply("settlement_pending"), SETTLED_REPLY])
    const { routes, saleor } = prismRoutes()

    await pay(routes, CHECKOUT_ID)
    vi.spyOn(Date, "now").mockReturnValue(9999999999 * 1000 + 1)
    const retry = await pay(routes, CHECKOUT_ID)

    expect(settleRequests()).toHaveLength(2)
    expect(retry.status).toBe(200)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("refuses a different credential while a payment is pending, without asking the gateway", async () => {
    replyingGateway([reply("settlement_pending"), SETTLED_REPLY])
    const { routes } = prismRoutes()

    await pay(routes, CHECKOUT_ID)
    const other = await pay(routes, CHECKOUT_ID, signed("0x02"))

    expect(other.status).toBe(409)
    expect(await code(other)).toBe("payment_pending_mismatch")
    expect(settleRequests()).toHaveLength(1)
  })

  it("escalates a pending record that has no credential digest, without asking the gateway", async () => {
    replyingGateway([SETTLED_REPLY])
    const { routes, saleor } = withSettlement(STORED_PENDING)

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe("requires_escalation")
    expect(settleRequests()).toHaveLength(0)
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "held", code: "settlement_unresolved" })
  })

  it.each(SETTLE_ROWS.map((row) => [row.name, row] as const))("settle contract: %s on a resume", async (_name, row) => {
    replyingGateway([reply("settlement_pending"), { http: row.http, body: row.body }])
    const { routes, saleor } = prismRoutes()

    await pay(routes, CHECKOUT_ID)
    const retry = await pay(routes, CHECKOUT_ID)
    const body = await retry.json()
    const transaction = typeof row.body?.transaction === "string" ? row.body.transaction : undefined

    expect(settleRequests()).toHaveLength(2)
    expect(saleor.completed).toEqual([])
    if (row.resume === "pending") {
      expect(retry.status).toBe(202)
      expect(body.status).toBe("complete_in_progress")
      expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "pending", transaction: transaction ?? FIRST_TX })
      return
    }
    expect(row.resume).toBe("review")
    expect(retry.status).toBe(200)
    expect(body.status).toBe("requires_escalation")
    expect(body.messages[0].code).toBe("payment_requires_review")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "held" })
  })

  it("records one checkout transaction when two resumes run in parallel", async () => {
    replyingGateway([reply("settlement_pending"), SETTLED_REPLY])
    const { routes, saleor } = prismRoutes()

    await pay(routes, CHECKOUT_ID)
    const responses = await Promise.all([pay(routes, CHECKOUT_ID), pay(routes, CHECKOUT_ID)])
    const answers = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })))

    expect(saleor.transactions).toHaveLength(1)
    for (const answer of answers) {
      if (answer.status === 409) expect(answer.body.messages[0].code).toBe("settlement_in_progress")
      else expect(answer).toMatchObject({ status: 200, body: { status: "completed" } })
    }
    expect(answers.some((answer) => answer.status === 200)).toBe(true)
  })

  it("does not resume from a stale read when another request already moved the settlement on", async () => {
    replyingGateway([SETTLED_REPLY])
    const built = withSettlement(STORED_SETTLED)
    const stale = structuredClone(built.saleor.checkouts.get(CHECKOUT_ID)!)
    stale.privateMetadata = [
      ...stale.privateMetadata.filter((m) => m.key !== SETTLEMENT_KEY),
      { key: SETTLEMENT_KEY, value: JSON.stringify({ ...STORED_PENDING, credentialSha256: credentialSha256(signed()) }) },
    ]
    const originalRead = built.saleor.client.getCheckout.bind(built.saleor.client)
    let reads = 0
    built.saleor.client.getCheckout = async (id) => (++reads === 1 ? { ok: true as const, data: structuredClone(stale) } : originalRead(id))

    const response = await pay(built.routes, CHECKOUT_ID)

    expect(response.status).toBe(409)
    expect(await code(response)).toBe("settlement_in_progress")
    expect(settleRequests()).toHaveLength(0)
    expect(record(built.saleor, CHECKOUT_ID)).toMatchObject({ state: "settled", reference: "0xdone" })
  })

  it("does not record the transaction again when it was recorded after the checkout was read", async () => {
    const built = prismRoutes()
    replyingGateway([reply("settlement_pending"), SETTLED_REPLY], async (call) => {
      if (call !== 2) return
      await built.saleor.client.createCheckoutTransaction(CHECKOUT_ID, {
        name: "Finance District Prism",
        pspReference: "0xresumed",
        amountCharged: { amount: 54.97, currency: "USD" },
      })
    })

    await pay(built.routes, CHECKOUT_ID)
    const retry = await pay(built.routes, CHECKOUT_ID)

    expect(retry.status).toBe(200)
    expect(built.saleor.transactions.map((t) => t.pspReference)).toEqual(["0xresumed"])
    expect(built.saleor.completed).toEqual([CHECKOUT_ID])
  })
})

describe("Complete when the gateway asks for review", () => {
  it("holds checkout_already_settled with its transaction and answers requires_escalation", async () => {
    const row = settleRow("checkout_already_settled")
    replyingGateway([reply("checkout_already_settled")])
    const { routes, saleor } = prismRoutes()

    const response = await pay(routes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe("requires_escalation")
    expect(body.messages[0].code).toBe("payment_requires_review")
    expect(record(saleor, CHECKOUT_ID)).toMatchObject({ state: "held", reference: row.body!.transaction })
  })

  it("holds authorization_consumed without a reference and claims no transaction key", async () => {
    replyingGateway([CONSUMED_REPLY])
    const built = prismRoutes()
    const claim = vi.spyOn(built.instance.paymentReplayStore, "claim")

    const response = await pay(built.routes, CHECKOUT_ID)

    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe("requires_escalation")
    const held = record(built.saleor, CHECKOUT_ID)
    expect(held).toMatchObject({ state: "held" })
    expect(held).not.toHaveProperty("reference")
    const claimedKeys = claim.mock.calls.flatMap(([keys]) => keys)
    expect(claimedKeys.some((key) => key.startsWith('["settlement"'))).toBe(false)
  })
})

describe("Complete when the order cannot be written after the payment settled", () => {
  it("escalates a failed transaction write and finishes from the settled record on the retry", async () => {
    replyingGateway([SETTLED_REPLY])
    const { routes, saleor } = prismRoutes()
    const original = saleor.client.createCheckoutTransaction.bind(saleor.client)
    let down = true
    saleor.client.createCheckoutTransaction = async (id, tx) => (down ? { ok: false as const, error: "saleor unavailable" } : original(id, tx))

    const first = await pay(routes, CHECKOUT_ID)
    const firstBody = await first.json()
    down = false
    const retry = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(200)
    expect(firstBody.status).toBe("requires_escalation")
    expect(firstBody.messages.map((m: { code: string }) => m.code)).toContain("order_not_recorded_after_settlement")
    expect(retry.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("escalates a failed order completion and finishes from the settled record on the retry", async () => {
    replyingGateway([SETTLED_REPLY])
    const { routes, saleor } = prismRoutes()
    const original = saleor.client.completeCheckout.bind(saleor.client)
    let down = true
    saleor.client.completeCheckout = async (id) => (down ? { ok: false as const, error: "saleor unavailable", errors: [] } : original(id))

    const first = await pay(routes, CHECKOUT_ID)
    const firstBody = await first.json()
    down = false
    const retry = await pay(routes, CHECKOUT_ID)

    expect(first.status).toBe(200)
    expect(firstBody.status).toBe("requires_escalation")
    expect(firstBody.messages.map((m: { code: string }) => m.code)).toContain("order_not_completed_after_settlement")
    expect(retry.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(saleor.completed).toEqual([CHECKOUT_ID])
  })
})

describe("ACP complete keeps 409 for pending and review", () => {
  it("answers a pending payment with 409 settlement_pending and asks for the same credential", async () => {
    replyingGateway([reply("settlement_pending")])
    const { acpRoutes } = buildRoutes({ prism: true, checkouts: [checkoutTemplate()], config: { acpEnabled: true } })

    const response = await acpPay(acpRoutes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("settlement_pending")
    expect(body.message).toContain("same payment credential")
  })

  it("answers a review without a reference with 409 and a message that names no undefined value", async () => {
    replyingGateway([CONSUMED_REPLY])
    const { acpRoutes } = buildRoutes({ prism: true, checkouts: [checkoutTemplate()], config: { acpEnabled: true } })

    const response = await acpPay(acpRoutes, CHECKOUT_ID)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.message).not.toContain("undefined")
  })
})

describe("Session status while a settlement is live", () => {
  it("shows complete_in_progress for a pending settlement", async () => {
    const { routes } = withSettlement(STORED_PENDING)
    expect((await (await getSession(routes)).json()).status).toBe("complete_in_progress")
  })

  it("shows requires_escalation for a held settlement", async () => {
    const { routes } = withSettlement(STORED_HELD)
    expect((await (await getSession(routes)).json()).status).toBe("requires_escalation")
  })
})

describe("Complete with an old quote", () => {
  it("answers 409 quote_expired for a first attempt on a quote older than 15 minutes", async () => {
    replyingGateway([SETTLED_REPLY])
    const checkout = checkoutTemplate()
    const old = new Date(Date.now() - 16 * 60 * 1000).toISOString()
    checkout.privateMetadata = checkout.privateMetadata.map((m) => (m.key === QUOTE_KEY ? { key: m.key, value: freshQuote(JSON.parse(m.value), old) } : m))
    const { routes } = buildRoutes({ prism: true, checkouts: [checkout] })

    const response = await pay(routes, CHECKOUT_ID)

    expect(response.status).toBe(409)
    expect(await code(response)).toBe("quote_expired")
    expect(settleRequests()).toHaveLength(0)
  })
})

const ACP_SESSIONS = "https://store.test/api/acp/checkout_sessions"

type Protocol = "ucp" | "acp"

const FLAG: Record<Protocol, string> = { ucp: "ucp_canceled", acp: "acp_canceled" }

function cancel(built: Built, protocol: Protocol, id = CHECKOUT_ID) {
  if (protocol === "ucp") return built.routes.checkoutSessionCancel.POST(ucpRequest(`${UCP_SESSIONS}/${id}/cancel`, { body: {} }), params({ id }))
  return built.acpRoutes.checkoutSessionCancel.POST(
    new Request(`${ACP_SESSIONS}/${id}/cancel`, { method: "POST", headers: { "content-type": "application/json", ...ACP_AUTH }, body: "{}" }),
    params({ id }),
  )
}

function complete(built: Built, protocol: Protocol, id = CHECKOUT_ID) {
  return protocol === "ucp" ? pay(built.routes, id) : acpPay(built.acpRoutes, id)
}

async function errorCode(response: Response, protocol: Protocol): Promise<string> {
  const body = await response.json()
  return protocol === "ucp" ? body.messages[0].code : body.code
}

function flagValue(saleor: Built["saleor"], key: string, id = CHECKOUT_ID): string | undefined {
  return saleor.checkouts.get(id)!.privateMetadata.find((m) => m.key === key)?.value
}

function liveRecords() {
  return {
    pending: { ...STORED_PENDING, credentialSha256: credentialSha256(signed()) },
    held: STORED_HELD,
    settled: STORED_SETTLED,
  }
}

function setRecord(saleor: Built["saleor"], value: object, id = CHECKOUT_ID) {
  const checkout = saleor.checkouts.get(id)!
  checkout.privateMetadata = [...checkout.privateMetadata.filter((m) => m.key !== SETTLEMENT_KEY), { key: SETTLEMENT_KEY, value: JSON.stringify(value) }]
}

function interceptWrites(saleor: Built["saleor"], intercept: (items: { key: string; value: string }[]) => "fail" | void) {
  const original = saleor.client.updatePrivateMetadata.bind(saleor.client)
  saleor.client.updatePrivateMetadata = async (id, items) => {
    if (intercept(items) === "fail") return { ok: false as const, error: "saleor unavailable" }
    return original(id, items)
  }
}

const writesFlag = (items: { key: string; value: string }[], key: string, value: string) => items.some((item) => item.key === key && item.value === value)

describe.each(["ucp", "acp"] as const)("Cancel while a settlement is live (%s)", (protocol) => {
  const flag = FLAG[protocol]

  it.each([
    ["pending", "session_complete_in_progress"],
    ["held", "session_requires_escalation"],
    ["settled", "session_completed"],
  ] as const)("refuses to cancel a %s settlement and leaves the session not canceled", async (state, expected) => {
    const built = withSettlement(liveRecords()[state])

    const response = await cancel(built, protocol)

    expect(response.status).toBe(409)
    expect(await errorCode(response, protocol)).toBe(expected)
    expect(flagValue(built.saleor, flag)).toBeUndefined()
  })

  it.each([
    ["no settlement", null],
    ["a declined settlement", { state: "failed", attemptId: "attempt-old", amount: 5497, currency: "USD", reason: "insufficient_funds", failedAt: "2026-10-19T00:00:01.000Z" }],
  ] as const)("cancels a session with %s", async (_case, value) => {
    const built = value ? withSettlement(value) : buildRoutes({ prism: true, checkouts: [checkoutTemplate()], config: { acpEnabled: true } })

    const response = await cancel(built, protocol)

    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe("canceled")
    expect(flagValue(built.saleor, flag)).toBe("true")
  })

  it("rolls the cancel back when a settlement started while the flag was written", async () => {
    const built = buildRoutes({ prism: true, checkouts: [checkoutTemplate()], config: { acpEnabled: true } })
    interceptWrites(built.saleor, (items) => {
      if (writesFlag(items, flag, "true")) setRecord(built.saleor, liveRecords().pending)
    })

    const response = await cancel(built, protocol)

    expect(response.status).toBe(409)
    expect(await errorCode(response, protocol)).toBe("session_complete_in_progress")
    expect(flagValue(built.saleor, flag)).toBe("false")
  })

  it("retries a failed roll back of the cancel flag", async () => {
    const built = buildRoutes({ prism: true, checkouts: [checkoutTemplate()], config: { acpEnabled: true } })
    let rollbacks = 0
    interceptWrites(built.saleor, (items) => {
      if (writesFlag(items, flag, "true")) setRecord(built.saleor, liveRecords().pending)
      if (writesFlag(items, flag, "false") && ++rollbacks === 1) return "fail"
    })

    const response = await cancel(built, protocol)

    expect(response.status).toBe(409)
    expect(rollbacks).toBe(2)
    expect(flagValue(built.saleor, flag)).toBe("false")
  })

  it("answers 503 when the cancel flag cannot be rolled back, and a same-credential complete still resumes", async () => {
    replyingGateway([SETTLED_REPLY])
    const built = buildRoutes({ prism: true, checkouts: [checkoutTemplate()], config: { acpEnabled: true } })
    let rollbacks = 0
    interceptWrites(built.saleor, (items) => {
      if (writesFlag(items, flag, "true")) setRecord(built.saleor, liveRecords().pending)
      if (writesFlag(items, flag, "false")) {
        rollbacks++
        return "fail"
      }
    })

    const response = await cancel(built, protocol)
    const completed = await complete(built, protocol)

    expect(response.status).toBe(503)
    expect(await errorCode(response, protocol)).toBe("cancel_not_confirmed")
    expect(rollbacks).toBe(3)
    expect(flagValue(built.saleor, flag)).toBe("true")
    expect(completed.status).toBe(200)
    expect(settleRequests()).toHaveLength(1)
    expect(built.saleor.completed).toEqual([CHECKOUT_ID])
  })

  it("does not submit the payment when a cancel lands while the settlement is being recorded", async () => {
    replyingGateway([SETTLED_REPLY])
    const built = buildRoutes({ prism: true, checkouts: [checkoutTemplate()], config: { acpEnabled: true } })
    interceptWrites(built.saleor, (items) => {
      const pendingWrite = items.some((item) => item.key === SETTLEMENT_KEY && JSON.parse(item.value).state === "pending")
      if (!pendingWrite) return
      const checkout = built.saleor.checkouts.get(CHECKOUT_ID)!
      checkout.privateMetadata = [...checkout.privateMetadata.filter((m) => m.key !== flag), { key: flag, value: "true" }]
    })

    const response = await complete(built, protocol)

    expect(response.status).toBe(409)
    expect(await errorCode(response, protocol)).toBe("session_canceled")
    expect(settleRequests()).toHaveLength(0)
    expect(record(built.saleor, CHECKOUT_ID)).toMatchObject({ state: "failed" })
  })
})

function ucpUpdate(built: Built, id = CHECKOUT_ID) {
  return built.routes.checkoutSession.PUT(
    ucpRequest(`${UCP_SESSIONS}/${id}`, { method: "PUT", body: { line_items: [{ item: { id: "UHJvZHVjdFZhcmlhbnQ6OTk5" }, quantity: 1 }] } }),
    params({ id }),
  )
}

function acpUpdate(built: Built, id = CHECKOUT_ID) {
  return built.acpRoutes.checkoutSession.POST(
    new Request(`${ACP_SESSIONS}/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACP_AUTH },
      body: JSON.stringify({ items: [{ id: "UHJvZHVjdFZhcmlhbnQ6OTk5", quantity: 1 }] }),
    }),
    params({ id }),
  )
}

describe("Update while a settlement is live", () => {
  it.each([
    ["pending", "session_complete_in_progress"],
    ["held", "session_requires_escalation"],
    ["settled", "session_completed"],
  ] as const)("refuses a UCP and an ACP update of a %s settlement without touching the cart or the quote", async (state, expected) => {
    gateway = stubPrismGateway()
    const built = withSettlement(liveRecords()[state])
    const lineCalls = vi.spyOn(built.saleor.client, "updateCheckoutLines")
    const addCalls = vi.spyOn(built.saleor.client, "addCheckoutLines")

    const ucp = await ucpUpdate(built)
    const acp = await acpUpdate(built)

    expect(ucp.status).toBe(409)
    expect(await errorCode(ucp, "ucp")).toBe(expected)
    expect(acp.status).toBe(409)
    expect(await errorCode(acp, "acp")).toBe(expected)
    expect(lineCalls).not.toHaveBeenCalled()
    expect(addCalls).not.toHaveBeenCalled()
    expect(gateway.requests.filter((r) => r.url.endsWith("/payment-requirements"))).toHaveLength(0)
  })

  it.each(["ucp", "acp"] as const)("names the live settlement, not a stranded cancel flag, when a %s update is refused", async (protocol) => {
    gateway = stubPrismGateway()
    const checkout = checkoutTemplate()
    checkout.privateMetadata = [
      ...checkout.privateMetadata,
      { key: SETTLEMENT_KEY, value: JSON.stringify(liveRecords().pending) },
      { key: FLAG[protocol], value: "true" },
    ]
    const built = buildRoutes({ prism: true, checkouts: [checkout], config: { acpEnabled: true } })

    const response = protocol === "ucp" ? await ucpUpdate(built) : await acpUpdate(built)

    expect(response.status).toBe(409)
    expect(await errorCode(response, protocol)).toBe("session_complete_in_progress")
  })

  it("does not change the billing address on a same-credential complete of a pending payment", async () => {
    replyingGateway([SETTLED_REPLY])
    const built = withSettlement(liveRecords().pending)
    const billing = vi.spyOn(built.saleor.client, "updateCheckoutBillingAddress")
    const address = { first_name: "Ada", last_name: "Lovelace", street_address: "1 Way", address_locality: "London", postal_code: "N1", address_country: "GB" }

    const response = await built.routes.checkoutSessionComplete.POST(
      ucpRequest(`${UCP_SESSIONS}/${CHECKOUT_ID}/complete`, {
        body: { payment: { instruments: [{ id: "inst_1", handler_id: PRISM, type: "x402", credential: signed(), billing_address: address }] } },
      }),
      params({ id: CHECKOUT_ID }),
    )

    expect(response.status).toBe(200)
    expect(billing).not.toHaveBeenCalled()
  })
})
