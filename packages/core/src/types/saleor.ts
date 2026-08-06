/**
 * Saleor GraphQL response types
 *
 * Lightweight types representing Saleor's GraphQL responses.
 * These are intentionally loose to avoid tight coupling to a specific
 * Saleor version — we use the fields we need and ignore the rest.
 */

export type SaleorCheckout = {
  id: string
  token: string
  email: string | null
  channel: { slug: string }
  totalPrice: SaleorTaxedMoney
  subtotalPrice: SaleorTaxedMoney
  shippingPrice: SaleorTaxedMoney
  discount: SaleorMoney | null
  lines: SaleorCheckoutLine[]
  shippingAddress: SaleorAddress | null
  billingAddress: SaleorAddress | null
  shippingMethods: SaleorShippingMethod[]
  deliveryMethod: SaleorDeliveryMethod | null
  metadata: SaleorMetadataItem[]
  privateMetadata: SaleorMetadataItem[]
}

export type SaleorCheckoutLine = {
  id: string
  quantity: number
  totalPrice: SaleorTaxedMoney
  unitPrice: SaleorTaxedMoney
  variant: {
    id: string
    name: string
    sku: string | null
    product: {
      id: string
      name: string
      slug: string
      thumbnail: { url: string } | null
    }
  }
}

export type SaleorAddress = {
  firstName: string
  lastName: string
  streetAddress1: string
  streetAddress2: string
  city: string
  countryArea: string
  postalCode: string
  country: { code: string; country: string }
  phone: string
}

export type SaleorShippingMethod = {
  id: string
  name: string
  price: SaleorMoney
  minimumDeliveryDays: number | null
  maximumDeliveryDays: number | null
}

export type SaleorDeliveryMethod = {
  __typename: string
  id: string
  name: string
}

export type SaleorTaxedMoney = {
  gross: SaleorMoney
  net: SaleorMoney
  tax: SaleorMoney
}

export type SaleorMoney = {
  amount: number
  currency: string
}

export type SaleorMetadataItem = {
  key: string
  value: string
}

export type SaleorOrder = {
  id: string
  number: string | null
  status: string
  created: string
  updated: string
  userEmail: string | null
  checkoutId: string | null
  channel: { slug: string }
  total: SaleorTaxedMoney
  subtotal: SaleorTaxedMoney
  shippingPrice: SaleorTaxedMoney
  discount: SaleorMoney | null
  lines: SaleorOrderLine[]
  shippingAddress: SaleorAddress | null
  billingAddress: SaleorAddress | null
  fulfillments: SaleorFulfillment[]
  metadata: SaleorMetadataItem[]
}

export type SaleorFulfillment = {
  id: string
  status: string
  trackingNumber: string | null
  created: string
  lines: {
    quantity: number
    orderLine: { id: string } | null
  }[]
}

// =====================================================
// Catalog types (for UCP catalog/search and catalog/lookup)
// =====================================================

export type SaleorProductVariant = {
  id: string
  name: string
  sku: string | null
  pricing: {
    price: {
      gross: SaleorMoney
    }
  } | null
}

export type SaleorProduct = {
  id: string
  name: string
  slug: string
  /** Editorjs JSON string — strip to plain text before returning to agents */
  description: string | null
  thumbnail: { url: string } | null
  category: { id: string; name: string } | null
  pricing: {
    priceRange: {
      start: { gross: SaleorMoney }
      stop: { gross: SaleorMoney }
    }
  } | null
  variants: SaleorProductVariant[]
}

export type SaleorProductConnection = {
  edges: { node: SaleorProduct }[]
  totalCount?: number
  pageInfo: {
    hasNextPage: boolean
    endCursor: string | null
  }
}

export type SaleorOrderLine = {
  id: string
  productName: string
  variantName: string
  quantity: number
  unitPrice: SaleorTaxedMoney
  totalPrice: SaleorTaxedMoney
  variant: {
    id: string
    product: {
      id: string
      slug: string
      thumbnail: { url: string } | null
    }
  } | null
  thumbnail: { url: string } | null
}
