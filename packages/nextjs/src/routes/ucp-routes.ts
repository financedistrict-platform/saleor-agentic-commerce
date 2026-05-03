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
  formatUcpError,
  ucpToSaleorAddress,
  metadataToRecord,
  recordToMetadataInput,
} from "@financedistrict/saleor-agentic-commerce-core"
import type { AgenticCommerceInstance } from "../config.js"

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
}

export function createUcpRoutes(instance: AgenticCommerceInstance): UcpRouteHandlers {
  const { saleorClient, paymentHandlers, formatterContext, config } = instance

  function ucpError(code: string, content: string, status: number): Response {
    return Response.json(formatUcpError({ ucpVersion: config.ucpVersion, code, content }), { status })
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
      await saleorClient.updatePrivateMetadata(checkoutId, metadataUpdates)
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
        let body: any
        try {
          body = await request.json()
        } catch {
          return ucpError("invalid_body", "Request body must be valid JSON", 400)
        }

        const lineItems = body.line_items
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
          return ucpError("missing_line_items", "line_items array is required", 400)
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

        // Create Saleor checkout
        const checkoutResult = await saleorClient.createCheckout({
          lines,
          email,
          shippingAddress,
        })

        if (!checkoutResult.ok) {
          return ucpError("checkout_create_failed", checkoutResult.error, 422)
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
        const { id } = await context.params
        const result = await saleorClient.getCheckout(id)
        if (!result.ok) return ucpError("checkout_not_found", result.error, 404)

        const session = formatUcpCheckoutSession(formatterContext, result.data)
        return Response.json(session)
      },

      async PUT(request: Request, context: { params: Promise<{ id: string }> }) {
        const { id } = await context.params
        let body: any
        try {
          body = await request.json()
        } catch {
          return ucpError("invalid_body", "Request body must be valid JSON", 400)
        }

        // Update buyer email
        if (body.buyer?.email) {
          const result = await saleorClient.updateCheckoutEmail(id, body.buyer.email)
          if (!result.ok) return ucpError("email_update_failed", result.error, 422)
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
              if (!result.ok) return ucpError("shipping_address_update_failed", result.error, 422)
            }

            // Update delivery method from selected option
            const selectedOptionId = method.groups?.[0]?.selected_option_id
            if (selectedOptionId) {
              const result = await saleorClient.updateCheckoutDeliveryMethod(id, selectedOptionId)
              if (!result.ok) return ucpError("delivery_method_update_failed", result.error, 422)
            }
          }
        }

        // Update line items if provided
        if (body.line_items && Array.isArray(body.line_items)) {
          const lines = body.line_items.map((item: any) => ({
            variantId: item.item?.id || item.id,
            quantity: item.quantity || 1,
          }))
          const result = await saleorClient.updateCheckoutLines(id, lines)
          if (!result.ok) return ucpError("items_update_failed", result.error, 422)
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
          return ucpError("missing_payment", "payment.instruments array is required", 400)
        }

        const selectedInstrument = payment.instruments.find((i: any) => i.selected) || payment.instruments[0]
        if (!selectedInstrument) {
          return ucpError("no_instrument_selected", "At least one payment instrument must be provided", 400)
        }

        // Fetch checkout for metadata
        const checkoutResult = await saleorClient.getCheckout(id)
        if (!checkoutResult.ok) return ucpError("checkout_not_found", checkoutResult.error, 404)

        const checkout = checkoutResult.data
        const metadata = metadataToRecord(checkout.privateMetadata)

        // Update billing address if provided on instrument
        if (selectedInstrument.billing_address) {
          const addr = ucpToSaleorAddress(selectedInstrument.billing_address)
          await saleorClient.updateCheckoutBillingAddress(id, addr)
        }

        // Settle payment via the appropriate handler
        const settleResult = await paymentHandlers.settlePayment({
          checkoutId: id,
          handlerId: selectedInstrument.handler_id,
          credential: selectedInstrument.credential,
          checkoutMetadata: metadata,
        })

        if (!settleResult.success) {
          return ucpError("payment_failed", settleResult.error || "Payment settlement failed", 422)
        }

        // Complete checkout in Saleor
        const orderResult = await saleorClient.completeCheckout(id)
        if (!orderResult.ok) return ucpError("checkout_complete_failed", orderResult.error, 422)

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
        const { id } = await context.params

        // Verify checkout exists
        const result = await saleorClient.getCheckout(id)
        if (!result.ok) return ucpError("checkout_not_found", result.error, 404)

        // Mark as canceled via metadata
        await saleorClient.updatePrivateMetadata(id, [
          { key: "ucp_canceled", value: "true" },
          { key: "ucp_canceled_at", value: new Date().toISOString() },
        ])

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
        const { id } = await context.params
        const result = await saleorClient.getOrder(id)
        if (!result.ok) return ucpError("order_not_found", result.error, 404)

        const order = formatUcpOrder(formatterContext, result.data)
        return Response.json(order)
      },
    },
  }
}
