import { describe, it, expect } from "vitest"
import { formatUcpCatalogSearch, formatUcpCatalogLookup } from "./ucp.js"
import type { SaleorProductConnection } from "../../types/saleor.js"

const UCP_VERSION = "2026-04-08"

function makeConnection(overrides: Partial<SaleorProductConnection> = {}): SaleorProductConnection {
  return {
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

describe("formatUcpCatalogSearch", () => {
  it("strips Editorjs JSON description to plain text", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection(), { limit: 20, offset: 0 })
    expect(result.products[0].description).toBe("A delicious loaf. Baked fresh.")
  })

  it("returns raw string when description is not Editorjs JSON", () => {
    const conn = makeConnection()
    conn.edges[0].node.description = "Plain text description"
    const result = formatUcpCatalogSearch(UCP_VERSION, conn, { limit: 20, offset: 0 })
    expect(result.products[0].description).toBe("Plain text description")
  })

  it("returns empty string when description is null", () => {
    const conn = makeConnection()
    conn.edges[0].node.description = null
    const result = formatUcpCatalogSearch(UCP_VERSION, conn, { limit: 20, offset: 0 })
    expect(result.products[0].description).toBe("")
  })

  it("maps variant price to minor units", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection(), { limit: 20, offset: 0 })
    const variant = result.products[0].variants[0]
    expect(variant.price?.amount).toBe(465)
    expect(variant.price?.currency).toBe("usd")
  })

  it("computes price_range from variants", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection(), { limit: 20, offset: 0 })
    expect(result.products[0].price_range).toEqual({
      min: { amount: 465, currency: "usd" },
      max: { amount: 465, currency: "usd" },
    })
  })

  it("sets price_range to null when no variants have prices", () => {
    const conn = makeConnection()
    conn.edges[0].node.variants = [{ id: "v1", name: "No price", sku: null, pricing: null }]
    const result = formatUcpCatalogSearch(UCP_VERSION, conn, { limit: 20, offset: 0 })
    expect(result.products[0].price_range).toBeNull()
  })

  it("returns empty media and null thumbnail_url when product has no thumbnail", () => {
    const conn = makeConnection()
    conn.edges[0].node.thumbnail = null
    const result = formatUcpCatalogSearch(UCP_VERSION, conn, { limit: 20, offset: 0 })
    expect(result.products[0].media).toEqual([])
    expect(result.products[0].thumbnail_url).toBeNull()
  })

  it("maps pageInfo.hasNextPage to pagination.has_more", () => {
    const conn = makeConnection({ pageInfo: { hasNextPage: true, endCursor: "cursor123" } })
    const result = formatUcpCatalogSearch(UCP_VERSION, conn, { limit: 20, offset: 0 })
    expect(result.pagination.has_more).toBe(true)
  })
})

describe("formatUcpCatalogLookup", () => {
  it("returns empty categories when product has no category", () => {
    const conn = makeConnection()
    conn.edges[0].node.category = null
    const result = formatUcpCatalogLookup(UCP_VERSION, conn)
    expect(result.products[0].categories).toEqual([])
  })
})
