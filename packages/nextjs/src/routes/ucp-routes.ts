/**
 * UCP Route Handlers
 *
 * Creates Next.js App Router route handlers for all UCP endpoints.
 * Based on UCP spec version 2026-04-08.
 * https://ucp.dev/2026-04-08/specification/overview
 *
 * Endpoints:
 * - GET  /.well-known/ucp                             — Discovery profile
 * - POST /api/ucp/checkout-sessions                   — Create checkout
 * - GET  /api/ucp/checkout-sessions/[id]              — Get checkout
 * - PUT  /api/ucp/checkout-sessions/[id]              — Update checkout
 * - POST /api/ucp/checkout-sessions/[id]/complete     — Complete checkout
 * - POST /api/ucp/checkout-sessions/[id]/cancel       — Cancel checkout
 * - GET  /api/ucp/orders/[id]                         — Get order
 *
 * Usage:
 * ```ts
 * // src/lib/agentic-commerce.ts
 * export const agenticCommerce = createAgenticCommerce({ ... })
 * export const ucpRoutes = createUcpRoutes(agenticCommerce)
 *
 * // src/app/.well-known/ucp/route.ts
 * export { GET } from '@/lib/agentic-commerce'
 * ```
 */

import {
  formatUcpProfile,
  formatUcpCheckoutSession,
  formatUcpCompleteResponse,
  formatUcpOrder,
  formatUcpCatalogSearch,
  formatUcpCatalogLookup,
  formatUcpError,
  ucpToSaleorAddress,
  metadataToRecord,
  recordToMetadataInput,
  extractSignedSummary,
  readStoredPrismAccepts,
  validateSignedAgainstStored,
  planCartReplacement,
  saleorErrorsToUcpMessages,
} from "@financedistrict/saleor-agentic-commerce-core"
import type { AgenticCommerceInstance } from "../config.js"
import type { UcpErrorSeverity } from "@financedistrict/saleor-agentic-commerce-core"

// Checkout privateMetadata key holding the settlement record (SAC-2): the tx
// reference + amount, written the moment a payment settles — BEFORE the Saleor
// writes that can fail. Turns a settle-then-fail into a recoverable, auditable
// state, and lets a retried complete skip re-settling. Must match acp-routes.ts.
const SETTLEMENT_METADATA_KEY = "agentic_commerce__settlement"

export type UcpRouteHandlers = {
  /** GET /.well-known/ucp */
  discovery: {
    GET: (request: Request) => Promise<Response>
  }
  /** POST /api/ucp/checkout-sessions */
  checkoutSessions: {
    POST: (request: Request) => Promise<Response>
  }
  /** GET, PUT /api/ucp/checkout-sessions/[id] */
  checkoutSession: {
    GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
    PUT: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
  }
  /** POST /api/ucp/checkout-sessions/[id]/complete */
  checkoutSessionComplete: {
    POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
  }
  /** POST /api/ucp/checkout-sessions/[id]/cancel */
  checkoutSessionCancel: {
    POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
  }
  /** GET /api/ucp/orders/[id] */
  order: {
    GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
  }
  /** POST /api/ucp/catalog/search */
  catalogSearch: {
    POST: (request: Request) => Promise<Response>
  }
  /** POST /api/ucp/catalog/lookup */
  catalogLookup: {
    POST: (request: Request) => Promise<Response>
  }
}

export function createUcpRoutes(instance: AgenticCommerceInstance): UcpRouteHandlers {
  const { saleorClient, paymentHandlers, formatterContext, config } = instance

  function ucpError(
    code: string,
    content: string,
    status: number,
    severity?: UcpErrorSeverity,
  ): Response {
    return Response.json(
      formatUcpError({ ucpVersion: config.ucpVersion, code, content, severity }),
      { status },
    )
  }

  // Surface a failed Saleor mutation with its structured field errors — one UCP
  // message per error, field preserved — instead of collapsing to errors[0]
  // (SAC-5). Defaults to recoverable: validation errors are fixable input.
  function ucpSaleorError(
    code: string,
    status: number,
    result: { error: string; errors?: unknown },
    severity: UcpErrorSeverity = "recoverable",
  ): Response {
    const messages = saleorErrorsToUcpMessages(result.errors, {
      code,
      severity,
      fallbackContent: result.error,
    })
    return Response.json(formatUcpError({ ucpVersion: config.ucpVersion, messages }), { status })
  }

  /**
   * Enforce master + per-protocol enable flags. When agentic commerce is
   * disabled (master toggle off) or UCP specifically is disabled, every
   * UCP route returns 404 — agents see the storefront as if no UCP support
   * exists at all, rather than encountering errors mid-flow.
   *
   * Returns the 404 Response when blocked, or `null` when the request
   * should proceed.
   */
  function checkUcpEnabled(): Response | null {
    if (!config.enabled || !config.ucpEnabled) {
      return new Response("Not Found", { status: 404 })
    }
    return null
  }

  function endpointBaseUrl(_request: Request): string {
    // Use the storefront's configured public URL rather than the incoming
    // request's URL. `request.url` in Next.js is path-only on the wire, so
    // `new URL(request.url)` falls back to the container's internal bind
    // address (e.g. http://0.0.0.0:3000) — not what we want to advertise to
    // agents. The storefront knows its own public URL because the merchant
    // passes it explicitly when calling `createAgenticCommerce()`.
    return `${config.storefrontUrl.replace(/\/$/, "")}/api/ucp`
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
      checkoutBaseUrl: `${baseUrl}/checkout-sessions`,
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
          `[ucp-routes] Failed to persist prepared payment config on checkout ${checkoutId}: ${persistResult.error}`,
        )
      }
    }

    const updatedCheckout = await saleorClient.getCheckout(checkoutId)
    return updatedCheckout.ok ? updatedCheckout.data : checkout
  }

  return {
    // =====================================================
    // Discovery — GET /.well-known/ucp
    // =====================================================
    discovery: {
      async GET(request: Request) {
        const blocked = checkUcpEnabled()
        if (blocked) return blocked

        const baseUrl = endpointBaseUrl(request)
        const profile = await formatUcpProfile(formatterContext, baseUrl)

        return Response.json(profile, {
          headers: {
            "Cache-Control": "public, max-age=300",
            "Content-Type": "application/json",
          },
        })
      },
    },

    // =====================================================
    // Create Checkout Session — POST /api/ucp/checkout-sessions
    // =====================================================
    checkoutSessions: {
      async POST(request: Request) {
        const blocked = checkUcpEnabled()
        if (blocked) return blocked

        let body: any
        try {
          body = await request.json()
        } catch {
          return ucpError("invalid_body", "Request body must be valid JSON", 400)
        }

        const lineItems = body.line_items
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
          return ucpError("missing_line_items", "line_items array is required", 400, "recoverable")
        }

        // Map UCP line items to Saleor checkout lines
        const lines = lineItems.map((item: any) => ({
          variantId: item.item?.id || item.id,
          quantity: item.quantity || 1,
        }))

        // Extract buyer email
        const email = body.buyer?.email

        // Extract fulfillment address from fulfillment.methods[0].destinations[0]
        const fulfillmentDest = body.fulfillment?.methods?.[0]?.destinations?.[0]
        const shippingAddress = fulfillmentDest
          ? ucpToSaleorAddress(fulfillmentDest)
          : undefined

        // Create Saleor checkout. UCP has no first-class billing block,
        // so we mirror billing = shipping. Without this, checkoutComplete
        // later fails with BILLING_ADDRESS_NOT_SET.
        const checkoutResult = await saleorClient.createCheckout({
          lines,
          email,
          shippingAddress,
          billingAddress: shippingAddress,
        })

        if (!checkoutResult.ok) {
          return ucpSaleorError("checkout_create_failed", 422, checkoutResult)
        }

        // If a shipping address was supplied but Saleor returns no usable
        // shipping methods for it, fail loudly here rather than silently
        // accepting an unfulfillable order that would later die at complete.
        if (shippingAddress && checkoutResult.data.shippingMethods.length === 0) {
          return ucpError(
            "unsupported_shipping_destination",
            `No shipping methods available for destination country '${shippingAddress.country ?? "unknown"}'`,
            422,
            "requires_buyer_input",
          )
        }

        const baseUrl = endpointBaseUrl(request)
        const finalCheckout = await preparePaymentAndRefetch(
          checkoutResult.data.id, checkoutResult.data, baseUrl,
        )

        const session = formatUcpCheckoutSession(formatterContext, finalCheckout)
        return Response.json(session, { status: 201 })
      },
    },

    // =====================================================
    // Get/Update Checkout Session
    // =====================================================
    checkoutSession: {
      async GET(request: Request, context: { params: Promise<{ id: string }> }) {
        const blocked = checkUcpEnabled()
        if (blocked) return blocked

        const { id } = await context.params
        const result = await saleorClient.getCheckout(id)
        if (!result.ok) return ucpError("checkout_not_found", result.error, 404)

        const session = formatUcpCheckoutSession(formatterContext, result.data)
        // metadataToRecord JSON.parses values, so the literal "true" written by
        // the cancel route comes back as boolean true (not the string "true").
        const canceled =
          metadataToRecord(result.data.privateMetadata).ucp_canceled === true
        return Response.json(canceled ? { ...session, status: "canceled" } : session)
      },

      async PUT(request: Request, context: { params: Promise<{ id: string }> }) {
        const blocked = checkUcpEnabled()
        if (blocked) return blocked

        const { id } = await context.params
        let body: any
        try {
          body = await request.json()
        } catch {
          return ucpError("invalid_body", "Request body must be valid JSON", 400)
        }

        // Refuse updates on a session the agent has already cancelled.
        const cancelGuard = await saleorClient.getCheckout(id)
        if (!cancelGuard.ok) return ucpError("checkout_not_found", cancelGuard.error, 404)
        if (metadataToRecord(cancelGuard.data.privateMetadata).ucp_canceled === true) {
          return ucpError("session_canceled", "Checkout session has been canceled", 409)
        }

        // Update buyer email
        if (body.buyer?.email) {
          const result = await saleorClient.updateCheckoutEmail(id, body.buyer.email)
          if (!result.ok) return ucpSaleorError("email_update_failed", 422, result)
        }

        // Update fulfillment: extract destination address and selected option
        if (body.fulfillment?.methods) {
          const method = body.fulfillment.methods[0]
          if (method) {
            // Update shipping address from destination
            const dest = method.destinations?.[0]
            if (dest) {
              const addr = ucpToSaleorAddress(dest)
              const result = await saleorClient.updateCheckoutShippingAddress(id, addr)
              if (!result.ok) return ucpSaleorError("shipping_address_update_failed", 422, result)
              if (result.data.shippingMethods.length === 0) {
                return ucpError(
                  "unsupported_shipping_destination",
                  `No shipping methods available for destination country '${addr.country ?? "unknown"}'`,
                  422,
                  "requires_buyer_input",
                )
              }
              // Mirror billing if it hasn't been set yet (UCP has no
              // first-class billing block), so checkoutComplete doesn't
              // later fail with BILLING_ADDRESS_NOT_SET.
              if (!result.data.billingAddress) {
                const billingResult = await saleorClient.updateCheckoutBillingAddress(id, addr)
                if (!billingResult.ok) {
                  return ucpSaleorError("billing_address_update_failed", 422, billingResult)
                }
              }
            }

            // Update delivery method from selected option
            const selectedOptionId = method.groups?.[0]?.selected_option_id
            if (selectedOptionId) {
              const result = await saleorClient.updateCheckoutDeliveryMethod(id, selectedOptionId)
              if (!result.ok) return ucpSaleorError("delivery_method_update_failed", 422, result)
            }
          }
        }

        // Update line items if provided. UCP PUT is a FULL replacement of the
        // checkout resource (checkout.md → Update Checkout), so line_items is
        // the complete desired cart: add new variants, update changed
        // quantities, and DELETE variants the agent omitted. The prior code
        // only ran checkoutLinesUpdate, so omitted lines were silently retained
        // and an agent could never remove an item (U-2).
        if (body.line_items && Array.isArray(body.line_items)) {
          const desired = body.line_items.map((item: any) => ({
            variantId: item.item?.id || item.id,
            quantity: item.quantity ?? 1,
          }))
          const current = cancelGuard.data.lines.map((l) => ({
            id: l.id,
            variantId: l.variant.id,
            quantity: l.quantity,
          }))
          const plan = planCartReplacement(current, desired)

          if (plan.toDelete.length > 0) {
            const del = await saleorClient.deleteCheckoutLines(id, plan.toDelete)
            if (!del.ok) return ucpSaleorError("items_update_failed", 422, del)
          }
          if (plan.toAdd.length > 0) {
            const add = await saleorClient.addCheckoutLines(id, plan.toAdd)
            if (!add.ok) return ucpSaleorError("items_update_failed", 422, add)
          }
          if (plan.toUpdate.length > 0) {
            const upd = await saleorClient.updateCheckoutLines(id, plan.toUpdate)
            if (!upd.ok) return ucpSaleorError("items_update_failed", 422, upd)
          }
        }

        // Re-fetch and prepare payment
        const checkoutResult = await saleorClient.getCheckout(id)
        if (!checkoutResult.ok) return ucpError("checkout_not_found", checkoutResult.error, 404)

        const baseUrl = endpointBaseUrl(request)
        const finalCheckout = await preparePaymentAndRefetch(id, checkoutResult.data, baseUrl)

        const session = formatUcpCheckoutSession(formatterContext, finalCheckout)
        return Response.json(session)
      },
    },

    // =====================================================
    // Complete Checkout Session
    // =====================================================
    checkoutSessionComplete: {
      async POST(request: Request, context: { params: Promise<{ id: string }> }) {
        const blocked = checkUcpEnabled()
        if (blocked) return blocked

        const { id } = await context.params
        let body: any
        try {
          body = await request.json()
        } catch {
          return ucpError("invalid_body", "Request body must be valid JSON", 400)
        }

        // Extract payment instrument
        const payment = body.payment
        if (!payment?.instruments || !Array.isArray(payment.instruments)) {
          return ucpError("missing_payment", "payment.instruments array is required", 400, "recoverable")
        }

        const selectedInstrument = payment.instruments.find((i: any) => i.selected) || payment.instruments[0]
        if (!selectedInstrument) {
          return ucpError("no_instrument_selected", "At least one payment instrument must be provided", 400, "recoverable")
        }

        // Fetch checkout for metadata
        const checkoutResult = await saleorClient.getCheckout(id)
        if (!checkoutResult.ok) return ucpError("checkout_not_found", checkoutResult.error, 404)

        const checkout = checkoutResult.data
        const metadata = metadataToRecord(checkout.privateMetadata)

        // Refuse to settle on a session the agent has already cancelled.
        // Without this, an agent that aborts and retries can still sign
        // and settle against a session it thought was dead.
        if (metadata.ucp_canceled === true) {
          return ucpError("session_canceled", "Checkout session has been canceled", 409)
        }

        // Update billing address if provided on instrument. Mirror the
        // PUT route's error-check pattern (~ line 284): the same SDK call
        // is checked there, but silently swallowed here — a malformed
        // override would let settlement proceed against the previously-set
        // billing address with no error surfaced to the agent.
        if (selectedInstrument.billing_address) {
          const addr = ucpToSaleorAddress(selectedInstrument.billing_address)
          const billingResult = await saleorClient.updateCheckoutBillingAddress(id, addr)
          if (!billingResult.ok) {
            return ucpSaleorError("billing_address_update_failed", 422, billingResult)
          }
        }

        // Validate the agent's signed payload against the checkout's
        // stored Prism quote before forwarding to settlement. See
        // validate-signed-amount.ts for details. Skipped if the credential
        // shape is unrecognised or the checkout has no stored Prism quote
        // (non-Prism handler) — those cases fall through to existing
        // downstream validation.
        const signedSummary = extractSignedSummary(selectedInstrument.credential)
        if (signedSummary) {
          const storedAccepts = readStoredPrismAccepts(metadata, "ucp")
          if (storedAccepts) {
            const validation = validateSignedAgainstStored(signedSummary, storedAccepts)
            if (!validation.ok) {
              return ucpError(validation.code, validation.message, 422)
            }
          }
        }

        // --- Settle + record (SAC-2) ----------------------------------------
        // A prior `complete` may have settled on-chain (irreversible) and then
        // failed before the order was recorded. To make that recoverable rather
        // than a silent charged-no-order, the settlement is written to checkout
        // privateMetadata the instant it succeeds, BEFORE the Saleor writes that
        // can fail. On a retry we find that record and skip re-settling.
        const priorSettlement = metadata[SETTLEMENT_METADATA_KEY] as
          | { reference?: string }
          | undefined

        let reference: string | undefined
        if (priorSettlement?.reference) {
          // Retry-to-recover: the money already moved (the EIP-3009 nonce makes a
          // repeat settle a no-op anyway). Don't settle again — resume bookkeeping.
          reference = priorSettlement.reference
        } else {
          const settleResult = await paymentHandlers.settlePayment({
            checkoutId: id,
            handlerId: selectedInstrument.handler_id,
            credential: selectedInstrument.credential,
            checkoutMetadata: metadata,
          })
          if (!settleResult.success) {
            return ucpError("payment_failed", settleResult.error || "Payment settlement failed", 422, "recoverable")
          }
          reference = settleResult.transactionReference

          // Record the settlement BEFORE createCheckoutTransaction/completeCheckout
          // (either can fail). Saleor's per-checkout privateMetadata is the direct
          // analog of Shopware's settlement table; the response is stored opaquely.
          if (reference) {
            const record = {
              handlerId: selectedInstrument.handler_id,
              reference,
              amount: checkout.totalPrice.gross.amount,
              currency: checkout.totalPrice.gross.currency,
              settledAt: new Date().toISOString(),
            }
            const recResult = await saleorClient.updatePrivateMetadata(id, [
              { key: SETTLEMENT_METADATA_KEY, value: JSON.stringify(record) },
            ])
            if (!recResult.ok) {
              // Settled but the marker did not persist. Refuse to go further and
              // lose the trail — return an HONEST, recoverable error naming the
              // settled payment; a retry re-persists (the nonce blocks any
              // double-charge).
              console.error(`[ucp-routes] settled ${reference} but failed to record settlement on ${id}: ${recResult.error}`)
              return ucpError(
                "settlement_not_recorded",
                `Payment settled on-chain (reference ${reference}) but recording it failed — the order was not created. Retry to reconcile.`,
                422,
                "recoverable",
              )
            }
          }
        }

        // Register the settled payment as a Saleor transaction — unless it is
        // already recorded (retry after a later failure), which would otherwise
        // double the charged amount on the checkout.
        if (reference) {
          const alreadyRecorded = (checkout.transactions ?? []).some((t) => t.pspReference === reference)
          if (!alreadyRecorded) {
            const handler = paymentHandlers.getAdapter(selectedInstrument.handler_id)
            const txResult = await saleorClient.createCheckoutTransaction(id, {
              name: handler?.name ?? selectedInstrument.handler_id,
              pspReference: reference,
              amountCharged: {
                amount: checkout.totalPrice.gross.amount,
                currency: checkout.totalPrice.gross.currency,
              },
            })
            if (!txResult.ok) {
              // Honest reporting (SAC-2): the PAYMENT succeeded; recording the
              // order failed — not payment_failed. Settlement is recorded, so a
              // retry resumes here.
              return ucpError(
                "order_not_recorded_after_settlement",
                `Payment settled (reference ${reference}) but recording the order failed: ${txResult.error}. Retry to complete the order.`,
                422,
                "recoverable",
              )
            }
          }
        }

        // Complete checkout in Saleor
        const orderResult = await saleorClient.completeCheckout(id)
        if (!orderResult.ok) {
          // Honest reporting (SAC-2): if a settlement exists, the payment
          // succeeded and only order placement failed (e.g. stock/voucher at
          // commit) — say so, and let a retry resume without re-charging.
          if (reference) {
            return ucpError(
              "order_not_completed_after_settlement",
              `Payment settled (reference ${reference}) but completing the order failed: ${orderResult.error}. Retry to complete the order.`,
              422,
              "recoverable",
            )
          }
          return ucpSaleorError("checkout_complete_failed", 422, orderResult)
        }

        // Return checkout session with completed status and order confirmation
        const orderConfirmation = {
          id: orderResult.data.id,
          label: orderResult.data.number ?? undefined,
          permalink_url: `${config.storefrontUrl}/orders/${orderResult.data.id}`,
        }

        const response = formatUcpCompleteResponse(formatterContext, checkout, orderConfirmation)
        return Response.json(response)
      },
    },

    // =====================================================
    // Cancel Checkout Session
    // =====================================================
    checkoutSessionCancel: {
      async POST(_request: Request, context: { params: Promise<{ id: string }> }) {
        const blocked = checkUcpEnabled()
        if (blocked) return blocked

        const { id } = await context.params

        // Verify checkout exists
        const result = await saleorClient.getCheckout(id)
        if (!result.ok) return ucpError("checkout_not_found", result.error, 404)

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
          { key: "ucp_canceled", value: "true" },
          { key: "ucp_canceled_at", value: new Date().toISOString() },
        ])
        if (!persistResult.ok) {
          return ucpError("cancel_persist_failed", persistResult.error, 422)
        }

        // Return full checkout session with canceled status
        const session = formatUcpCheckoutSession(formatterContext, result.data)
        return Response.json({
          ...session,
          status: "canceled",
        })
      },
    },

    // =====================================================
    // Get Order
    // =====================================================
    order: {
      async GET(request: Request, context: { params: Promise<{ id: string }> }) {
        const blocked = checkUcpEnabled()
        if (blocked) return blocked

        const { id } = await context.params
        const result = await saleorClient.getOrder(id)
        if (!result.ok) return ucpError("order_not_found", result.error, 404)

        const order = formatUcpOrder(formatterContext, result.data)
        return Response.json(order)
      },
    },

    // =====================================================
    // Catalog Search — POST /api/ucp/catalog/search
    // =====================================================
    catalogSearch: {
      async POST(request: Request) {
        const blocked = checkUcpEnabled()
        if (blocked) return blocked

        let body: any
        try {
          body = await request.json()
        } catch {
          return ucpError("invalid_body", "Request body must be valid JSON", 400)
        }

        const query: string = body.query ?? ""
        const limit: number = Math.min(body.pagination?.limit ?? 20, 100)

        // Saleor pagination is cursor-based. Callers page by passing
        // pagination.cursor from the previous response's pagination.cursor
        // (offset is not supported — see U-4).
        const cursor: string | null = body.pagination?.cursor ?? null

        const result = await saleorClient.searchProducts({
          query,
          limit,
          cursor,
        })

        if (!result.ok) return ucpError("catalog_search_failed", result.error, 422)

        const response = formatUcpCatalogSearch(config.ucpVersion, result.data)
        return Response.json(response)
      },
    },

    // =====================================================
    // Catalog Lookup — POST /api/ucp/catalog/lookup
    // =====================================================
    catalogLookup: {
      async POST(request: Request) {
        const blocked = checkUcpEnabled()
        if (blocked) return blocked

        let body: any
        try {
          body = await request.json()
        } catch {
          return ucpError("invalid_body", "Request body must be valid JSON", 400)
        }

        const ids: string[] = Array.isArray(body.ids) ? body.ids : []
        if (ids.length === 0) {
          return ucpError("missing_ids", "ids array is required and must not be empty", 400)
        }

        const result = await saleorClient.lookupProductsAndVariants({ ids })
        if (!result.ok) return ucpError("catalog_lookup_failed", result.error, 422)

        const response = formatUcpCatalogLookup(config.ucpVersion, result.data)
        return Response.json(response)
      },
    },
  }
}
