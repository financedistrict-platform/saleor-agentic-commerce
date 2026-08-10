/**
 * UCP Protocol Formatter
 *
 * Transforms Saleor internal objects into UCP-compliant response shapes.
 * Spec: https://ucp.dev/2026-04-08/specification/overview
 */

import type { SaleorCheckout, SaleorOrder, SaleorCheckoutLine, SaleorOrderLine, SaleorProduct, SaleorProductVariant, SaleorProductConnection, SaleorLookupVariant } from "../../types/saleor.js"
import type {
  UcpCheckoutSession,
  UcpOrder,
  UcpProfile,
  UcpEnvelope,
  UcpBuyer,
  UcpTotal,
  UcpFulfillment,
  UcpLineItem,
  UcpOrderLineItem,
  UcpOrderFulfillment,
  UcpFulfillmentExpectation,
  UcpFulfillmentEvent,
  UcpOrderConfirmation,
  UcpCatalogProduct,
  UcpCatalogSearchResponse,
  UcpCatalogLookupResponse,
  UcpDescription,
  UcpInputCorrelation,
  UcpLookupProduct,
  UcpLookupVariant,
  UcpCatalogProductVariant,
  UcpCheckoutStatus,
  UcpMessage,
} from "../../types/ucp.js"
import { saleorToUcpAddress } from "../address-translator.js"
import { resolveUcpCheckoutStatus } from "../status-maps.js"
import { metadataToRecord } from "../metadata.js"
import type { FormatterContext } from "./types.js"
import { toMinor } from "./types.js"

// =====================================================
// UCP Profile (Discovery)
// =====================================================

export async function formatUcpProfile(
  ctx: FormatterContext,
  endpointBaseUrl: string,
): Promise<UcpProfile> {
  const paymentHandlers = await ctx.paymentHandlers.getUcpDiscoveryHandlers()

  const v = ctx.ucpVersion
  return {
    ucp: {
      version: v,
      services: {
        "dev.ucp.shopping": [
          {
            version: v,
            spec: `https://ucp.dev/${v}/specification/overview`,
            schema: `https://ucp.dev/${v}/services/shopping/rest.openapi.json`,
            transport: "rest" as const,
            endpoint: endpointBaseUrl,
          },
        ],
      },
      capabilities: {
        "dev.ucp.shopping.checkout": [{ version: v, spec: `https://ucp.dev/${v}/specification/checkout/`, schema: `https://ucp.dev/${v}/schemas/shopping/checkout.json` }],
        "dev.ucp.shopping.order": [{ version: v, spec: `https://ucp.dev/${v}/specification/order/`, schema: `https://ucp.dev/${v}/schemas/shopping/order.json` }],
        "dev.ucp.shopping.catalog.search": [{ version: v, spec: `https://ucp.dev/${v}/specification/catalog/`, schema: `https://ucp.dev/${v}/schemas/shopping/catalog_search.json` }],
        "dev.ucp.shopping.catalog.lookup": [{ version: v, spec: `https://ucp.dev/${v}/specification/catalog/`, schema: `https://ucp.dev/${v}/schemas/shopping/catalog_lookup.json` }],
      },
      payment_handlers: paymentHandlers,
    },
    signing_keys: [],
  }
}

// =====================================================
// UCP Envelope
// =====================================================

function ucpEnvelope(
  ctx: FormatterContext,
  includePayment: boolean,
  checkoutMetadata?: Record<string, unknown>,
): UcpEnvelope {
  const envelope: UcpEnvelope = {
    version: ctx.ucpVersion,
    capabilities: {
      "dev.ucp.shopping.checkout": [{ version: ctx.ucpVersion }],
      "dev.ucp.shopping.order": [{ version: ctx.ucpVersion }],
    },
  }
  if (includePayment) {
    // Checkout responses require payment_handlers per spec
    const handlers = ctx.paymentHandlers.getUcpCheckoutHandlers(checkoutMetadata)
    envelope.payment_handlers = handlers
  }
  return envelope
}

// =====================================================
// Checkout Session
// =====================================================

export function formatUcpCheckoutSession(
  ctx: FormatterContext,
  checkout: SaleorCheckout,
  // When omitted, status falls back to the presence-based resolver.
  readiness?: { status: UcpCheckoutStatus; messages?: UcpMessage[] },
): UcpCheckoutSession {
  const currency = checkout.totalPrice.gross.currency.toLowerCase()
  const status = readiness?.status ?? resolveUcpCheckoutStatus(checkout)
  const messages = readiness?.messages ?? []
  const metadata = metadataToRecord(checkout.privateMetadata)

  const lineItems = formatCheckoutLineItems(checkout.lines, currency)
  const totals = formatCheckoutTotals(checkout)
  const fulfillment = formatCheckoutFulfillment(checkout, lineItems)
  const buyer = formatBuyer(checkout)

  const session: UcpCheckoutSession = {
    ucp: ucpEnvelope(ctx, true, metadata),
    id: checkout.id,
    status,
    currency,
    ...(buyer ? { buyer } : {}),
    line_items: lineItems,
    totals,
    ...(fulfillment ? { fulfillment } : {}),
    ...(messages.length > 0 ? { messages } : {}),
    links: [
      { type: "terms_of_service", url: `${ctx.storefrontUrl}/terms` },
      { type: "privacy_policy", url: `${ctx.storefrontUrl}/privacy` },
    ],
    continue_url: `${ctx.storefrontUrl}/checkout/${checkout.id}`,
  }

  return session
}

// =====================================================
// Complete Response (checkout session with order)
// =====================================================

export function formatUcpCompleteResponse(
  ctx: FormatterContext,
  checkout: SaleorCheckout,
  order: UcpOrderConfirmation,
): UcpCheckoutSession {
  const session = formatUcpCheckoutSession(ctx, checkout)
  return {
    ...session,
    status: "completed",
    order,
  }
}

// =====================================================
// Order (full object for GET /orders/{id})
// =====================================================

export function formatUcpOrder(
  ctx: FormatterContext,
  order: SaleorOrder,
): UcpOrder {
  const currency = order.total.gross.currency.toLowerCase()

  const totals: UcpTotal[] = [
    { type: "subtotal", amount: toMinor(order.subtotal.gross.amount) },
    { type: "fulfillment", amount: toMinor(order.shippingPrice.gross.amount) },
  ]

  const tax = toMinor(order.total.tax.amount)
  if (tax > 0) {
    totals.push({ type: "tax", amount: tax })
  }

  const discount = toMinor(order.discount?.amount ?? 0)
  if (discount > 0) {
    totals.push({ type: "discount", amount: -discount })
  }

  totals.push({ type: "total", amount: toMinor(order.total.gross.amount) })

  const fulfilledByLine = fulfilledQtyByLine(order)
  const lineItems = formatOrderLineItems(order.lines, fulfilledByLine)
  const fulfillment = formatOrderFulfillment(order, lineItems)

  return {
    ucp: ucpEnvelope(ctx, false),
    id: order.id,
    label: order.number ?? undefined,
    // The checkout that produced this order (Saleor Order.checkoutId), so an
    // agent can correlate the order back to its UCP checkout session. Falls
    // back to the order id only for orders not created from a checkout (SAC-6).
    checkout_id: order.checkoutId ?? order.id,
    permalink_url: `${ctx.storefrontUrl}/orders/${order.id}`,
    currency,
    line_items: lineItems,
    fulfillment,
    totals,
  }
}

// =====================================================
// Buyer
// =====================================================

function formatBuyer(checkout: SaleorCheckout): UcpBuyer | undefined {
  if (!checkout.email) return undefined
  return { email: checkout.email }
}

// =====================================================
// Checkout Totals
// =====================================================

function formatCheckoutTotals(checkout: SaleorCheckout): UcpTotal[] {
  const totals: UcpTotal[] = [
    { type: "subtotal", amount: toMinor(checkout.subtotalPrice.gross.amount) },
  ]

  const discount = toMinor(checkout.discount?.amount ?? 0)
  if (discount > 0) {
    totals.push({ type: "discount", amount: -discount })
  }

  const shipping = toMinor(checkout.shippingPrice.gross.amount)
  if (shipping > 0) {
    totals.push({ type: "fulfillment", amount: shipping })
  }

  const tax = toMinor(checkout.totalPrice.tax.amount)
  if (tax > 0) {
    totals.push({ type: "tax", amount: tax })
  }

  totals.push({ type: "total", amount: toMinor(checkout.totalPrice.gross.amount) })

  return totals
}

// =====================================================
// Checkout Line Items
// =====================================================

function formatCheckoutLineItems(lines: SaleorCheckoutLine[], currency: string): UcpLineItem[] {
  return lines.map((line) => ({
    id: line.id,
    item: {
      id: line.variant.id,
      title: `${line.variant.product.name} - ${line.variant.name}`,
      price: toMinor(line.unitPrice.gross.amount),
      ...(line.variant.product.thumbnail?.url
        ? { image_url: line.variant.product.thumbnail.url }
        : {}),
    },
    quantity: line.quantity,
    totals: [
      { type: "total" as const, amount: toMinor(line.totalPrice.gross.amount) },
    ],
  }))
}

// =====================================================
// Checkout Fulfillment
// =====================================================

function formatCheckoutFulfillment(
  checkout: SaleorCheckout,
  lineItems: UcpLineItem[],
): UcpFulfillment | undefined {
  // Only include fulfillment if there's a shipping address or shipping methods
  if (!checkout.shippingAddress && checkout.shippingMethods.length === 0) {
    return undefined
  }

  const lineItemIds = lineItems.map((li) => li.id)

  const destinations = checkout.shippingAddress
    ? [{
        id: "dest_shipping",
        ...saleorToUcpAddress(checkout.shippingAddress),
      }]
    : undefined

  const options = checkout.shippingMethods.map((sm) => {
    const total = toMinor(sm.price.amount)
    return {
      id: sm.id,
      title: sm.name,
      ...(sm.minimumDeliveryDays != null
        ? { earliest_fulfillment_time: deliveryDaysToIso(sm.minimumDeliveryDays) }
        : {}),
      ...(sm.maximumDeliveryDays != null
        ? { latest_fulfillment_time: deliveryDaysToIso(sm.maximumDeliveryDays) }
        : {}),
      totals: [{ type: "total" as const, amount: total }],
    }
  })

  return {
    methods: [{
      id: "method_shipping",
      type: "shipping",
      line_item_ids: lineItemIds,
      ...(checkout.shippingAddress ? { selected_destination_id: "dest_shipping" } : {}),
      ...(destinations ? { destinations } : {}),
      groups: [{
        id: "group_default",
        line_item_ids: lineItemIds,
        ...(checkout.deliveryMethod ? { selected_option_id: checkout.deliveryMethod.id } : {}),
        options,
      }],
    }],
  }
}

// =====================================================
// Order Line Items
// =====================================================

function formatOrderLineItems(
  lines: SaleorOrderLine[],
  fulfilledByLine: Map<string, number>,
): UcpOrderLineItem[] {
  return lines.map((line) => {
    const total = line.quantity
    const fulfilled = Math.min(fulfilledByLine.get(line.id) ?? 0, total)
    return {
      id: line.id,
      item: {
        id: line.variant?.id || line.id,
        title: `${line.productName} - ${line.variantName}`,
        price: toMinor(line.unitPrice.gross.amount),
        ...(line.thumbnail?.url || line.variant?.product.thumbnail?.url
          ? { image_url: line.thumbnail?.url || line.variant?.product.thumbnail?.url }
          : {}),
      },
      quantity: {
        original: line.quantity,
        total,
        fulfilled,
      },
      totals: [
        { type: "total" as const, amount: toMinor(line.totalPrice.gross.amount) },
      ],
      status: deriveOrderLineStatus(total, fulfilled),
    }
  })
}

// order.md → Status Derivation (order_line_item.json `status` is required).
function deriveOrderLineStatus(
  total: number,
  fulfilled: number,
): "processing" | "partial" | "fulfilled" | "removed" {
  if (total === 0) return "removed"
  if (fulfilled >= total) return "fulfilled"
  if (fulfilled > 0) return "partial"
  return "processing"
}

// Sum fulfilled quantity per order line, ignoring fulfillments that don't
// represent delivered goods (cancelled / returned / replaced).
function fulfilledQtyByLine(order: SaleorOrder): Map<string, number> {
  const map = new Map<string, number>()
  for (const f of order.fulfillments ?? []) {
    if (f.status === "CANCELED" || f.status === "RETURNED" || f.status === "REPLACED") continue
    for (const fl of f.lines ?? []) {
      const id = fl.orderLine?.id
      if (!id) continue
      map.set(id, (map.get(id) ?? 0) + fl.quantity)
    }
  }
  return map
}

// =====================================================
// Order Fulfillment
// =====================================================

function formatOrderFulfillment(
  order: SaleorOrder,
  lineItems: UcpOrderLineItem[],
): UcpOrderFulfillment {
  const expectations: UcpFulfillmentExpectation[] = []

  if (order.shippingAddress) {
    expectations.push({
      id: "exp_shipping",
      line_items: lineItems.map((li) => ({ id: li.id, quantity: li.quantity.total })),
      method_type: "shipping",
      destination: saleorToUcpAddress(order.shippingAddress),
    })
  }

  // Map each Saleor fulfillment to a UCP fulfillment event. fulfillment_event
  // `type` is an open string, so Saleor's own status names pass through (SAC-7).
  const events: UcpFulfillmentEvent[] = (order.fulfillments ?? []).map((f) => ({
    id: f.id,
    occurred_at: f.created,
    type: f.status,
    line_items: (f.lines ?? [])
      .filter((fl) => fl.orderLine != null)
      .map((fl) => ({ id: fl.orderLine!.id, quantity: fl.quantity })),
    ...(f.trackingNumber ? { tracking_number: f.trackingNumber } : {}),
  }))

  return {
    expectations,
    events,
  }
}

// =====================================================
// Helpers
// =====================================================

function deliveryDaysToIso(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

// =====================================================
// Catalog
// =====================================================

export function formatUcpCatalogSearch(
  ucpVersion: string,
  connection: SaleorProductConnection,
): UcpCatalogSearchResponse {
  const products = connection.edges.map((e) => formatCatalogProduct(e.node))
  const hasNextPage = connection.pageInfo.hasNextPage
  return {
    ucp: { version: ucpVersion, status: "success" },
    products,
    pagination: {
      has_next_page: hasNextPage,
      // pagination.json: cursor MUST be present when has_next_page is true
      ...(hasNextPage && connection.pageInfo.endCursor
        ? { cursor: connection.pageInfo.endCursor }
        : {}),
      // Real total from Saleor's connection when selected — replaces the old
      // `products.length + offset` fabrication (U-4).
      ...(connection.totalCount != null ? { total_count: connection.totalCount } : {}),
    },
  }
}

/**
 * Format a catalog lookup. Per catalog_lookup.json / lookup.md, a lookup
 * response contains only *resolved* variants, each carrying an `inputs[]`
 * correlation back to the request id(s) that matched it:
 *   - a product GID resolves to the product's single featured variant
 *     (`match: "featured"`);
 *   - a variant GID resolves to that exact variant (`match: "exact"`).
 * Products are deduped (returned once); variants are deduped, and a variant hit
 * by both its product GID and its own variant GID carries both inputs.
 */
export function formatUcpCatalogLookup(
  ucpVersion: string,
  input: { products: SaleorProduct[]; variants: SaleorLookupVariant[] },
): UcpCatalogLookupResponse {
  type Acc = {
    product: SaleorProduct
    variants: Map<string, { node: SaleorProductVariant; inputs: UcpInputCorrelation[] }>
  }
  const byProduct = new Map<string, Acc>()

  const ensure = (product: SaleorProduct): Acc => {
    let acc = byProduct.get(product.id)
    if (!acc) {
      acc = { product, variants: new Map() }
      byProduct.set(product.id, acc)
    }
    return acc
  }

  const addVariant = (acc: Acc, node: SaleorProductVariant, correlation: UcpInputCorrelation): void => {
    const existing = acc.variants.get(node.id)
    if (existing) {
      existing.inputs.push(correlation)
      return
    }
    acc.variants.set(node.id, { node, inputs: [correlation] })
  }

  // Product-ID matches → the product's featured (first) variant only.
  for (const product of input.products) {
    const featured = product.variants[0]
    if (!featured) continue // lookup_variant requires a variant; skip variant-less products
    addVariant(ensure(product), featured, { id: product.id, match: "featured" })
  }

  // Variant-ID matches → that exact variant, grouped under its parent product.
  for (const v of input.variants) {
    addVariant(
      ensure(v.product),
      { id: v.id, name: v.name, sku: v.sku, pricing: v.pricing },
      { id: v.id, match: "exact" },
    )
  }

  const products: UcpLookupProduct[] = [...byProduct.values()].map(({ product, variants }) => {
    const base = formatCatalogProduct(product)
    const resolved: UcpLookupVariant[] = [...variants.values()].map(({ node, inputs }) => ({
      ...formatCatalogVariant(node, base.description),
      inputs,
    }))
    return { ...base, variants: resolved }
  })

  return {
    ucp: { version: ucpVersion, status: "success" },
    products,
    messages: [],
  }
}

function formatCatalogProduct(product: SaleorProduct): UcpCatalogProduct {
  // Saleor has no per-variant description; variants inherit the product's.
  // variant.json requires `description`, an object per description.json.
  const description = descriptionObject(product.description)

  const variants = product.variants.map((v) => formatCatalogVariant(v, description))

  const variantAmounts = variants
    .map((v) => v.price?.amount)
    .filter((a): a is number => a != null)

  const currency = (
    product.pricing?.priceRange.start.gross.currency
    ?? variants[0]?.price?.currency
    ?? "USD"
  ).toUpperCase()

  const priceRange =
    variantAmounts.length > 0
      ? {
          min: { amount: Math.min(...variantAmounts), currency },
          max: { amount: Math.max(...variantAmounts), currency },
        }
      : null

  const media = product.thumbnail ? [{ url: product.thumbnail.url, type: "image" as const }] : []

  return {
    id: product.id,
    title: product.name,
    description,
    handle: product.slug,
    categories: product.category ? [product.category.name] : [],
    price_range: priceRange,
    variants,
    media,
    thumbnail_url: product.thumbnail?.url ?? null,
  }
}

// Format a single Saleor variant to the UCP variant shape (SAC-8: required
// description object, uppercase ISO-4217 currency, sku omitted when null).
function formatCatalogVariant(
  v: SaleorProductVariant,
  description: UcpDescription,
): UcpCatalogProductVariant {
  return {
    id: v.id,
    title: v.name,
    description,
    ...(v.sku ? { sku: v.sku } : {}),
    price: v.pricing?.price
      ? {
          amount: toMinor(v.pricing.price.gross.amount),
          currency: v.pricing.price.gross.currency.toUpperCase(),
        }
      : null,
  }
}

// A UCP description object (description.json requires at least one of
// plain/html/markdown). Saleor stores rich text as Editorjs JSON — flatten it.
function descriptionObject(raw: string | null): UcpDescription {
  return { plain: stripEditorjsToPlainText(raw) }
}

function stripEditorjsToPlainText(raw: string | null): string {
  if (!raw) return ""
  try {
    const parsed = JSON.parse(raw) as { blocks?: { data?: { text?: string } }[] }
    if (!Array.isArray(parsed.blocks)) return raw
    return parsed.blocks
      .map((b) => b.data?.text ?? "")
      .filter(Boolean)
      .join(" ")
  } catch {
    return raw
  }
}
