/**
 * ACP Protocol Formatter
 *
 * Transforms Saleor internal objects into ACP-compliant response shapes.
 * Spec: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/spec/2026-01-30
 */

import type { SaleorCheckout, SaleorOrder } from "../../types/saleor.js"
import type {
  AcpCheckoutSession,
  AcpCompleteResponse,
  AcpLineItem,
  AcpTotal,
  AcpFulfillmentOptionShipping,
  AcpBuyer,
  AcpLink,
  AcpOrder,
  AcpFulfillmentDetails,
  AcpSelectedFulfillmentOption,
  AcpCapabilities,
} from "../../types/acp.js"
import { saleorToAcpAddress } from "../address-translator.js"
import { resolveAcpCheckoutStatus } from "../status-maps.js"
import { metadataToRecord } from "../metadata.js"
import type { FormatterContext } from "./types.js"
import { toMinor } from "./types.js"

// =====================================================
// Checkout Session
// =====================================================

export function formatAcpCheckoutSession(
  ctx: FormatterContext,
  checkout: SaleorCheckout,
): AcpCheckoutSession {
  const currency = checkout.totalPrice.gross.currency.toLowerCase()
  const status = resolveAcpCheckoutStatus(checkout)
  const metadata = metadataToRecord(checkout.privateMetadata)

  const lineItems = formatLineItems(checkout)
  const totals = formatTotals(checkout)
  const fulfillmentOptions = formatFulfillmentOptions(checkout)
  const capabilities = formatCapabilities(ctx, metadata)

  // Build buyer from checkout email
  const buyer: AcpBuyer | undefined = checkout.email
    ? { email: checkout.email }
    : undefined

  // Fulfillment details from shipping address
  const fulfillmentDetails: AcpFulfillmentDetails | undefined =
    checkout.shippingAddress
      ? {
          address: saleorToAcpAddress(checkout.shippingAddress),
          ...(checkout.shippingAddress.phone
            ? { phone_number: checkout.shippingAddress.phone }
            : {}),
        }
      : undefined

  // Selected fulfillment options
  const selectedFulfillmentOptions: AcpSelectedFulfillmentOption[] | undefined =
    checkout.deliveryMethod
      ? [{
          type: "shipping" as const,
          option_id: checkout.deliveryMethod.id,
          item_ids: checkout.lines.map((l) => l.id),
        }]
      : undefined

  // Links
  const links: AcpLink[] = [
    { type: "terms_of_use", url: `${ctx.storefrontUrl}/terms` },
    { type: "privacy_policy", url: `${ctx.storefrontUrl}/privacy` },
  ]

  const session: AcpCheckoutSession = {
    id: checkout.id,
    status,
    currency,
    line_items: lineItems,
    totals,
    fulfillment_options: fulfillmentOptions,
    messages: [],
    links,
    capabilities,
    ...(buyer ? { buyer } : {}),
    ...(fulfillmentDetails ? { fulfillment_details: fulfillmentDetails } : {}),
    ...(selectedFulfillmentOptions ? { selected_fulfillment_options: selectedFulfillmentOptions } : {}),
    continue_url: `${ctx.storefrontUrl}/checkout/${checkout.id}`,
  }

  return session
}

// =====================================================
// Complete Response
// =====================================================

export function formatAcpCompleteResponse(
  ctx: FormatterContext,
  checkout: SaleorCheckout,
  order: SaleorOrder,
): AcpCompleteResponse {
  const session = formatAcpCheckoutSession(ctx, checkout)

  const acpOrder: AcpOrder = {
    id: order.id,
    checkout_session_id: checkout.id,
    permalink_url: `${ctx.storefrontUrl}/orders/${order.id}`,
    ...(order.number ? { order_number: order.number } : {}),
    status: "confirmed",
  }

  return {
    ...session,
    status: "completed",
    order: acpOrder,
  }
}

// =====================================================
// Capabilities
// =====================================================

function formatCapabilities(
  ctx: FormatterContext,
  metadata: Record<string, unknown>,
): AcpCapabilities {
  const handlers = ctx.paymentHandlers.getAcpCheckoutHandlers(metadata)

  return {
    payment: {
      handlers: handlers as any[],
    },
  }
}

// =====================================================
// Line Items
// =====================================================

function formatLineItems(checkout: SaleorCheckout): AcpLineItem[] {
  return checkout.lines.map((line) => {
    const unitAmount = toMinor(line.unitPrice.gross.amount)
    const total = toMinor(line.totalPrice.gross.amount)
    const tax = toMinor(line.totalPrice.tax.amount)
    const subtotal = total - tax
    const baseAmount = unitAmount * line.quantity
    const discount = baseAmount - subtotal

    return {
      id: line.id,
      item: {
        id: line.variant.id,
        name: `${line.variant.product.name} - ${line.variant.name}`,
        unit_amount: unitAmount,
      },
      quantity: line.quantity,
      totals: [
        { type: "subtotal" as const, display_text: "Subtotal", amount: subtotal },
        ...(tax > 0 ? [{ type: "tax" as const, display_text: "Tax", amount: tax }] : []),
        ...(discount > 0 ? [{ type: "discount" as const, display_text: "Discount", amount: -discount }] : []),
        { type: "total" as const, display_text: "Total", amount: total },
      ],
      unit_amount: unitAmount,
      ...(line.variant.product.thumbnail?.url
        ? { images: [line.variant.product.thumbnail.url] }
        : {}),
    }
  })
}

// =====================================================
// Totals
// =====================================================

function formatTotals(checkout: SaleorCheckout): AcpTotal[] {
  const subtotal = toMinor(checkout.subtotalPrice.gross.amount)
  const tax = toMinor(checkout.totalPrice.tax.amount)
  const shipping = toMinor(checkout.shippingPrice.gross.amount)
  const discount = toMinor(checkout.discount?.amount ?? 0)
  const total = toMinor(checkout.totalPrice.gross.amount)

  const totals: AcpTotal[] = [
    { type: "items_base_amount", display_text: "Items", amount: subtotal + discount },
  ]

  if (discount > 0) {
    totals.push({ type: "items_discount", display_text: "Discount", amount: -discount })
  }

  totals.push({ type: "subtotal", display_text: "Subtotal", amount: subtotal })

  if (shipping > 0) {
    totals.push({ type: "fulfillment", display_text: "Shipping", amount: shipping })
  }

  if (tax > 0) {
    totals.push({ type: "tax", display_text: "Tax", amount: tax })
  }

  totals.push({ type: "total", display_text: "Total", amount: total })

  return totals
}

// =====================================================
// Fulfillment Options
// =====================================================

function formatFulfillmentOptions(
  checkout: SaleorCheckout,
): AcpFulfillmentOptionShipping[] {
  return checkout.shippingMethods.map((sm) => {
    const total = toMinor(sm.price.amount)

    return {
      type: "shipping" as const,
      id: sm.id,
      title: sm.name,
      ...(sm.minimumDeliveryDays != null
        ? { earliest_delivery_time: deliveryDaysToIso(sm.minimumDeliveryDays) }
        : {}),
      ...(sm.maximumDeliveryDays != null
        ? { latest_delivery_time: deliveryDaysToIso(sm.maximumDeliveryDays) }
        : {}),
      totals: [
        { type: "fulfillment" as const, display_text: "Shipping", amount: total },
        { type: "total" as const, display_text: "Total", amount: total },
      ],
    }
  })
}

// =====================================================
// Helpers
// =====================================================

function deliveryDaysToIso(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}
