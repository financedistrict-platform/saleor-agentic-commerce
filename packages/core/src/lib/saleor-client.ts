/**
 * Saleor GraphQL Client
 *
 * Wraps Saleor's GraphQL API for all commerce operations needed by
 * the agentic commerce extension. Uses raw fetch — no dependency on
 * urql, Apollo, or any other GraphQL client library.
 *
 * All methods return typed results and handle errors consistently.
 */

import type {
  SaleorCheckout,
  SaleorOrder,
  SaleorAddress,
} from "../types/saleor.js"

// =====================================================
// Client
// =====================================================

export type SaleorClientOptions = {
  /** Saleor GraphQL API URL (e.g., "https://api.store.com/graphql/") */
  apiUrl: string
  /** Saleor App Token with required permissions */
  authToken: string
  /** Default channel slug (e.g., "default-channel") */
  channel?: string
}

export type SaleorResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; errors?: unknown[] }

export class SaleorClient {
  private apiUrl: string
  private authToken: string
  private channel: string

  constructor(options: SaleorClientOptions) {
    this.apiUrl = options.apiUrl
    this.authToken = options.authToken
    this.channel = options.channel || "default-channel"
  }

  // -------------------------------------------------
  // Checkout Operations
  // -------------------------------------------------

  async createCheckout(input: {
    lines: { variantId: string; quantity: number }[]
    email?: string
    channel?: string
    shippingAddress?: SaleorAddressInput
    billingAddress?: SaleorAddressInput
  }): Promise<SaleorResult<SaleorCheckout>> {
    const result = await this.execute<{ checkoutCreate: { checkout: SaleorCheckout; errors: SaleorError[] } }>(
      CHECKOUT_CREATE_MUTATION,
      {
        input: {
          channel: input.channel || this.channel,
          lines: input.lines,
          email: input.email,
          shippingAddress: input.shippingAddress,
          billingAddress: input.billingAddress,
        },
      },
    )

    if (!result.ok) return result
    const { checkout, errors } = result.data.checkoutCreate
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: checkout }
  }

  async getCheckout(id: string): Promise<SaleorResult<SaleorCheckout>> {
    const result = await this.execute<{ checkout: SaleorCheckout | null }>(
      CHECKOUT_QUERY,
      { id },
    )

    if (!result.ok) return result
    if (!result.data.checkout) return { ok: false, error: `Checkout ${id} not found` }
    return { ok: true, data: result.data.checkout }
  }

  async updateCheckoutShippingAddress(
    checkoutId: string,
    address: SaleorAddressInput,
  ): Promise<SaleorResult<SaleorCheckout>> {
    const result = await this.execute<{
      checkoutShippingAddressUpdate: { checkout: SaleorCheckout; errors: SaleorError[] }
    }>(CHECKOUT_SHIPPING_ADDRESS_UPDATE, { checkoutId, address })

    if (!result.ok) return result
    const { checkout, errors } = result.data.checkoutShippingAddressUpdate
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: checkout }
  }

  async updateCheckoutBillingAddress(
    checkoutId: string,
    address: SaleorAddressInput,
  ): Promise<SaleorResult<SaleorCheckout>> {
    const result = await this.execute<{
      checkoutBillingAddressUpdate: { checkout: SaleorCheckout; errors: SaleorError[] }
    }>(CHECKOUT_BILLING_ADDRESS_UPDATE, { checkoutId, address })

    if (!result.ok) return result
    const { checkout, errors } = result.data.checkoutBillingAddressUpdate
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: checkout }
  }

  async updateCheckoutEmail(
    checkoutId: string,
    email: string,
  ): Promise<SaleorResult<SaleorCheckout>> {
    const result = await this.execute<{
      checkoutEmailUpdate: { checkout: SaleorCheckout; errors: SaleorError[] }
    }>(CHECKOUT_EMAIL_UPDATE, { checkoutId, email })

    if (!result.ok) return result
    const { checkout, errors } = result.data.checkoutEmailUpdate
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: checkout }
  }

  async updateCheckoutDeliveryMethod(
    checkoutId: string,
    deliveryMethodId: string,
  ): Promise<SaleorResult<SaleorCheckout>> {
    const result = await this.execute<{
      checkoutDeliveryMethodUpdate: { checkout: SaleorCheckout; errors: SaleorError[] }
    }>(CHECKOUT_DELIVERY_METHOD_UPDATE, { checkoutId, deliveryMethodId })

    if (!result.ok) return result
    const { checkout, errors } = result.data.checkoutDeliveryMethodUpdate
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: checkout }
  }

  async addCheckoutLines(
    checkoutId: string,
    lines: { variantId: string; quantity: number }[],
  ): Promise<SaleorResult<SaleorCheckout>> {
    const result = await this.execute<{
      checkoutLinesAdd: { checkout: SaleorCheckout; errors: SaleorError[] }
    }>(CHECKOUT_LINES_ADD, { checkoutId, lines })

    if (!result.ok) return result
    const { checkout, errors } = result.data.checkoutLinesAdd
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: checkout }
  }

  async updateCheckoutLines(
    checkoutId: string,
    lines: { lineId: string; quantity: number }[],
  ): Promise<SaleorResult<SaleorCheckout>> {
    const result = await this.execute<{
      checkoutLinesUpdate: { checkout: SaleorCheckout; errors: SaleorError[] }
    }>(CHECKOUT_LINES_UPDATE, { checkoutId, lines })

    if (!result.ok) return result
    const { checkout, errors } = result.data.checkoutLinesUpdate
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: checkout }
  }

  async deleteCheckoutLines(
    checkoutId: string,
    lineIds: string[],
  ): Promise<SaleorResult<SaleorCheckout>> {
    const result = await this.execute<{
      checkoutLinesDelete: { checkout: SaleorCheckout; errors: SaleorError[] }
    }>(CHECKOUT_LINES_DELETE, { checkoutId, linesIds: lineIds })

    if (!result.ok) return result
    const { checkout, errors } = result.data.checkoutLinesDelete
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: checkout }
  }

  async completeCheckout(checkoutId: string): Promise<SaleorResult<SaleorOrder>> {
    const result = await this.execute<{
      checkoutComplete: { order: SaleorOrder; errors: SaleorError[] }
    }>(CHECKOUT_COMPLETE, { checkoutId })

    if (!result.ok) return result
    const { order, errors } = result.data.checkoutComplete
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: order }
  }

  // -------------------------------------------------
  // Metadata Operations
  // -------------------------------------------------

  async updatePrivateMetadata(
    id: string,
    input: { key: string; value: string }[],
  ): Promise<SaleorResult<{ privateMetadata: { key: string; value: string }[] }>> {
    const result = await this.execute<{
      updatePrivateMetadata: {
        item: { privateMetadata: { key: string; value: string }[] }
        errors: SaleorError[]
      }
    }>(UPDATE_PRIVATE_METADATA, { id, input })

    if (!result.ok) return result
    const { item, errors } = result.data.updatePrivateMetadata
    if (errors.length > 0) return { ok: false, error: errors[0].message, errors }
    return { ok: true, data: item }
  }

  // -------------------------------------------------
  // Order Operations
  // -------------------------------------------------

  async getOrder(id: string): Promise<SaleorResult<SaleorOrder>> {
    const result = await this.execute<{ order: SaleorOrder | null }>(
      ORDER_QUERY,
      { id },
    )

    if (!result.ok) return result
    if (!result.data.order) return { ok: false, error: `Order ${id} not found` }
    return { ok: true, data: result.data.order }
  }

  // -------------------------------------------------
  // Internal
  // -------------------------------------------------

  private async execute<T>(query: string, variables?: Record<string, unknown>): Promise<SaleorResult<T>> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ query, variables }),
      })

      if (!response.ok) {
        return { ok: false, error: `Saleor API error: ${response.status} ${response.statusText}` }
      }

      const json = (await response.json()) as { data?: T; errors?: unknown[] }
      if (json.errors && (json.errors as unknown[]).length > 0) {
        const firstError = json.errors[0] as { message?: string }
        return { ok: false, error: firstError.message || "GraphQL error", errors: json.errors }
      }

      if (!json.data) {
        return { ok: false, error: "No data returned from Saleor API" }
      }

      return { ok: true, data: json.data }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return { ok: false, error: `Saleor API request failed: ${message}` }
    }
  }
}

// =====================================================
// Input Types
// =====================================================

type SaleorAddressInput = {
  firstName?: string
  lastName?: string
  streetAddress1?: string
  streetAddress2?: string
  city?: string
  countryArea?: string
  postalCode?: string
  country?: string
  phone?: string
}

type SaleorError = {
  field: string | null
  message: string
  code: string
}

// =====================================================
// GraphQL Queries & Mutations
// =====================================================

const CHECKOUT_FIELDS = `
  id
  token
  email
  channel { slug }
  totalPrice { gross { amount currency } net { amount currency } tax { amount currency } }
  subtotalPrice { gross { amount currency } net { amount currency } tax { amount currency } }
  shippingPrice { gross { amount currency } net { amount currency } tax { amount currency } }
  discount { amount currency }
  lines {
    id
    quantity
    totalPrice { gross { amount currency } net { amount currency } tax { amount currency } }
    unitPrice { gross { amount currency } net { amount currency } tax { amount currency } }
    variant {
      id
      name
      sku
      product { id name slug thumbnail { url } }
    }
  }
  shippingAddress {
    firstName lastName streetAddress1 streetAddress2
    city countryArea postalCode country { code country } phone
  }
  billingAddress {
    firstName lastName streetAddress1 streetAddress2
    city countryArea postalCode country { code country } phone
  }
  shippingMethods {
    id name
    price { amount currency }
    minimumDeliveryDays maximumDeliveryDays
  }
  deliveryMethod {
    ... on ShippingMethod { id name }
  }
  metadata { key value }
  privateMetadata { key value }
`

const CHECKOUT_CREATE_MUTATION = `
  mutation CheckoutCreate($input: CheckoutCreateInput!) {
    checkoutCreate(input: $input) {
      checkout { ${CHECKOUT_FIELDS} }
      errors { field message code }
    }
  }
`

const CHECKOUT_QUERY = `
  query Checkout($id: ID!) {
    checkout(id: $id) { ${CHECKOUT_FIELDS} }
  }
`

const CHECKOUT_SHIPPING_ADDRESS_UPDATE = `
  mutation CheckoutShippingAddressUpdate($checkoutId: ID!, $address: AddressInput!) {
    checkoutShippingAddressUpdate(id: $checkoutId, shippingAddress: $address) {
      checkout { ${CHECKOUT_FIELDS} }
      errors { field message code }
    }
  }
`

const CHECKOUT_BILLING_ADDRESS_UPDATE = `
  mutation CheckoutBillingAddressUpdate($checkoutId: ID!, $address: AddressInput!) {
    checkoutBillingAddressUpdate(id: $checkoutId, billingAddress: $address) {
      checkout { ${CHECKOUT_FIELDS} }
      errors { field message code }
    }
  }
`

const CHECKOUT_EMAIL_UPDATE = `
  mutation CheckoutEmailUpdate($checkoutId: ID!, $email: String!) {
    checkoutEmailUpdate(id: $checkoutId, email: $email) {
      checkout { ${CHECKOUT_FIELDS} }
      errors { field message code }
    }
  }
`

const CHECKOUT_DELIVERY_METHOD_UPDATE = `
  mutation CheckoutDeliveryMethodUpdate($checkoutId: ID!, $deliveryMethodId: ID!) {
    checkoutDeliveryMethodUpdate(id: $checkoutId, deliveryMethodId: $deliveryMethodId) {
      checkout { ${CHECKOUT_FIELDS} }
      errors { field message code }
    }
  }
`

const CHECKOUT_LINES_ADD = `
  mutation CheckoutLinesAdd($checkoutId: ID!, $lines: [CheckoutLineInput!]!) {
    checkoutLinesAdd(id: $checkoutId, lines: $lines) {
      checkout { ${CHECKOUT_FIELDS} }
      errors { field message code }
    }
  }
`

const CHECKOUT_LINES_UPDATE = `
  mutation CheckoutLinesUpdate($checkoutId: ID!, $lines: [CheckoutLineUpdateInput!]!) {
    checkoutLinesUpdate(id: $checkoutId, lines: $lines) {
      checkout { ${CHECKOUT_FIELDS} }
      errors { field message code }
    }
  }
`

const CHECKOUT_LINES_DELETE = `
  mutation CheckoutLinesDelete($checkoutId: ID!, $linesIds: [ID!]!) {
    checkoutLinesDelete(id: $checkoutId, linesIds: $linesIds) {
      checkout { ${CHECKOUT_FIELDS} }
      errors { field message code }
    }
  }
`

const CHECKOUT_COMPLETE = `
  mutation CheckoutComplete($checkoutId: ID!) {
    checkoutComplete(id: $checkoutId) {
      order {
        id number status created userEmail
        channel { slug }
        total { gross { amount currency } net { amount currency } tax { amount currency } }
        subtotal { gross { amount currency } net { amount currency } tax { amount currency } }
        shippingPrice { gross { amount currency } net { amount currency } tax { amount currency } }
        lines {
          id productName variantName quantity
          unitPrice { gross { amount currency } net { amount currency } tax { amount currency } }
          totalPrice { gross { amount currency } net { amount currency } tax { amount currency } }
          variant { id product { id slug thumbnail { url } } }
          thumbnail { url }
        }
        shippingAddress {
          firstName lastName streetAddress1 streetAddress2
          city countryArea postalCode country { code country } phone
        }
        billingAddress {
          firstName lastName streetAddress1 streetAddress2
          city countryArea postalCode country { code country } phone
        }
        metadata { key value }
      }
      errors { field message code }
    }
  }
`

const UPDATE_PRIVATE_METADATA = `
  mutation UpdatePrivateMetadata($id: ID!, $input: [MetadataInput!]!) {
    updatePrivateMetadata(id: $id, input: $input) {
      item { privateMetadata { key value } }
      errors { field message code }
    }
  }
`

const ORDER_QUERY = `
  query Order($id: ID!) {
    order(id: $id) {
      id number status created userEmail
      channel { slug }
      total { gross { amount currency } net { amount currency } tax { amount currency } }
      subtotal { gross { amount currency } net { amount currency } tax { amount currency } }
      shippingPrice { gross { amount currency } net { amount currency } tax { amount currency } }
      lines {
        id productName variantName quantity
        unitPrice { gross { amount currency } net { amount currency } tax { amount currency } }
        totalPrice { gross { amount currency } net { amount currency } tax { amount currency } }
        variant { id product { id slug thumbnail { url } } }
        thumbnail { url }
      }
      shippingAddress {
        firstName lastName streetAddress1 streetAddress2
        city countryArea postalCode country { code country } phone
      }
      metadata { key value }
    }
  }
`

export type { SaleorAddressInput }
