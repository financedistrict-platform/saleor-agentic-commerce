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
  it("returns correct ucp envelope", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection(), { limit: 20, offset: 0 })
    expect(result.ucp.version).toBe(UCP_VERSION)
    expect(result.ucp.status).toBe("success")
  })

  it("maps product fields correctly", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection(), { limit: 20, offset: 0 })
    const p = result.products[0]
    expect(p.id).toBe("UHJvZHVjdDo0Mzg=")
    expect(p.title).toBe("Seed Malted Loaf")
    expect(p.handle).toBe("seed-malted-loaf")
    expect(p.categories).toEqual(["Bread"])
    expect(p.thumbnail_url).toBe("https://cdn.example.com/thumb.jpg")
  })

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

  it("builds media array from thumbnail", () => {
    const result = formatUcpCatalogSearch(UCP_VERSION, makeConnection(), { limit: 20, offset: 0 })
    expect(result.products[0].media).toEqual([
      { url: "https://cdn.example.com/thumb.jpg", type: "image" },
    ])
  })

  it("returns empty media when no thumbnail", () => {
    const conn = makeConnection()
    conn.edges[0].node.thumbnail = null
    const result = formatUcpCatalogSearch(UCP_VERSION, conn, { limit: 20, offset: 0 })
    expect(result.products[0].media).toEqual([])
    expect(result.products[0].thumbnail_url).toBeNull()
  })

  it("returns pagination with has_more from pageInfo", () => {
    const conn = makeConnection({ pageInfo: { hasNextPage: true, endCursor: "cursor123" } })
    const result = formatUcpCatalogSearch(UCP_VERSION, conn, { limit: 20, offset: 0 })
    expect(result.pagination.has_more).toBe(true)
    expect(result.pagination.limit).toBe(20)
    expect(result.pagination.offset).toBe(0)
  })

  it("returns empty products for empty connection", () => {
    const conn = makeConnection({ edges: [], pageInfo: { hasNextPage: false, endCursor: null } })
    const result = formatUcpCatalogSearch(UCP_VERSION, conn, { limit: 20, offset: 0 })
    expect(result.products).toHaveLength(0)
    expect(result.pagination.has_more).toBe(false)
  })
})

describe("formatUcpCatalogLookup", () => {
  it("returns correct ucp envelope", () => {
    const result = formatUcpCatalogLookup(UCP_VERSION, makeConnection())
    expect(result.ucp.version).toBe(UCP_VERSION)
    expect(result.ucp.status).toBe("success")
  })

  it("returns products array", () => {
    const result = formatUcpCatalogLookup(UCP_VERSION, makeConnection())
    expect(result.products).toHaveLength(1)
    expect(result.products[0].id).toBe("UHJvZHVjdDo0Mzg=")
  })

  it("returns empty messages array", () => {
    const result = formatUcpCatalogLookup(UCP_VERSION, makeConnection())
    expect(result.messages).toEqual([])
  })

  it("handles product with no category", () => {
    const conn = makeConnection()
    conn.edges[0].node.category = null
    const result = formatUcpCatalogLookup(UCP_VERSION, conn)
    expect(result.products[0].categories).toEqual([])
  })
})
