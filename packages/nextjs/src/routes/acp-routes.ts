/**
 * ACP Route Handlers
 *
 * Creates Next.js App Router route handlers for all ACP endpoints.
 * Based on ACP spec version 2026-01-30.
 * https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/spec/2026-01-30
 *
 * Endpoints:
 * - POST /api/acp/checkout_sessions                     — Create checkout session
 * - POST /api/acp/checkout_sessions/[id]                — Update checkout session
 * - GET  /api/acp/checkout_sessions/[id]                — Get checkout session
 * - POST /api/acp/checkout_sessions/[id]/complete       — Complete checkout session
 * - POST /api/acp/checkout_sessions/[id]/cancel         — Cancel checkout session
 *
 * Usage:
 * ```ts
 * // src/lib/agentic-commerce.ts
 * export const agenticCommerce = createAgenticCommerce({ ... })
 * export const acpRoutes = createAcpRoutes(agenticCommerce)
 *
 * // src/app/api/acp/checkout_sessions/route.ts
 * export { POST } from '@/lib/agentic-commerce'
 * ```
 */

import {
  formatAcpCheckoutSession,
  formatAcpCompleteResponse,
  formatAcpError,
  acpToSaleorAddress,
  metadataToRecord,
  recordToMetadataInput,
  extractSignedSummary,
  readStoredPrismAccepts,
  validateSignedAgainstStored,
} from "@financedistrict/saleor-agentic-commerce-core"
import type { AgenticCommerceInstance } from "../config.js"

// Must match ucp-routes.ts — the checkout privateMetadata key holding the
// settlement record (SAC-2), so a settle-then-fail is recoverable regardless of
// which protocol drove the checkout.
const SETTLEMENT_METADATA_KEY = "agentic_commerce__settlement"

export type AcpRouteHandlers = {
  /** POST /api/acp/checkout_sessions */
  checkoutSessions: {
    POST: (request: Request) => Promise<Response>
  }
  /** GET, POST /api/acp/checkout_sessions/[id] */
  checkoutSession: {
    GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
    POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
  }
  /** POST /api/acp/checkout_sessions/[id]/complete */
  checkoutSessionComplete: {
    POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
  }
  /** POST /api/acp/checkout_sessions/[id]/cancel */
  checkoutSessionCancel: {
    POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
  }
}

export function createAcpRoutes(instance: AgenticCommerceInstance): AcpRouteHandlers {
  const { saleorClient, paymentHandlers, formatterContext, config } = instance

  function acpError(code: string, message: string, status: number): Response {
    return Response.json(
      formatAcpError({ code, message, httpStatus: status }),
      { status },
    )
  }

  /**
   * Enforce master + per-protocol enable flags. ACP routes return 404 when
   * disabled — same approach as UCP. Returns the 404 Response when blocked,
   * `null` when the request should proceed.
   */
  function checkAcpEnabled(): Response | null {
    if (!config.enabled || !config.acpEnabled) {
      return new Response("Not Found", { status: 404 })
    }
    return null
  }

  function validateApiKey(request: Request): boolean {
    if (!config.acpApiKey) return true // No key configured = open access
    const auth = request.headers.get("Authorization")
    return auth === `Bearer ${config.acpApiKey}`
  }

  function endpointBaseUrl(_request: Request): string {
    // See note in ucp-routes — use the configured public storefront URL
    // rather than the request URL (which falls back to the internal bind
    // address in Next.js).
    return `${config.storefrontUrl.replace(/\/$/, "")}/api/acp`
  }

  /**
   * Shared helper: prepare payment handlers and store metadata on checkout.
   * Returns the final checkout with updated metadata.
   */
  async function preparePaymentAndRefetch(checkoutId: string, checkout: any, baseUrl: string) {
    const totalAmount = Math.round(checkout.totalPrice.gross.amount * 100)
    const metadata = metadataToRecord(checkout.privateMetadata)

    const prepareResults = await paymentHandlers.prepareCheckoutPayment({
      checkoutId,
      total: totalAmount,
      currencyCode: checkout.totalPrice.gross.currency,
      checkoutBaseUrl: `${baseUrl}/checkout_sessions`,
      storeName: config.storeName,
      checkoutMetadata: metadata,
    })

    const metadataUpdates = recordToMetadataInput(prepareResults)
    if (metadataUpdates.length > 0) {
      // Best-effort persist of the prepared payment config. If this write
      // fails the next request will re-prepare (idempotent on Prism's side
      // for the same resource+amount), so we don't fail the create/update
      // flow on this — but we DO surface the failure to logs so an
      // ongoing systemic failure (e.g., permission regression on the
      // Saleor App token) is visible operationally instead of just
      // rendering empty payment_handlers to agents.
      const persistResult = await saleorClient.updatePrivateMetadata(checkoutId, metadataUpdates)
      if (!persistResult.ok) {
        console.error(
          `[acp-routes] Failed to persist prepared payment config on checkout ${checkoutId}: ${persistResult.error}`,
        )
      }
    }

    const updatedCheckout = await saleorClient.getCheckout(checkoutId)
    return updatedCheckout.ok ? updatedCheckout.data : checkout
  }

  return {
    // =====================================================
    // Create Checkout — POST /api/acp/checkout_sessions
    // =====================================================
    checkoutSessions: {
      async POST(request: Request) {
        const blocked = checkAcpEnabled()
        if (blocked) return blocked

        if (!validateApiKey(request)) {
          return acpError("unauthorized", "Invalid or missing API key", 401)
        }

        let body: any
        try {
          body = await request.json()
        } catch {
          return acpError("invalid_body", "Request body must be valid JSON", 400)
        }

        const lineItems = body.line_items
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
          return acpError("missing", "line_items array is required", 400)
        }

        // Map ACP line items to Saleor checkout lines
        // ACP spec: line_items[].item.id, line_items[].quantity
        const lines = lineItems.map((li: any) => ({
          variantId: li.item?.id || li.id,
          quantity: li.quantity || 1,
        }))

        // Extract buyer info
        const email = body.buyer?.email

        // Extract fulfillment address from fulfillment_details
        const shippingAddress = body.fulfillment_details?.address
          ? acpToSaleorAddress(body.fulfillment_details.address)
          : undefined
        // If billing isn't explicitly provided, mirror shipping — otherwise
        // checkoutComplete fails later with BILLING_ADDRESS_NOT_SET.
        const billingAddress = body.billing_address
          ? acpToSaleorAddress(body.billing_address)
          : shippingAddress

        // Create Saleor checkout
        const checkoutResult = await saleorClient.createCheckout({
          lines,
          email,
          shippingAddress,
          billingAddress,
        })

        if (!checkoutResult.ok) {
          return acpError("checkout_create_failed", checkoutResult.error, 422)
        }

        // If a shipping address was supplied but Saleor returns no usable
        // shipping methods for it, fail loudly here rather than silently
        // accepting an unfulfillable order that would later die at complete.
        if (shippingAddress && checkoutResult.data.shippingMethods.length === 0) {
          return acpError(
            "unsupported_shipping_destination",
            `No shipping methods available for destination country '${shippingAddress.country ?? "unknown"}'`,
            422,
          )
        }

        const baseUrl = endpointBaseUrl(request)
        const finalCheckout = await preparePaymentAndRefetch(
          checkoutResult.data.id, checkoutResult.data, baseUrl,
        )

        const session = formatAcpCheckoutSession(formatterContext, finalCheckout)
        return Response.json(session, { status: 201 })
      },
    },

    // =====================================================
    // Get/Update Checkout Session
    // =====================================================
    checkoutSession: {
      async GET(request: Request, context: { params: Promise<{ id: string }> }) {
        const blocked = checkAcpEnabled()
        if (blocked) return blocked

        if (!validateApiKey(request)) {
          return acpError("unauthorized", "Invalid or missing API key", 401)
        }

        const { id } = await context.params
        const result = await saleorClient.getCheckout(id)
        if (!result.ok) return acpError("not_found", result.error, 404)

        const session = formatAcpCheckoutSession(formatterContext, result.data)
        // metadataToRecord JSON.parses values, so the literal "true" written by
        // the cancel route comes back as boolean true (not the string "true").
        const canceled =
          metadataToRecord(result.data.privateMetadata).acp_canceled === true
        return Response.json(canceled ? { ...session, status: "canceled" } : session)
      },

      // ACP spec: Update uses POST (not PUT)
      async POST(request: Request, context: { params: Promise<{ id: string }> }) {
        const blocked = checkAcpEnabled()
        if (blocked) return blocked

        if (!validateApiKey(request)) {
          return acpError("unauthorized", "Invalid or missing API key", 401)
        }

        const { id } = await context.params
        let body: any
        try {
          body = await request.json()
        } catch {
          return acpError("invalid_body", "Request body must be valid JSON", 400)
        }

        // Refuse updates on a session the agent has already cancelled.
        const cancelGuard = await saleorClient.getCheckout(id)
        if (!cancelGuard.ok) return acpError("not_found", cancelGuard.error, 404)
        if (metadataToRecord(cancelGuard.data.privateMetadata).acp_canceled === true) {
          return acpError("session_canceled", "Checkout session has been canceled", 409)
        }

        // Update buyer email
        if (body.buyer?.email) {
          const result = await saleorClient.updateCheckoutEmail(id, body.buyer.email)
          if (!result.ok) return acpError("invalid", result.error, 422)
        }

        // Update fulfillment details (address)
        if (body.fulfillment_details?.address) {
          const addr = acpToSaleorAddress(body.fulfillment_details.address)
          const result = await saleorClient.updateCheckoutShippingAddress(id, addr)
          if (!result.ok) return acpError("invalid", result.error, 422)
          if (result.data.shippingMethods.length === 0) {
            return acpError(
              "unsupported_shipping_destination",
              `No shipping methods available for destination country '${addr.country ?? "unknown"}'`,
              422,
            )
          }
          // Mirror billing if it hasn't been set yet, so checkoutComplete
          // doesn't later fail with BILLING_ADDRESS_NOT_SET.
          if (!result.data.billingAddress && !body.billing_address) {
            const billingResult = await saleorClient.updateCheckoutBillingAddress(id, addr)
            if (!billingResult.ok) return acpError("invalid", billingResult.error, 422)
          }
        }

        // Update billing address
        if (body.billing_address) {
          const addr = acpToSaleorAddress(body.billing_address)
          const result = await saleorClient.updateCheckoutBillingAddress(id, addr)
          if (!result.ok) return acpError("invalid", result.error, 422)
        }

        // Update selected fulfillment option
        if (body.selected_fulfillment_options && Array.isArray(body.selected_fulfillment_options)) {
          const selected = body.selected_fulfillment_options[0]
          if (selected?.option_id) {
            const result = await saleorClient.updateCheckoutDeliveryMethod(id, selected.option_id)
            if (!result.ok) return acpError("invalid", result.error, 422)
          }
        }

        // Update line items if provided
        if (body.line_items && Array.isArray(body.line_items)) {
          const lines = body.line_items.map((li: any) => ({
            variantId: li.item?.id || li.id,
            quantity: li.quantity || 1,
          }))
          const result = await saleorClient.updateCheckoutLines(id, lines)
          if (!result.ok) return acpError("invalid", result.error, 422)
        }

        // Re-fetch and prepare payment
        const checkoutResult = await saleorClient.getCheckout(id)
        if (!checkoutResult.ok) return acpError("not_found", checkoutResult.error, 404)

        const baseUrl = endpointBaseUrl(request)
        const finalCheckout = await preparePaymentAndRefetch(id, checkoutResult.data, baseUrl)

        const session = formatAcpCheckoutSession(formatterContext, finalCheckout)
        return Response.json(session)
      },
    },

    // =====================================================
    // Complete Checkout — returns full session + order
    // =====================================================
    checkoutSessionComplete: {
      async POST(request: Request, context: { params: Promise<{ id: string }> }) {
        const blocked = checkAcpEnabled()
        if (blocked) return blocked

        if (!validateApiKey(request)) {
          return acpError("unauthorized", "Invalid or missing API key", 401)
        }

        const { id } = await context.params
        let body: any
        try {
          body = await request.json()
        } catch {
          return acpError("invalid_body", "Request body must be valid JSON", 400)
        }

        // ACP spec payment_data: { handler_id, instrument: { type, credential: { type, token } }, billing_address? }
        const paymentData = body.payment_data
        if (!paymentData) {
          return acpError("missing", "payment_data is required", 400)
        }

        // Update billing address if provided. Mirror the PUT route's
        // error-check pattern: the same SDK call is checked there, but
        // silently swallowed here — a malformed override would let
        // settlement proceed against the previously-set billing address
        // with no error surfaced to the agent.
        if (paymentData.billing_address) {
          const addr = acpToSaleorAddress(paymentData.billing_address)
          const billingResult = await saleorClient.updateCheckoutBillingAddress(id, addr)
          if (!billingResult.ok) {
            return acpError("billing_address_update_failed", billingResult.error, 422)
          }
        }

        // Fetch checkout for metadata
        const checkoutResult = await saleorClient.getCheckout(id)
        if (!checkoutResult.ok) return acpError("not_found", checkoutResult.error, 404)

        const checkout = checkoutResult.data
        const metadata = metadataToRecord(checkout.privateMetadata)

        // Refuse to settle on a session the agent has already cancelled.
        // Without this, an agent that aborts and retries can still sign
        // and settle against a session it thought was dead.
        if (metadata.acp_canceled === true) {
          return acpError("session_canceled", "Checkout session has been canceled", 409)
        }

        // Determine the payment handler to use
        const handlerId = paymentData.handler_id || "xyz.fd.prism_payment"

        // Extract credential from instrument
        const credential = paymentData.instrument?.credential || paymentData.credential

        // Validate the agent's signed payload against the checkout's
        // stored Prism quote before forwarding to settlement. See
        // validate-signed-amount.ts for details. Skipped if the credential
        // shape is unrecognised or the checkout has no stored Prism quote
        // (non-Prism handler) — those cases fall through to existing
        // downstream validation.
        const signedSummary = extractSignedSummary(credential)
        if (signedSummary) {
          const storedAccepts = readStoredPrismAccepts(metadata, "acp")
          if (storedAccepts) {
            const validation = validateSignedAgainstStored(signedSummary, storedAccepts)
            if (!validation.ok) {
              return acpError(validation.code, validation.message, 422)
            }
          }
        }

        // --- Settle + record (SAC-2) — see ucp-routes.ts for the full rationale.
        const priorSettlement = metadata[SETTLEMENT_METADATA_KEY] as
          | { reference?: string }
          | undefined

        let reference: string | undefined
        if (priorSettlement?.reference) {
          // Retry-to-recover: money already moved; don't settle again.
          reference = priorSettlement.reference
        } else {
          const settleResult = await paymentHandlers.settlePayment({
            checkoutId: id,
            handlerId,
            credential,
            checkoutMetadata: metadata,
          })
          if (!settleResult.success) {
            return acpError("payment_declined", settleResult.error || "Payment settlement failed", 422)
          }
          reference = settleResult.transactionReference

          if (reference) {
            const record = {
              handlerId,
              reference,
              amount: checkout.totalPrice.gross.amount,
              currency: checkout.totalPrice.gross.currency,
              settledAt: new Date().toISOString(),
            }
            const recResult = await saleorClient.updatePrivateMetadata(id, [
              { key: SETTLEMENT_METADATA_KEY, value: JSON.stringify(record) },
            ])
            if (!recResult.ok) {
              console.error(`[acp-routes] settled ${reference} but failed to record settlement on ${id}: ${recResult.error}`)
              return acpError(
                "settlement_not_recorded",
                `Payment settled (reference ${reference}) but recording it failed — the order was not created. Retry to reconcile.`,
                422,
              )
            }
          }
        }

        // Register the settled payment as a Saleor transaction, unless already
        // recorded (retry after a later failure) — avoids a duplicate charge.
        if (reference) {
          const alreadyRecorded = (checkout.transactions ?? []).some((t) => t.pspReference === reference)
          if (!alreadyRecorded) {
            const handler = paymentHandlers.getAdapter(handlerId)
            const txResult = await saleorClient.createCheckoutTransaction(id, {
              name: handler?.name ?? handlerId,
              pspReference: reference,
              amountCharged: {
                amount: checkout.totalPrice.gross.amount,
                currency: checkout.totalPrice.gross.currency,
              },
            })
            if (!txResult.ok) {
              return acpError(
                "order_not_recorded_after_settlement",
                `Payment settled (reference ${reference}) but recording the order failed: ${txResult.error}. Retry to complete the order.`,
                422,
              )
            }
          }
        }

        // Complete checkout in Saleor
        const orderResult = await saleorClient.completeCheckout(id)
        if (!orderResult.ok) {
          if (reference) {
            return acpError(
              "order_not_completed_after_settlement",
              `Payment settled (reference ${reference}) but completing the order failed: ${orderResult.error}. Retry to complete the order.`,
              422,
            )
          }
          return acpError("processing_error", orderResult.error, 422)
        }

        // Return full session with completed status + order
        const response = formatAcpCompleteResponse(formatterContext, checkout, orderResult.data)
        return Response.json(response)
      },
    },

    // =====================================================
    // Cancel Checkout — returns full session with canceled status
    // =====================================================
    checkoutSessionCancel: {
      async POST(request: Request, context: { params: Promise<{ id: string }> }) {
        const blocked = checkAcpEnabled()
        if (blocked) return blocked

        if (!validateApiKey(request)) {
          return acpError("unauthorized", "Invalid or missing API key", 401)
        }

        const { id } = await context.params

        // Verify checkout exists
        const result = await saleorClient.getCheckout(id)
        if (!result.ok) return acpError("not_found", result.error, 404)

        // Mark as canceled via metadata. We MUST check this write succeeded
        // before telling the agent the session is cancelled — the cancel
        // guards on GET/PUT/complete (PR #40, fixed in PR #42) read this
        // metadata flag to decide whether to refuse further mutations. A
        // silent persistence failure here would return status="canceled" to
        // the agent but leave the flag unwritten, so the very next request
        // would find no flag, the guards would not fire, and the agent could
        // continue to mutate, sign, and settle against a session it thought
        // was dead — the exact bug PR #42 closed at the type-coercion layer,
        // re-opened here at a different failure mode (transient Saleor write
        // error, permission issue, concurrent modification).
        const persistResult = await saleorClient.updatePrivateMetadata(id, [
          { key: "acp_canceled", value: "true" },
          { key: "acp_canceled_at", value: new Date().toISOString() },
        ])
        if (!persistResult.ok) {
          return acpError("cancel_persist_failed", persistResult.error, 422)
        }

        // Return full session with canceled status
        const session = formatAcpCheckoutSession(formatterContext, result.data)
        return Response.json({
          ...session,
          status: "canceled",
        })
      },
    },
  }
}
