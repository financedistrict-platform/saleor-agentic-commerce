import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PaymentHandlerRegistry } from "../payment-handler-registry.js"
import { formatUcpCheckoutSession, formatUcpCompleteResponse, formatUcpProfile } from "../formatters/ucp.js"
import { ucpWireOf } from "../ucp-version-registry.js"
import { PrismPaymentHandler } from "../../../../prism-payment/src/handler.js"
import type { SaleorCheckout } from "../../types/saleor.js"
import type { UcpOrderConfirmation } from "../../types/ucp.js"

const HERE = dirname(fileURLToPath(import.meta.url))
export const FIXTURES = join(HERE, "..", "..", "__fixtures__")
export const UCP_FIXTURES = join(FIXTURES, "ucp")
export const PRISM_FIXTURES = join(FIXTURES, "prism")
export const PRISM_HANDLER_ID = "xyz.fd.prism_payment"
export const PRISM_OWNED_KEYS = ["id", "version", "spec", "schema", "config_schema", "instrument_schemas", "available_instruments"]
export const STOREFRONT = "https://store.test"
export const ENDPOINT = `${STOREFRONT}/api/ucp`

export type RenderedFixtures = Record<string, unknown>

export type PrismCall = { url: string; headers: Record<string, string> }

export function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function readFixture(folder: string, name: string): string {
  return readFileSync(join(UCP_FIXTURES, folder, name), "utf8")
}

export function readInput<T>(name: string): T {
  return JSON.parse(readFileSync(join(UCP_FIXTURES, "inputs", name), "utf8")) as T
}

export function readPrismFixture(name: string): string {
  return readFileSync(join(PRISM_FIXTURES, name), "utf8")
}

export function supportedLinks(versions: readonly string[]): Record<string, string> {
  return Object.fromEntries(versions.map((v) => [v, `${STOREFRONT}/.well-known/ucp/${v}`]))
}

export function stubPrismFetch(recorded: string, calls: PrismCall[] = []): () => void {
  const original = globalThis.fetch
  const body = readPrismFixture(recorded)
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string> | undefined) } })
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

export async function renderFixtures(options: {
  version: string
  supported: readonly string[]
  recordedPrism?: string
}): Promise<RenderedFixtures> {
  const paymentHandlers = new PaymentHandlerRegistry()
  const restore = options.recordedPrism ? stubPrismFetch(options.recordedPrism) : () => {}
  try {
    if (options.recordedPrism) {
      paymentHandlers.registerAdapter(new PrismPaymentHandler({ apiUrl: "https://gw.example", apiKey: "test-key" }))
    }
    const ctx = {
      storeName: "Demo Store",
      storefrontUrl: STOREFRONT,
      ucpVersion: options.version,
      acpVersion: "2026-01-30",
      paymentHandlers,
    }
    const checkout = readInput<SaleorCheckout>("checkout.json")
    const errors = readInput<Record<string, { code: string; content: string; severity?: "recoverable" }>>("errors.json")

    return {
      "profile.json": await formatUcpProfile(ctx, ENDPOINT, supportedLinks(options.supported)),
      "checkout__create.json": formatUcpCheckoutSession(ctx, checkout),
      "checkout__complete.json": formatUcpCompleteResponse(ctx, checkout, readInput<UcpOrderConfirmation>("order-confirmation.json")),
      "error__invalid_instrument.json": ucpWireOf(options.version).error(errors.invalid_instrument),
    }
  } finally {
    restore()
  }
}

export function withoutPrismOwnedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPrismOwnedKeys)
  if (typeof value !== "object" || value === null) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === PRISM_HANDLER_ID && Array.isArray(child)) {
      result[key] = child.map((entry) => {
        if (typeof entry !== "object" || entry === null) return entry
        const copy = { ...(entry as Record<string, unknown>) }
        for (const owned of PRISM_OWNED_KEYS) delete copy[owned]
        return copy
      })
    } else {
      result[key] = withoutPrismOwnedKeys(child)
    }
  }
  return result
}

export function outsidePrismEntries(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(outsidePrismEntries)
  if (typeof value !== "object" || value === null) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = key === PRISM_HANDLER_ID ? "<prism>" : outsidePrismEntries(child)
  }
  return result
}
