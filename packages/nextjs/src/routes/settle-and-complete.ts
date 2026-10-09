import {
  checkPaidOrdersOnly,
  extractSignedSummary,
  metadataToRecord,
  minorToSaleorMoney,
  parseSettlementRecord,
  readPaymentQuote,
  readSettlementRecord,
  readStoredPrismAccepts,
  reconcilePayment,
  sameMinorMoney,
  validateSignedAgainstStored,
  SETTLEMENT_METADATA_KEY,
} from "@financedistrict/saleor-agentic-commerce-core"
import type {
  PaymentSettleInput,
  SaleorCheckout,
  SaleorOrder,
  SettlementRecord,
  UcpErrorSeverity,
} from "@financedistrict/saleor-agentic-commerce-core"
import type { AgenticCommerceInstance } from "../config.js"

export type CompletionFailure = {
  code: string
  message: string
  status: number
  severity?: UcpErrorSeverity
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

type SettleRequest = DistributiveOmit<PaymentSettleInput, "checkoutId" | "checkoutMetadata">

export type SettleAndCompleteResult =
  | { ok: true; order: SaleorOrder }
  | { ok: false; response: Response }

export async function settleAndCompleteCheckout(input: {
  instance: Pick<AgenticCommerceInstance, "saleorClient" | "paymentHandlers">
  checkout: SaleorCheckout
  payment: SettleRequest
  beforeSettle?: () => Promise<Response | null>
  fail: (failure: CompletionFailure) => Response
  logPrefix: string
}): Promise<SettleAndCompleteResult> {
  const { saleorClient, paymentHandlers } = input.instance
  const { checkout, payment, fail, logPrefix } = input
  const id = checkout.id
  const metadata = metadataToRecord(checkout.privateMetadata)
  const reject = (failure: CompletionFailure): SettleAndCompleteResult => ({ ok: false, response: fail(failure) })

  const paidOnly = await checkPaidOrdersOnly(saleorClient, checkout)
  if (!paidOnly.ok) {
    console.error(`${logPrefix} refusing to complete checkout ${id}: ${paidOnly.message}`)
    return reject({ code: paidOnly.code, message: paidOnly.message, status: 409, severity: "unrecoverable" })
  }

  const signedSummary = extractSignedSummary(payment.credential)
  if (signedSummary) {
    const storedAccepts = readStoredPrismAccepts(metadata, payment.protocol === "acp" ? "acp" : "ucp")
    if (storedAccepts) {
      const validation = validateSignedAgainstStored(signedSummary, storedAccepts)
      if (!validation.ok) return reject({ code: validation.code, message: validation.message, status: 422 })
    }
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

  let settlement: SettlementRecord
  let settledAgainstQuote = true
  if (stored.kind === "ok") {
    settlement = stored.record
  } else {
    const early = await input.beforeSettle?.()
    if (early) return { ok: false, response: early }

    const quoted = reconcilePayment({ quote: readPaymentQuote(metadata), total: checkout.totalPrice.gross })
    if (!quoted.ok) return reject({ code: quoted.code, message: quoted.message, status: 409, severity: "recoverable" })

    const result = await paymentHandlers.settlePayment({ ...payment, checkoutId: id, checkoutMetadata: metadata } as PaymentSettleInput)
    if (!result.success || !result.transactionReference) {
      return reject({
        code: payment.protocol === "acp" ? "payment_declined" : "payment_failed",
        message: (!result.success && result.error) || "Payment settlement failed",
        status: 422,
        severity: "recoverable",
      })
    }

    const raw = {
      ...result.settled,
      handlerId: payment.handlerId,
      reference: result.transactionReference,
      settledAt: new Date().toISOString(),
    }
    const recResult = await saleorClient.updatePrivateMetadata(id, [{ key: SETTLEMENT_METADATA_KEY, value: JSON.stringify(raw) }])
    if (!recResult.ok) {
      console.error(`${logPrefix} settled ${raw.reference} but failed to record settlement on ${id}: ${recResult.error}`)
      return reject({
        code: "settlement_not_recorded",
        message: `Payment settled (reference ${raw.reference}) but recording it failed — the order was not created. Retry to reconcile.`,
        status: 422,
        severity: "recoverable",
      })
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
    settlement = parsed.record
    settledAgainstQuote = sameMinorMoney(settlement, quoted.payable)
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
