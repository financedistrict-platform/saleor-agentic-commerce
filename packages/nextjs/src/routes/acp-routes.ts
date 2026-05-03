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
} from "@financedistrict/saleor-agentic-commerce-core"
import type { AgenticCommerceInstance } from "../config.js"

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
      await saleorClient.updatePrivateMetadata(checkoutId, metadataUpdates)
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
        const billingAddress = body.billing_address
          ? acpToSaleorAddress(body.billing_address)
          : undefined

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
        if (!validateApiKey(request)) {
          return acpError("unauthorized", "Invalid or missing API key", 401)
        }

        const { id } = await context.params
        const result = await saleorClient.getCheckout(id)
        if (!result.ok) return acpError("not_found", result.error, 404)

        const session = formatAcpCheckoutSession(formatterContext, result.data)
        return Response.json(session)
      },

      // ACP spec: Update uses POST (not PUT)
      async POST(request: Request, context: { params: Promise<{ id: string }> }) {
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

        // Update billing address if provided
        if (paymentData.billing_address) {
          const addr = acpToSaleorAddress(paymentData.billing_address)
          await saleorClient.updateCheckoutBillingAddress(id, addr)
        }

        // Fetch checkout for metadata
        const checkoutResult = await saleorClient.getCheckout(id)
        if (!checkoutResult.ok) return acpError("not_found", checkoutResult.error, 404)

        const checkout = checkoutResult.data
        const metadata = metadataToRecord(checkout.privateMetadata)

        // Determine the payment handler to use
        const handlerId = paymentData.handler_id || "xyz.fd.prism_payment"

        // Extract credential from instrument
        const credential = paymentData.instrument?.credential || paymentData.credential

        // Settle payment via the appropriate handler
        const settleResult = await paymentHandlers.settlePayment({
          checkoutId: id,
          handlerId,
          credential,
          checkoutMetadata: metadata,
        })

        if (!settleResult.success) {
          return acpError("payment_declined", settleResult.error || "Payment settlement failed", 422)
        }

        // Complete checkout in Saleor
        const orderResult = await saleorClient.completeCheckout(id)
        if (!orderResult.ok) return acpError("processing_error", orderResult.error, 422)

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
        if (!validateApiKey(request)) {
          return acpError("unauthorized", "Invalid or missing API key", 401)
        }

        const { id } = await context.params

        // Verify checkout exists
        const result = await saleorClient.getCheckout(id)
        if (!result.ok) return acpError("not_found", result.error, 404)

        // Mark as canceled via metadata
        await saleorClient.updatePrivateMetadata(id, [
          { key: "acp_canceled", value: "true" },
          { key: "acp_canceled_at", value: new Date().toISOString() },
        ])

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
