/**
 * UCP (Universal Commerce Protocol) Types
 *
 * Based on UCP spec version 2026-04-08
 * https://ucp.dev/2026-04-08/specification/overview
 */

// =====================================================
// Discovery Profile
// =====================================================

export type UcpProfile = {
  ucp: {
    version: string
    services: Record<string, UcpService[]>
    capabilities: Record<string, UcpCapability[]>
    payment_handlers?: Record<string, unknown[]>
    supported_versions?: Record<string, string>
  }
  signing_keys: unknown[]
}

export type UcpService = {
  version: string
  spec: string
  transport: "rest" | "mcp" | "a2a" | "embedded"
  endpoint?: string
  schema?: string
  config?: Record<string, unknown>
  id?: string
}

export type UcpCapability = {
  version: string
  spec?: string
  schema?: string
  extends?: string | string[]
  config?: Record<string, unknown>
  id?: string
}

// =====================================================
// Response Envelope
// =====================================================

export type UcpEnvelope = {
  version: string
  /** Default: "success". Set to "error" for failure scenarios. */
  status?: "success" | "error"
  capabilities?: Record<string, UcpCapability[]>
  payment_handlers?: Record<string, unknown[]>
}

// =====================================================
// Checkout Session
// =====================================================

export type UcpCheckoutSession = {
  ucp: UcpEnvelope
  id: string
  status: UcpCheckoutStatus
  currency: string
  buyer?: UcpBuyer
  line_items: UcpLineItem[]
  totals: UcpTotal[]
  fulfillment?: UcpFulfillment
  payment?: UcpPayment
  messages?: UcpMessage[]
  links: UcpLink[]
  expires_at?: string
  continue_url?: string
  order?: UcpOrderConfirmation
}

export type UcpCheckoutStatus =
  | "incomplete"
  | "requires_escalation"
  | "ready_for_complete"
  | "complete_in_progress"
  | "completed"
  | "canceled"

// =====================================================
// Buyer
// =====================================================

export type UcpBuyer = {
  first_name?: string
  last_name?: string
  email?: string
  phone_number?: string
}

// =====================================================
// Line Items
// =====================================================

export type UcpLineItem = {
  id: string
  item: {
    id: string
    title?: string
    /** Price in minor units (cents) */
    price?: number
    image_url?: string
  }
  quantity: number
  totals?: UcpTotal[]
  parent_id?: string
}

// =====================================================
// Totals
// =====================================================

export type UcpTotal = {
  type: UcpTotalType | string
  display_text?: string
  /** Amount in minor units, signed (negative = subtractive) */
  amount: number
  lines?: UcpTotalLine[]
}

export type UcpTotalType =
  | "subtotal"
  | "discount"
  | "items_discount"
  | "fulfillment"
  | "tax"
  | "fee"
  | "total"

export type UcpTotalLine = {
  display_text: string
  amount: number
}

// =====================================================
// Fulfillment
// =====================================================

export type UcpFulfillment = {
  methods: UcpFulfillmentMethod[]
  available_methods?: UcpFulfillmentAvailableMethod[]
}

export type UcpFulfillmentAvailableMethod = {
  type: "shipping" | "pickup"
  line_item_ids: string[]
  fulfillable_on?: string | null
  description?: string
}

export type UcpFulfillmentMethod = {
  id: string
  type: "shipping" | "pickup"
  line_item_ids: string[]
  selected_destination_id?: string | null
  destinations?: UcpFulfillmentDestination[]
  groups?: UcpFulfillmentGroup[]
}

export type UcpFulfillmentDestination = UcpAddress & {
  id: string
}

export type UcpFulfillmentGroup = {
  id: string
  line_item_ids: string[]
  selected_option_id?: string | null
  options?: UcpFulfillmentOption[]
}

export type UcpFulfillmentOption = {
  id: string
  title: string
  description?: string
  carrier?: string
  earliest_fulfillment_time?: string
  latest_fulfillment_time?: string
  totals: UcpTotal[]
}

// =====================================================
// Address
// =====================================================

export type UcpAddress = {
  first_name?: string
  last_name?: string
  street_address?: string
  extended_address?: string
  address_locality?: string
  address_region?: string
  postal_code?: string
  address_country?: string
  phone_number?: string
}

// =====================================================
// Payment
// =====================================================

export type UcpPaymentCredential = {
  type: string
  [key: string]: unknown
}

export type UcpPayment = {
  instruments: UcpPaymentInstrument[]
}

export type UcpPaymentInstrument = {
  id: string
  handler_id: string
  type: string
  selected?: boolean
  display?: Record<string, unknown>
  billing_address?: UcpAddress
  credential?: UcpPaymentCredential
}

// =====================================================
// Messages
// =====================================================

export type UcpMessage = UcpErrorMessage | UcpWarningMessage | UcpInfoMessage

export type UcpErrorMessage = {
  type: "error"
  code: string
  path?: string
  content_type?: "plain" | "markdown"
  content: string
  severity: UcpErrorSeverity
}

export type UcpErrorSeverity =
  | "recoverable"
  | "requires_buyer_input"
  | "requires_buyer_review"
  | "unrecoverable"

export type UcpWarningMessage = {
  type: "warning"
  code: string
  path?: string
  content: string
  content_type?: "plain" | "markdown"
  presentation?: "notice" | "disclosure"
  image_url?: string
  url?: string
}

export type UcpInfoMessage = {
  type: "info"
  path?: string
  code?: string
  content_type?: "plain" | "markdown"
  content: string
}

// =====================================================
// Links
// =====================================================

export type UcpLink = {
  type: string
  url: string
}

// =====================================================
// Order Confirmation (in checkout complete response)
// =====================================================

export type UcpOrderConfirmation = {
  id: string
  label?: string
  permalink_url: string
}

// =====================================================
// Order (full object from GET /orders/{id})
// =====================================================

export type UcpOrder = {
  ucp: UcpEnvelope
  id: string
  label?: string
  checkout_id: string
  permalink_url: string
  currency: string
  line_items: UcpOrderLineItem[]
  fulfillment: UcpOrderFulfillment
  adjustments?: UcpAdjustment[]
  totals: UcpTotal[]
  messages?: UcpMessage[]
}

export type UcpOrderLineItem = {
  id: string
  item: {
    id: string
    title?: string
    price?: number
    image_url?: string
  }
  quantity: {
    original: number
    total: number
    fulfilled: number
  }
  totals: UcpTotal[]
  status: "processing" | "partial" | "fulfilled" | "removed"
  parent_id?: string
}

export type UcpOrderFulfillment = {
  expectations: UcpFulfillmentExpectation[]
  events: UcpFulfillmentEvent[]
}

export type UcpFulfillmentExpectation = {
  id: string
  line_items: { id: string; quantity: number }[]
  method_type: "shipping" | "pickup" | "digital" | string
  destination?: UcpAddress
  description?: string
  fulfillable_on?: string
}

export type UcpFulfillmentEvent = {
  id: string
  occurred_at: string
  type: string
  line_items?: { id: string; quantity: number }[]
  tracking_number?: string
  tracking_url?: string
  carrier?: string
  description?: string
}

export type UcpAdjustment = {
  id: string
  type: string
  occurred_at: string
  status: "pending" | "completed" | "failed"
  line_items?: { id: string; quantity: number }[]
  totals?: UcpTotal[]
  description?: string
}

// =====================================================
// Catalog (search + lookup)
// =====================================================

export type UcpCatalogProductVariant = {
  id: string
  title: string
  sku: string | null
  price: { amount: number; currency: string } | null
}

export type UcpCatalogProductMedia = {
  url: string
  type: "image"
}

export type UcpCatalogProduct = {
  id: string
  title: string
  description: string
  handle: string
  categories: string[]
  price_range: {
    min: { amount: number; currency: string }
    max: { amount: number; currency: string }
  } | null
  variants: UcpCatalogProductVariant[]
  media: UcpCatalogProductMedia[]
  thumbnail_url: string | null
}

export type UcpCatalogSearchResponse = {
  ucp: { version: string; status: "success" | "error" }
  products: UcpCatalogProduct[]
  pagination: {
    total: number
    limit: number
    offset: number
    has_more: boolean
  }
}

export type UcpCatalogLookupResponse = {
  ucp: { version: string; status: "success" | "error" }
  products: UcpCatalogProduct[]
  messages: unknown[]
}

// =====================================================
// Error Response (HTTP-level errors)
// =====================================================

export type UcpErrorResponse = {
  ucp: {
    version: string
    status: "error"
  }
  messages: UcpErrorMessage[]
  continue_url?: string
}
