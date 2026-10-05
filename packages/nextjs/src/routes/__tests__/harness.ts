import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { SaleorCheckout, SaleorMetadataItem } from "@financedistrict/saleor-agentic-commerce-core"
import type { AgentProfileFetcher, AgentProfileResult } from "@financedistrict/saleor-agentic-commerce-core/agent-profile-fetcher"
import { PrismPaymentHandler } from "../../../../prism-payment/src/handler.js"
import { createAgenticCommerce, type AgenticCommerceConfig } from "../../config.js"
import { createUcpRoutes } from "../ucp-routes.js"

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "core", "src", "__fixtures__")

export const STOREFRONT = "https://store.test"
export const CHECKOUT_ID = "Q2hlY2tvdXQ6MQ=="

export function readFixture(path: string): string {
  return readFileSync(join(FIXTURES, path), "utf8")
}

export function checkoutTemplate(): SaleorCheckout {
  return JSON.parse(readFixture("ucp/inputs/checkout.json")) as SaleorCheckout
}

export type PrismRequest = { url: string; method: string; headers: Record<string, string>; body?: unknown }

export function stubPrismGateway(options: { handlers?: string; requirements?: string } = {}) {
  const requests: PrismRequest[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
    requests.push({ url, method: init?.method ?? "GET", headers: { ...(init?.headers as Record<string, string> | undefined) }, body })
    const json = (text: string) => new Response(text, { status: 200, headers: { "content-type": "application/json" } })
    if (/\/ucp\/[^/]+\/handlers$/.test(url)) return json(readFixture(`prism/${options.handlers ?? "current-handlers-2026-04-08.json"}`))
    if (/\/api\/v2\/merchant\/payment-requirements$/.test(url)) return json(readFixture(`prism/${options.requirements ?? "current-payment-requirements.json"}`))
    if (url.includes("/payment/settle")) return json(JSON.stringify({ success: true, transaction: "0xsettled" }))
    return new Response("not found", { status: 404 })
  }) as typeof fetch
  return { requests, restore: () => { globalThis.fetch = original } }
}

export function fakeSaleor(initial: SaleorCheckout[] = []) {
  const checkouts = new Map(initial.map((c) => [c.id, structuredClone(c)]))
  const transactions: { checkoutId: string; name: string; pspReference: string }[] = []
  const notFound = { ok: false as const, error: "Checkout not found" }

  const client = {
    async createCheckout() {
      const created = { ...checkoutTemplate(), id: "Q2hlY2tvdXQ6Mg==", privateMetadata: [] as SaleorMetadataItem[] }
      checkouts.set(created.id, created)
      return { ok: true as const, data: structuredClone(created) }
    },
    async getCheckout(id: string) {
      const found = checkouts.get(id)
      return found ? { ok: true as const, data: structuredClone(found) } : notFound
    },
    async updatePrivateMetadata(id: string, items: SaleorMetadataItem[]) {
      const found = checkouts.get(id)
      if (!found) return notFound
      for (const item of items) {
        found.privateMetadata = [...found.privateMetadata.filter((m) => m.key !== item.key), item]
      }
      return { ok: true as const, data: undefined }
    },
    async createCheckoutTransaction(id: string, tx: { name: string; pspReference: string }) {
      const found = checkouts.get(id)
      if (!found) return notFound
      found.transactions = [...found.transactions, { pspReference: tx.pspReference }]
      transactions.push({ checkoutId: id, name: tx.name, pspReference: tx.pspReference })
      return { ok: true as const, data: undefined }
    },
    async completeCheckout(id: string) {
      const found = checkouts.get(id)
      if (!found) return notFound
      if (found.transactions.length === 0) {
        return { ok: false as const, error: "Not paid", errors: [{ code: "CHECKOUT_NOT_FULLY_PAID", message: "Not paid", field: null }] }
      }
      return { ok: true as const, data: { id: "T3JkZXI6MQ==", number: "1001" } }
    },
  }
  return { client, checkouts, transactions }
}

export function fixedFetcher(profiles: Record<string, AgentProfileResult>): AgentProfileFetcher & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async lookup(url: string) {
      calls.push(url)
      return profiles[url] ?? { status: "failed" }
    },
  }
}

export const AGENT_0408 = "https://agent.example/0408"
export const AGENT_0825 = "https://agent.example/0825"
export const AGENT_0123 = "https://agent.example/0123"
export const AGENT_UNKNOWN = "https://agent.example/unknown"
export const AGENT_UNDECLARED = "https://agent.example/undeclared"
export const AGENT_DOWN = "https://agent.example/down"
export const AGENT_REDIRECTED = "https://agent.example/redirected"
export const AGENT_REDIRECTED_NO_LOCATION = "https://agent.example/redirected-no-location"

export const PROFILES: Record<string, AgentProfileResult> = {
  [AGENT_0408]: { status: "ok", version: "2026-04-08" },
  [AGENT_0825]: { status: "ok", version: "2026-08-25" },
  [AGENT_0123]: { status: "ok", version: "2026-01-23" },
  [AGENT_UNKNOWN]: { status: "ok", version: "2027-01-01" },
  [AGENT_UNDECLARED]: { status: "ok", version: null },
  [AGENT_REDIRECTED]: { status: "redirected", location: "https://elsewhere.example/profile" },
  [AGENT_REDIRECTED_NO_LOCATION]: { status: "redirected", location: null },
}

export const PINNED_0408_CONFIG: Partial<AgenticCommerceConfig> = {
  ucpVersion: "2026-04-08",
  ucpSupportedVersions: ["2026-08-25", "2026-01-23"],
}

export function buildRoutes(options: {
  config?: Partial<AgenticCommerceConfig>
  checkouts?: SaleorCheckout[]
  prism?: boolean
} = {}) {
  const saleor = fakeSaleor(options.checkouts)
  const fetcher = fixedFetcher(PROFILES)
  const instance = createAgenticCommerce({
    saleorApiUrl: "https://saleor.test/graphql/",
    saleorAuthToken: "token",
    storefrontUrl: STOREFRONT,
    storeName: "Demo Store",
    paymentHandlers: options.prism ? [new PrismPaymentHandler({ apiUrl: "https://gw.example", apiKey: "test-key" })] : [],
    ...options.config,
  })
  instance.saleorClient = saleor.client as unknown as typeof instance.saleorClient
  instance.agentProfileFetcher = fetcher
  return { routes: createUcpRoutes(instance), saleor, fetcher, instance }
}

export function ucpRequest(url: string, options: { agent?: string; method?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (options.agent) headers["UCP-Agent"] = `profile="${options.agent}"`
  return new Request(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

export function params<T>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) }
}
