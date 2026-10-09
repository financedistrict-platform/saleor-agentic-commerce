import {
  canTransition,
  checkPaidOrdersOnly,
  failedSettlementRecord,
  heldSettlementRecord,
  metadataToRecord,
  minorToSaleorMoney,
  parseSettlementRecord,
  pendingSettlementRecord,
  readPaymentQuote,
  readSettlementRecord,
  reconcilePayment,
  sameMinorMoney,
  settledReferenceFromKeys,
  settledSettlementRecord,
  settlementReplayKey,
} from "@financedistrict/saleor-agentic-commerce-core"
import type {
  HeldSettlement,
  MinorMoney,
  PaymentSettleInput,
  PaymentSettleResult,
  PendingSettlement,
  SaleorCheckout,
  SaleorOrder,
  SettlementAttempt,
  SettlementRecord,
  UcpErrorSeverity,
} from "@financedistrict/saleor-agentic-commerce-core"
import type { AgenticCommerceInstance } from "../config.js"
import { RETRY_DELAYS_MS, writeSettlementRecord } from "./write-settlement-record.js"

export type CompletionFailure = {
  code: string
  message: string
  status: number
  severity?: UcpErrorSeverity
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

type SettleRequest = DistributiveOmit<PaymentSettleInput, "checkoutId" | "channel" | "checkoutMetadata">

export type SettleAndCompleteResult =
  | { ok: true; order: SaleorOrder }
  | { ok: false; response: Response }

type Stopped = Extract<SettleAndCompleteResult, { ok: false }>

type Settled = { ok: true; settlement: SettlementRecord; settledAgainstQuote: boolean }

type SettleContext = {
  instance: Pick<AgenticCommerceInstance, "saleorClient" | "paymentHandlers" | "paymentReplayStore">
  checkout: SaleorCheckout
  metadata: Record<string, unknown>
  payment: SettleRequest
  logPrefix: string
  reject: (failure: CompletionFailure) => Stopped
  claimOrReject: (keys: readonly string[], reference?: string) => Promise<Stopped | null>
}

export async function settleAndCompleteCheckout(input: {
  instance: Pick<AgenticCommerceInstance, "saleorClient" | "paymentHandlers" | "paymentReplayStore">
  checkout: SaleorCheckout
  payment: SettleRequest
  beforeSettle?: () => Promise<Response | null>
  fail: (failure: CompletionFailure) => Response
  logPrefix: string
}): Promise<SettleAndCompleteResult> {
  const { saleorClient, paymentHandlers, paymentReplayStore } = input.instance
  const { checkout, payment, fail, logPrefix } = input
  const id = checkout.id
  const metadata = metadataToRecord(checkout.privateMetadata)
  const reject = (failure: CompletionFailure): Stopped => ({ ok: false, response: fail(failure) })
  const claimOrReject = async (keys: readonly string[], reference?: string): Promise<Stopped | null> => {
    const claim = await paymentReplayStore.claim(keys, id)
    if (claim.ok) return null
    console.error(`${logPrefix} refusing checkout ${id}: settlement ${reference ?? "not yet submitted"} is already used by checkout ${claim.heldBy} (${claim.key})`)
    return reject({
      code: "payment_already_used",
      message: `This payment${reference ? ` (reference ${reference})` : ""} was already used for another checkout. The order was not placed.`,
      status: 409,
      severity: "unrecoverable",
    })
  }
  const context: SettleContext = { instance: input.instance, checkout, metadata, payment, logPrefix, reject, claimOrReject }

  const paidOnly = await checkPaidOrdersOnly(saleorClient, checkout)
  if (!paidOnly.ok) {
    console.error(`${logPrefix} refusing to complete checkout ${id}: ${paidOnly.message}`)
    return reject({ code: paidOnly.code, message: paidOnly.message, status: 409, severity: "unrecoverable" })
  }

  const stored = readSettlementRecord(metadata)
  if (stored.kind === "unreadable") {
    console.error(`${logPrefix} settlement record on checkout ${id} is unreadable: ${JSON.stringify(stored.raw)}`)
    return reject({
      code: "settlement_unreadable",
      message: "A settlement is recorded on this checkout but cannot be read. It will not be settled again and the order was not placed.",
      status: 409,
      severity: "unrecoverable",
    })
  }
  if (stored.kind === "held") return reject(heldFailure(stored.held))

  let settlement: SettlementRecord
  let settledAgainstQuote = true
  let alreadySettled = true
  if (stored.kind === "ok") {
    settlement = stored.record
  } else if (stored.kind === "pending") {
    const recovered = await recoverPending(context, stored.pending)
    if ("ok" in recovered) return recovered
    settlement = recovered
  } else {
    const prior = await claimedSettlement(
      context,
      paymentHandlers.getAdapter(payment.handlerId)?.id ?? payment.handlerId,
      stored.kind === "failed" ? stored.money : null,
    )
    if (prior && "ok" in prior) return prior
    if (prior) {
      settlement = prior
    } else {
      const early = await input.beforeSettle?.()
      if (early) return { ok: false, response: early }

      const quoted = reconcilePayment({ quote: readPaymentQuote(metadata), total: checkout.totalPrice.gross })
      if (!quoted.ok) return reject({ code: quoted.code, message: quoted.message, status: 409, severity: "recoverable" })

      const attempt = await settleFresh(context, quoted.payable)
      if (!attempt.ok) return attempt
      settlement = attempt.settlement
      settledAgainstQuote = attempt.settledAgainstQuote
      alreadySettled = false
    }
  }
  if (alreadySettled) {
    const replayed = await claimOrReject([settlementReplayKey(settlement.handlerId, settlement.reference)], settlement.reference)
    if (replayed) return replayed
  }
  const reference = settlement.reference

  const alreadyRecorded = (checkout.transactions ?? []).some((t) => t.pspReference === reference)
  if (!alreadyRecorded) {
    const handler = paymentHandlers.getAdapter(settlement.handlerId)
    const txResult = await saleorClient.createCheckoutTransaction(id, {
      name: handler?.name ?? settlement.handlerId,
      pspReference: reference,
      amountCharged: minorToSaleorMoney(settlement),
    })
    if (!txResult.ok) {
      return reject({
        code: "order_not_recorded_after_settlement",
        message: `Payment settled (reference ${reference}) but recording the order failed: ${txResult.error}. Retry to complete the order.`,
        status: 422,
        severity: "recoverable",
      })
    }
  }

  if (!settledAgainstQuote) {
    console.error(`${logPrefix} holding checkout ${id}: handler settled ${settlement.amount} ${settlement.currency} minor units under ${reference}, which differs from the quote`)
    return reject({
      code: "settled_amount_mismatch",
      message: `The payment handler settled ${settlement.amount} ${settlement.currency} minor units (reference ${reference}), which does not match the quote. The order was not placed.`,
      status: 409,
      severity: "requires_buyer_review",
    })
  }

  const latest = await saleorClient.getCheckout(id)
  if (!latest.ok) return reject({ code: payment.protocol === "acp" ? "not_found" : "checkout_not_found", message: latest.error, status: 404 })
  const reconciled = reconcilePayment({
    quote: readPaymentQuote(metadataToRecord(latest.data.privateMetadata)),
    total: latest.data.totalPrice.gross,
    settled: settlement,
  })
  if (!reconciled.ok) {
    console.error(`${logPrefix} holding checkout ${id} after settlement ${reference}: ${reconciled.message}`)
    return reject({ code: reconciled.code, message: reconciled.message, status: 409, severity: "requires_buyer_input" })
  }

  const orderResult = await saleorClient.completeCheckout(id)
  if (!orderResult.ok) {
    return reject({
      code: "order_not_completed_after_settlement",
      message: `Payment settled (reference ${reference}) but completing the order failed: ${orderResult.error}. Retry to complete the order.`,
      status: 422,
      severity: "recoverable",
    })
  }

  return { ok: true, order: orderResult.data }
}

function heldFailure(held: Omit<HeldSettlement, "heldAt">): CompletionFailure {
  return {
    code: held.code,
    message: `Payment settled (reference ${held.reference}) but ${held.reason}. The order was not placed.`,
    status: 409,
    severity: "unrecoverable",
  }
}

function pendingFailure(startedAt?: string): CompletionFailure {
  return {
    code: "settlement_pending",
    message: `A payment submitted for this checkout${startedAt ? ` at ${startedAt}` : ""} has no recorded result. It will not be submitted again and the order was not placed. Contact the merchant to resolve it.`,
    status: 409,
    severity: "unrecoverable",
  }
}

function inProgressFailure(): CompletionFailure {
  return { code: "settlement_in_progress", message: "Another request is settling this checkout. Retry shortly.", status: 409, severity: "recoverable" }
}

function notStartedFailure(): CompletionFailure {
  return {
    code: "settlement_not_started",
    message: "The payment was not submitted because its settlement could not be recorded first. Retry to complete the order.",
    status: 422,
    severity: "recoverable",
  }
}

function notRecordedFailure(reference: string): CompletionFailure {
  return {
    code: "settlement_not_recorded",
    message: `Payment settled (reference ${reference}) but recording it failed — the order was not created. Retry to reconcile.`,
    status: 422,
    severity: "recoverable",
  }
}

function isoOrUndefined(epochMs: number | undefined): string | undefined {
  if (epochMs === undefined || !Number.isFinite(new Date(epochMs).getTime())) return undefined
  return new Date(epochMs).toISOString()
}

async function claimedSettlement(context: SettleContext, handlerId: string, money: MinorMoney | null): Promise<SettlementRecord | Stopped | null> {
  const { saleorClient, paymentReplayStore } = context.instance
  const id = context.checkout.id
  const reference = settledReferenceFromKeys(await paymentReplayStore.claimedBy(id), handlerId)
  if (!reference) return null
  if (!money) {
    console.error(`${context.logPrefix} checkout ${id} holds settlement ${reference} but no record says how much it settled`)
    return context.reject(pendingFailure())
  }
  const record: SettlementRecord = {
    amount: money.amount,
    currency: money.currency,
    handlerId,
    reference,
    settledAt: new Date().toISOString(),
  }
  const written = await writeSettlementRecord(saleorClient, id, settledSettlementRecord(record))
  if (!written.ok) {
    console.error(`${context.logPrefix} recovered ${reference} on ${id} but failed to record settlement: ${written.error}`)
    return context.reject(notRecordedFailure(reference))
  }
  return record
}

async function recoverPending(context: SettleContext, pending: PendingSettlement): Promise<SettlementRecord | Stopped> {
  const recovered = await claimedSettlement(context, pending.handlerId, pending)
  if (recovered) return recovered
  console.error(`${context.logPrefix} checkout ${context.checkout.id} has a pending settlement from ${pending.startedAt} and no settled reference was claimed`)
  return context.reject(pendingFailure(pending.startedAt))
}

async function settleFresh(context: SettleContext, payable: MinorMoney): Promise<Settled | Stopped> {
  const { saleorClient, paymentHandlers } = context.instance
  const { checkout, payment, logPrefix, reject } = context
  const id = checkout.id
  const settleInput = { ...payment, checkoutId: id, channel: checkout.channel.slug, checkoutMetadata: context.metadata } as PaymentSettleInput

  const resolution = paymentHandlers.resolveSettlement(settleInput)
  if (resolution.kind === "refused") {
    return reject({
      code: resolution.code ?? (payment.protocol === "acp" ? "payment_declined" : "payment_failed"),
      message: resolution.error,
      status: 422,
      severity: "recoverable",
    })
  }
  if (resolution.kind === "unchecked") {
    console.error(`${logPrefix} handler ${resolution.handlerId} did not declare how to detect reuse of the payment on ${id}`)
    return reject({
      code: "settled_payment_unchecked",
      message: `Payment handler ${resolution.handlerId} did not declare how to detect reuse of this payment, so it was not submitted. The order was not placed.`,
      status: 409,
      severity: "unrecoverable",
    })
  }

  if (resolution.settled && !sameMinorMoney(resolution.settled, payable)) {
    console.error(`${logPrefix} handler ${resolution.handlerId} would settle ${resolution.settled.amount} ${resolution.settled.currency} minor units on ${id}, which differs from the quote`)
    return reject({
      code: "payment_amount_mismatch",
      message: `The payment handler would settle ${resolution.settled.amount} ${resolution.settled.currency} minor units, which does not match the quote. Nothing was submitted.`,
      status: 422,
      severity: "recoverable",
    })
  }

  const { handlerId } = resolution
  const claimed = await context.claimOrReject(resolution.keys)
  if (claimed) return claimed

  const expiresAt = isoOrUndefined(resolution.expiresAt)
  const attempt: SettlementAttempt = {
    attemptId: crypto.randomUUID(),
    handlerId,
    startedAt: new Date().toISOString(),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(resolution.details === undefined ? {} : { details: resolution.details }),
  }
  const { attemptId } = attempt
  const money = resolution.settled ?? payable
  const started = await writeSettlementRecord(saleorClient, id, pendingSettlementRecord({ amount: money.amount, currency: money.currency, ...attempt, keys: resolution.keys }))
  if (!started.ok) {
    console.error(`${logPrefix} could not record the pending settlement on ${id}: ${started.error}`)
    return reject(notStartedFailure())
  }
  const owner = await pendingOwner(context, attemptId)
  if (owner === "other") return reject(inProgressFailure())
  if (owner === "unreadable") {
    console.error(`${logPrefix} could not read back the pending settlement on ${id}; keeping it pending`)
    logReview(context, "pending", attempt)
    return reject(pendingFailure(attempt.startedAt))
  }

  const result = await submit(context, settleInput)

  if (!result.success && result.settledReference) {
    console.error(`${logPrefix} handler ${payment.handlerId} settled ${result.settledReference} on ${id} but refused the settlement: ${result.error}`)
    return reject(await hold(context, { ...attempt, reference: result.settledReference, code: result.code ?? "settled_payment_refused", reason: "the settlement did not match the signed payment" }))
  }
  if (!result.success && result.outcome === "declined") {
    if (!(await recordFailure(context, attemptId, handlerId, money, result.error))) return reject(inProgressFailure())
    return reject({
      code: result.code || (payment.protocol === "acp" ? "payment_declined" : "payment_failed"),
      message: result.error || "Payment settlement failed",
      status: 422,
      severity: "recoverable",
    })
  }
  if (!result.success || !result.transactionReference) {
    console.error(`${logPrefix} settlement on ${id} has no known outcome: ${result.success ? "no transaction reference" : result.error}`)
    logReview(context, "pending", attempt)
    return reject(pendingFailure(attempt.startedAt))
  }

  if (!Array.isArray(result.replayKeys) || !result.replayKeys.every((key) => typeof key === "string" && key.length > 0)) {
    console.error(`${logPrefix} handler ${handlerId} settled ${result.transactionReference} on ${id} without readable replay keys`)
    return reject(await hold(context, { ...attempt, reference: result.transactionReference, code: "settled_payment_unchecked", reason: "the handler did not report how to detect its reuse" }))
  }
  const replayed = await context.claimOrReject(
    [settlementReplayKey(handlerId, result.transactionReference), ...result.replayKeys],
    result.transactionReference,
  )
  if (replayed) {
    await writeHeld(context, { ...attempt, reference: result.transactionReference, code: "payment_already_used", reason: "it was already used for another checkout" })
    return replayed
  }

  const raw = {
    state: "settled",
    ...result.settled,
    handlerId,
    reference: result.transactionReference,
    settledAt: new Date().toISOString(),
  }
  const recorded = await writeSettlementRecord(saleorClient, id, raw)
  if (!recorded.ok) {
    console.error(`${logPrefix} settled ${raw.reference} but failed to record settlement on ${id}: ${recorded.error}`)
    return reject(notRecordedFailure(raw.reference))
  }

  const parsed = parseSettlementRecord(raw)
  if (parsed.kind !== "ok") {
    console.error(`${logPrefix} handler ${payment.handlerId} settled ${raw.reference} on ${id} without a readable settled amount: ${JSON.stringify(result.settled)}`)
    return reject({
      code: "settled_amount_unreported",
      message: `Payment settled (reference ${raw.reference}) but the handler did not report the settled amount. The order was not placed.`,
      status: 409,
      severity: "unrecoverable",
    })
  }
  return { ok: true, settlement: parsed.record, settledAgainstQuote: sameMinorMoney(parsed.record, payable) }
}

async function submit(context: SettleContext, settleInput: PaymentSettleInput): Promise<PaymentSettleResult> {
  try {
    return await context.instance.paymentHandlers.settlePayment(settleInput)
  } catch (error: unknown) {
    return { success: false, outcome: "unknown", error: error instanceof Error ? error.message : "Unknown error" }
  }
}

async function pendingOwner(context: SettleContext, attemptId: string): Promise<"mine" | "other" | "unreadable"> {
  for (let tried = 0; tried <= RETRY_DELAYS_MS.length; tried++) {
    if (tried > 0) await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[tried - 1]))
    const latest = await context.instance.saleorClient.getCheckout(context.checkout.id)
    if (!latest.ok) continue
    const current = readSettlementRecord(metadataToRecord(latest.data.privateMetadata))
    return current.kind === "pending" && current.pending.attemptId === attemptId ? "mine" : "other"
  }
  return "unreadable"
}

async function recordFailure(context: SettleContext, attemptId: string, handlerId: string, money: MinorMoney, reason: string): Promise<boolean> {
  const { saleorClient, paymentReplayStore } = context.instance
  const id = context.checkout.id
  const claimed = settledReferenceFromKeys(await paymentReplayStore.claimedBy(id), handlerId)
  if (claimed) {
    console.error(`${context.logPrefix} not recording a decline on ${id}: settlement ${claimed} is already claimed`)
    return false
  }
  const latest = await saleorClient.getCheckout(id)
  if (!latest.ok) {
    console.error(`${context.logPrefix} could not read checkout ${id} to record the declined payment: ${latest.error}`)
    return true
  }
  const current = readSettlementRecord(metadataToRecord(latest.data.privateMetadata))
  if (!canTransition(current, "failed", attemptId)) return true
  const written = await writeSettlementRecord(
    saleorClient,
    id,
    failedSettlementRecord({ attemptId, amount: money.amount, currency: money.currency, reason, failedAt: new Date().toISOString() }),
  )
  if (!written.ok) console.error(`${context.logPrefix} could not record the declined payment on ${id}: ${written.error}`)
  return true
}

function logReview(context: SettleContext, state: "pending" | "held", fields: SettlementAttempt & { reference?: string; code?: string }): void {
  const { details, ...rest } = fields
  console.error(`${context.logPrefix} settlement ${state} needs review ${JSON.stringify({ ...details, checkoutId: context.checkout.id, state, ...rest })}`)
}

async function writeHeld(context: SettleContext, held: Omit<HeldSettlement, "heldAt">): Promise<boolean> {
  const id = context.checkout.id
  logReview(context, "held", held)
  const written = await writeSettlementRecord(context.instance.saleorClient, id, heldSettlementRecord({ ...held, heldAt: new Date().toISOString() }))
  if (!written.ok) console.error(`${context.logPrefix} could not hold settlement ${held.reference} on ${id}: ${written.error}`)
  return written.ok
}

async function hold(context: SettleContext, held: Omit<HeldSettlement, "heldAt">): Promise<CompletionFailure> {
  if (await writeHeld(context, held)) {
    const claim = await context.instance.paymentReplayStore.claim([settlementReplayKey(held.handlerId, held.reference)], context.checkout.id)
    if (!claim.ok) console.error(`${context.logPrefix} held settlement ${held.reference} on ${context.checkout.id} is already used by checkout ${claim.heldBy}`)
  }
  return heldFailure(held)
}
