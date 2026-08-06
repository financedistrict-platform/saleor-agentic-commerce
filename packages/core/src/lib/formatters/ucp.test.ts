import { describe, it, expect } from "vitest"
import { formatUcpCatalogSearch, formatUcpCatalogLookup } from "./ucp.js"
import type { SaleorProductConnection } from "../../types/saleor.js"

const UCP_VERSION = "2026-04-08"

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

describe("formatUcpCatalogLookup", () => {
  it("returns empty categories when product has no category", () => {
    const conn = makeConnection()
    conn.edges[0].node.category = null
    const result = formatUcpCatalogLookup(UCP_VERSION, conn)
    expect(result.products[0].categories).toEqual([])
  })

  it("emits product description as an object", () => {
    const result = formatUcpCatalogLookup(UCP_VERSION, makeConnection())
    expect(result.products[0].description).toEqual({ plain: "A delicious loaf. Baked fresh." })
  })
})
