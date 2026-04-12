/**
 * ACP (Agentic Commerce Protocol) Types
 *
 * Based on ACP spec version 2026-01-30
 * Source: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/spec/2026-01-30
 */

// =====================================================
// Checkout Session
// =====================================================

export type AcpCheckoutSession = {
  id: string
  status: AcpCheckoutStatus
  currency: string
  line_items: AcpLineItem[]
  totals: AcpTotal[]
  fulfillment_options: AcpFulfillmentOption[]
  messages: AcpMessage[]
  links: AcpLink[]
  capabilities: AcpCapabilities
  protocol?: AcpProtocolVersion
  buyer?: AcpBuyer
  fulfillment_details?: AcpFulfillmentDetails
  selected_fulfillment_options?: AcpSelectedFulfillmentOption[]
  fulfillment_groups?: AcpFulfillmentGroup[]
  created_at?: string
  updated_at?: string
  expires_at?: string
  continue_url?: string
  metadata?: Record<string, unknown>
}

export type AcpCheckoutStatus =
  | "incomplete"
  | "not_ready_for_payment"
  | "requires_escalation"
  | "authentication_required"
  | "ready_for_payment"
  | "pending_approval"
  | "complete_in_progress"
  | "completed"
  | "canceled"
  | "in_progress"
  | "expired"

export type AcpProtocolVersion = {
  version: string
}

// =====================================================
// Capabilities
// =====================================================

export type AcpCapabilities = {
  payment?: AcpPayment
  interventions?: AcpInterventionCapabilities
  extensions?: AcpExtensionDeclaration[] | string[]
}

export type AcpPayment = {
  handlers: AcpPaymentHandler[]
}

export type AcpPaymentHandler = {
  id: string
  /** Reverse-DNS format (e.g., "dev.acp.tokenized.card") */
  name: string
  /** YYYY-MM-DD format */
  version: string
  /** URI to handler specification */
  spec: string
  /** Whether handler requires delegate payment tokenization */
  requires_delegate_payment: boolean
  /** Whether handler requires PCI DSS compliance */
  requires_pci_compliance: boolean
  /** Payment Service Provider identifier */
  psp: string
  /** URI to configuration JSON Schema */
  config_schema: string
  /** URIs to payment instrument JSON Schemas */
  instrument_schemas: string[]
  /** Handler-specific configuration */
  config: Record<string, unknown>
}

export type AcpInterventionCapabilities = {
  supported?: string[]
  required?: string[]
  enforcement?: "always" | "conditional" | "optional"
}

export type AcpExtensionDeclaration = {
  name: string
  version: string
}

// =====================================================
// Buyer
// =====================================================

export type AcpBuyer = {
  email: string
  first_name?: string
  last_name?: string
  full_name?: string
  phone_number?: string
  customer_id?: string
  account_type?: "guest" | "registered" | "business"
  authentication_status?: "authenticated" | "guest" | "requires_signin"
}

// =====================================================
// Line Items
// =====================================================

export type AcpLineItem = {
  id: string
  item: AcpItem
  quantity: number
  totals: AcpTotal[]
  name?: string
  description?: string
  images?: string[]
  unit_amount?: number
  product_id?: string
  sku?: string
  variant_id?: string
  category?: string
  tags?: string[]
  availability_status?: "in_stock" | "low_stock" | "out_of_stock" | "backorder" | "pre_order"
  available_quantity?: number
  max_quantity_per_order?: number
  parent_id?: string
}

export type AcpItem = {
  id: string
  name?: string
  unit_amount?: number
}

// =====================================================
// Totals
// =====================================================

export type AcpTotalType =
  | "items_base_amount"
  | "items_discount"
  | "subtotal"
  | "discount"
  | "fulfillment"
  | "tax"
  | "fee"
  | "gift_wrap"
  | "tip"
  | "store_credit"
  | "total"

export type AcpTotal = {
  type: AcpTotalType
  display_text: string
  amount: number
  description?: string
}

// =====================================================
// Address
// =====================================================

export type AcpAddress = {
  name: string
  line_one: string
  city: string
  state: string
  country: string
  postal_code: string
  line_two?: string
}

// =====================================================
// Fulfillment
// =====================================================

export type AcpFulfillmentDetails = {
  name?: string
  phone_number?: string
  email?: string
  address?: AcpAddress
}

export type AcpFulfillmentOption =
  | AcpFulfillmentOptionShipping
  | AcpFulfillmentOptionPickup
  | AcpFulfillmentOptionLocalDelivery
  | AcpFulfillmentOptionDigital

export type AcpFulfillmentOptionShipping = {
  type: "shipping"
  id: string
  title: string
  description?: string
  carrier?: string
  earliest_delivery_time?: string
  latest_delivery_time?: string
  totals: AcpTotal[]
}

export type AcpFulfillmentOptionPickup = {
  type: "pickup"
  id: string
  title: string
  description?: string
  location: {
    name: string
    address: AcpAddress
    phone?: string
    instructions?: string
  }
  pickup_type?: "in_store" | "curbside" | "locker"
  ready_by?: string
  pickup_by?: string
  totals: AcpTotal[]
}

export type AcpFulfillmentOptionLocalDelivery = {
  type: "local_delivery"
  id: string
  title: string
  description?: string
  delivery_window?: { start?: string; end?: string }
  totals: AcpTotal[]
}

export type AcpFulfillmentOptionDigital = {
  type: "digital"
  id: string
  title: string
  description?: string
  totals: AcpTotal[]
}

export type AcpSelectedFulfillmentOption = {
  type: "shipping" | "digital" | "pickup" | "local_delivery"
  option_id: string
  item_ids: string[]
}

export type AcpFulfillmentGroup = {
  id: string
  item_ids: string[]
  destination_type: "shipping" | "pickup" | "local_delivery" | "digital"
  fulfillment_details?: AcpFulfillmentDetails
  location_id?: string
  instructions?: string
}

// =====================================================
// Payment Data (Complete request)
// =====================================================

export type AcpPaymentData = {
  handler_id?: string
  instrument?: {
    type: string
    credential: {
      type: string
      token: string
    }
  }
  billing_address?: AcpAddress
  purchase_order_number?: string
}

// =====================================================
// Messages
// =====================================================

export type AcpMessageSeverity = "info" | "low" | "medium" | "high" | "critical"

export type AcpInfoMessage = {
  type: "info"
  content_type: "plain" | "markdown"
  content: string
  severity?: AcpMessageSeverity
  param?: string
}

export type AcpWarningMessage = {
  type: "warning"
  code: string
  content_type: "plain" | "markdown"
  content: string
  severity?: AcpMessageSeverity
  param?: string
}

export type AcpErrorMessage = {
  type: "error"
  code: string
  content_type: "plain" | "markdown"
  content: string
  severity?: AcpMessageSeverity
  param?: string | null
}

export type AcpMessage = AcpInfoMessage | AcpWarningMessage | AcpErrorMessage

// =====================================================
// Links
// =====================================================

export type AcpLinkType =
  | "terms_of_use"
  | "privacy_policy"
  | "return_policy"
  | "shipping_policy"
  | "contact_us"
  | "about_us"
  | "faq"
  | "support"

export type AcpLink = {
  type: AcpLinkType
  url: string
  title?: string
}

// =====================================================
// Order
// =====================================================

export type AcpOrder = {
  id: string
  checkout_session_id: string
  permalink_url: string
  order_number?: string
  status?: "confirmed" | "processing" | "shipped" | "delivered"
}

// =====================================================
// Complete Response (checkout session with order)
// =====================================================

export type AcpCompleteResponse = AcpCheckoutSession & {
  status: "completed"
  order: AcpOrder
}

// =====================================================
// Error Response (protocol-level)
// =====================================================

export type AcpErrorType =
  | "invalid_request"
  | "request_not_idempotent"
  | "processing_error"
  | "service_unavailable"

export type AcpErrorResponse = {
  type: AcpErrorType
  code: string
  message: string
  param?: string
}
