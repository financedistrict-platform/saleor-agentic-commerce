import { describe, it, expect } from "vitest"
import { formatUcpCatalogSearch, formatUcpCatalogLookup, formatUcpOrder } from "./ucp.js"
import type { SaleorProductConnection, SaleorOrder, SaleorProduct, SaleorLookupVariant } from "../../types/saleor.js"
import type { FormatterContext } from "./types.js"

const UCP_VERSION = "2026-04-08"

const CTX: FormatterContext = {
  storeName: "Test Store",
  storefrontUrl: "https://shop.example.com",
  ucpVersion: UCP_VERSION,
  acpVersion: UCP_VERSION,
  paymentHandlers: {} as FormatterContext["paymentHandlers"],
}

function money(amount: number) {
  return {
    gross: { amount, currency: "USD" },
    net: { amount, currency: "USD" },
    tax: { amount: 0, currency: "USD" },
  }
}

function makeOrder(overrides: Partial<SaleorOrder> = {}): SaleorOrder {
  return {
    id: "T3JkZXI6MQ==",
    number: "1001",
    status: "UNFULFILLED",
    created: "2026-08-01T00:00:00Z",
    updated: "2026-08-01T00:00:00Z",
    userEmail: "b@example.com",
    checkoutId: "Q2hlY2tvdXQ6YWJj",
    channel: { slug: "default-channel" },
    total: money(20),
    subtotal: money(20),
    shippingPrice: money(0),
    discount: null,
    lines: [
      {
        id: "line-1",
        productName: "Widget",
        variantName: "Blue",
        quantity: 2,
        unitPrice: money(10),
        totalPrice: money(20),
        variant: { id: "var-1", product: { id: "p1", slug: "widget", thumbnail: null } },
        thumbnail: null,
      },
    ],
    shippingAddress: null,
    billingAddress: null,
    fulfillments: [],
    metadata: [],
    ...overrides,
  }
}

function makeConnection(overrides: Partial<SaleorProductConnection> = {}): SaleorProductConnection {
  return {
    totalCount: 1,
    edges: [
      {
        node: {
          id: "UHJvZHVjdDo0Mzg=",
          name: "Seed Malted Loaf",
          slug: "seed-malted-loaf",
          description: JSON.stringify({
            time: 1234567890,
            blocks: [{ data: { text: "A delicious loaf." } }, { data: { text: "Baked fresh." } }],
          }),
          thumbnail: { url: "https://cdn.example.com/thumb.jpg" },
          category: { id: "Q2F0ZWdvcnk6MQ==", name: "Bread" },
          pricing: {
            priceRange: {
              start: { gross: { amount: 4.65, currency: "USD" } },
              stop: { gross: { amount: 4.65, currency: "USD" } },
            },
          },
          variants: [
            {
              id: "UHJvZHVjdFZhcmlhbnQ6MjE0",
              name: "1x",
              sku: "LOAF-001",
              pricing: { price: { gross: { amount: 4.65, currency: "USD" } } },
            },
          ],
        },
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
    ...overrides,
  }
}

function sampleProduct(): SaleorProduct {
  return makeConnection().edges[0].node
}

describe("formatUcpCatalogSearch — product/variant conformance (SAC-8)", () => {
  it("emits description as a description.json object (not a raw string)", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection())
    expect(result.products[0].description).toEqual({ plain: "A delicious loaf. Baked fresh." })
  })

  it("wraps a non-Editorjs string description as { plain }", () => {
    const conn = makeConnection()
    conn.edges[0].node.description = "Plain text description"
    const result = formatUcpCatalogSearch(UCP_VERSION, conn)
    expect(result.products[0].description).toEqual({ plain: "Plain text description" })
  })

  it("emits { plain: '' } (still a valid object) when description is null", () => {
    const conn = makeConnection()
    conn.edges[0].node.description = null
    const result = formatUcpCatalogSearch(UCP_VERSION, conn)
    expect(result.products[0].description).toEqual({ plain: "" })
  })

  it("gives each variant a required description object", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection())
    expect(result.products[0].variants[0].description).toEqual({ plain: "A delicious loaf. Baked fresh." })
  })

  it("emits variant currency in ISO 4217 uppercase", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection())
    const variant = result.products[0].variants[0]
    expect(variant.price?.amount).toBe(465)
    expect(variant.price?.currency).toBe("USD")
  })

  it("computes price_range with uppercase currency", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection())
    expect(result.products[0].price_range).toEqual({
      min: { amount: 465, currency: "USD" },
      max: { amount: 465, currency: "USD" },
    })
  })

  it("omits sku entirely when Saleor reports null (never emits sku: null)", () => {
    const conn = makeConnection()
    conn.edges[0].node.variants = [{ id: "v1", name: "No sku", sku: null, pricing: null }]
    const result = formatUcpCatalogSearch(UCP_VERSION, conn)
    expect("sku" in result.products[0].variants[0]).toBe(false)
  })

  it("sets price_range to null when no variants have prices", () => {
    const conn = makeConnection()
    conn.edges[0].node.variants = [{ id: "v1", name: "No price", sku: null, pricing: null }]
    const result = formatUcpCatalogSearch(UCP_VERSION, conn)
    expect(result.products[0].price_range).toBeNull()
  })

  it("returns empty media and null thumbnail_url when product has no thumbnail", () => {
    const conn = makeConnection()
    conn.edges[0].node.thumbnail = null
    const result = formatUcpCatalogSearch(UCP_VERSION, conn)
    expect(result.products[0].media).toEqual([])
    expect(result.products[0].thumbnail_url).toBeNull()
  })
})

describe("formatUcpCatalogSearch — cursor pagination (SAC-8 / U-4)", () => {
  it("reports has_next_page:false and no cursor on a last page", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection())
    expect(result.pagination.has_next_page).toBe(false)
    expect(result.pagination.cursor).toBeUndefined()
  })

  it("includes the endCursor when has_next_page is true", () => {
    const conn = makeConnection({ pageInfo: { hasNextPage: true, endCursor: "cursor123" } })
    const result = formatUcpCatalogSearch(UCP_VERSION, conn)
    expect(result.pagination.has_next_page).toBe(true)
    expect(result.pagination.cursor).toBe("cursor123")
  })

  it("surfaces the real total_count from the Saleor connection (not products.length + offset)", () => {
    const conn = makeConnection({ totalCount: 32 })
    const result = formatUcpCatalogSearch(UCP_VERSION, conn)
    expect(result.pagination.total_count).toBe(32)
  })

  it("omits total_count when the connection did not report one", () => {
    const conn = makeConnection({ totalCount: undefined })
    const result = formatUcpCatalogSearch(UCP_VERSION, conn)
    expect(result.pagination.total_count).toBeUndefined()
  })
})

describe("formatUcpCatalogLookup — variant-id resolution + inputs[] (SAC-8)", () => {
  it("returns empty categories when product has no category", () => {
    const p = sampleProduct()
    p.category = null
    const result = formatUcpCatalogLookup(UCP_VERSION, { products: [p], variants: [] })
    expect(result.products[0].categories).toEqual([])
  })

  it("emits product description as an object", () => {
    const result = formatUcpCatalogLookup(UCP_VERSION, { products: [sampleProduct()], variants: [] })
    expect(result.products[0].description).toEqual({ plain: "A delicious loaf. Baked fresh." })
  })

  it("resolves a product GID to its featured variant with match 'featured'", () => {
    const p = sampleProduct()
    const result = formatUcpCatalogLookup(UCP_VERSION, { products: [p], variants: [] })
    expect(result.products[0].variants).toHaveLength(1)
    expect(result.products[0].variants[0].id).toBe("UHJvZHVjdFZhcmlhbnQ6MjE0")
    expect(result.products[0].variants[0].inputs).toEqual([{ id: p.id, match: "featured" }])
  })

  it("resolves a variant GID to that exact variant with match 'exact'", () => {
    const p = sampleProduct()
    const lv: SaleorLookupVariant = { ...p.variants[0], product: p }
    const result = formatUcpCatalogLookup(UCP_VERSION, { products: [], variants: [lv] })
    expect(result.products).toHaveLength(1)
    expect(result.products[0].id).toBe(p.id)
    expect(result.products[0].variants).toHaveLength(1)
    expect(result.products[0].variants[0].inputs).toEqual([{ id: lv.id, match: "exact" }])
  })

  it("dedups a product hit by both its product GID and its variant GID (one product, one variant, two inputs)", () => {
    const p = sampleProduct()
    const lv: SaleorLookupVariant = { ...p.variants[0], product: p }
    const result = formatUcpCatalogLookup(UCP_VERSION, { products: [p], variants: [lv] })
    expect(result.products).toHaveLength(1)
    expect(result.products[0].variants).toHaveLength(1)
    expect(result.products[0].variants[0].inputs).toEqual([
      { id: p.id, match: "featured" },
      { id: lv.id, match: "exact" },
    ])
  })

  it("skips products with no variants (lookup_variant requires a variant)", () => {
    const p = sampleProduct()
    p.variants = []
    const result = formatUcpCatalogLookup(UCP_VERSION, { products: [p], variants: [] })
    expect(result.products).toHaveLength(0)
  })
})

describe("formatUcpOrder — checkout_id + fulfilment (SAC-6, SAC-7)", () => {
  it("returns the checkout id (not the order id) as checkout_id", () => {
    const o = formatUcpOrder(CTX, makeOrder())
    expect(o.checkout_id).toBe("Q2hlY2tvdXQ6YWJj")
    expect(o.checkout_id).not.toBe(o.id)
  })

  it("falls back to the order id when checkoutId is null", () => {
    const o = formatUcpOrder(CTX, makeOrder({ checkoutId: null }))
    expect(o.checkout_id).toBe(o.id)
  })

  it("reports 'processing' with fulfilled 0 when there are no fulfillments", () => {
    const o = formatUcpOrder(CTX, makeOrder())
    expect(o.line_items[0].quantity.fulfilled).toBe(0)
    expect(o.line_items[0].status).toBe("processing")
  })

  it("derives 'fulfilled' and the fulfilled quantity from fulfillments", () => {
    const o = formatUcpOrder(
      CTX,
      makeOrder({
        fulfillments: [
          {
            id: "ff1", status: "FULFILLED", trackingNumber: "TRK1", created: "2026-08-02T00:00:00Z",
            lines: [{ quantity: 2, orderLine: { id: "line-1" } }],
          },
        ],
      }),
    )
    expect(o.line_items[0].quantity.fulfilled).toBe(2)
    expect(o.line_items[0].status).toBe("fulfilled")
  })

  it("derives 'partial' when only some quantity is fulfilled", () => {
    const o = formatUcpOrder(
      CTX,
      makeOrder({
        fulfillments: [
          {
            id: "ff1", status: "FULFILLED", trackingNumber: null, created: "2026-08-02T00:00:00Z",
            lines: [{ quantity: 1, orderLine: { id: "line-1" } }],
          },
        ],
      }),
    )
    expect(o.line_items[0].quantity.fulfilled).toBe(1)
    expect(o.line_items[0].status).toBe("partial")
  })

  it("ignores cancelled fulfillments when counting fulfilled quantity", () => {
    const o = formatUcpOrder(
      CTX,
      makeOrder({
        fulfillments: [
          {
            id: "ff1", status: "CANCELED", trackingNumber: null, created: "2026-08-02T00:00:00Z",
            lines: [{ quantity: 2, orderLine: { id: "line-1" } }],
          },
        ],
      }),
    )
    expect(o.line_items[0].quantity.fulfilled).toBe(0)
    expect(o.line_items[0].status).toBe("processing")
  })

  it("maps Saleor fulfillments to fulfillment events", () => {
    const o = formatUcpOrder(
      CTX,
      makeOrder({
        fulfillments: [
          {
            id: "ff1", status: "FULFILLED", trackingNumber: "TRK1", created: "2026-08-02T00:00:00Z",
            lines: [{ quantity: 2, orderLine: { id: "line-1" } }],
          },
        ],
      }),
    )
    expect(o.fulfillment.events).toHaveLength(1)
    expect(o.fulfillment.events[0]).toMatchObject({
      id: "ff1", type: "FULFILLED", tracking_number: "TRK1", occurred_at: "2026-08-02T00:00:00Z",
    })
    expect(o.fulfillment.events[0].line_items).toEqual([{ id: "line-1", quantity: 2 }])
  })
})
