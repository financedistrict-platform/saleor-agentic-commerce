# Saleor Agentic Commerce

Make your Saleor store shoppable by AI agents.

This SDK adds [UCP](https://ucp.dev/) and [ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) protocol endpoints to your existing Next.js storefront, so AI shopping agents can discover your products, create checkouts, and complete purchases — without any changes to your Saleor backend.

## Why this matters

AI agents are becoming the next commerce channel. Just like merchants once added mobile apps alongside their websites, they'll soon need to serve autonomous agents that shop on behalf of consumers. But agents don't browse — they need structured APIs with standardized discovery, checkout flows, and payment settlement.

**UCP** (Universal Commerce Protocol) and **ACP** (Agentic Commerce Protocol) are the emerging open standards for this. This SDK implements both, so your Saleor store speaks the language agents understand.

## What you get

- **Agent discovery** — A `.well-known/ucp` profile that tells agents what your store supports, which payment methods are available, and where the API lives
- **Checkout sessions** — Agents can create carts, set shipping addresses, select delivery options, and complete purchases through protocol-compliant endpoints
- **Pluggable payments** — Ship with [Finance District Prism](https://financedistrict.xyz) (stablecoin payments via x402/EIP-3009), or implement your own payment handler
- **No backend changes** — Everything runs in your Next.js storefront layer, consuming the same Saleor GraphQL API your storefront already uses

## Packages

| Package | What it does |
|---------|-------------|
| [`@financedistrict/saleor-agentic-commerce-core`](./packages/core) | Protocol types, Saleor-to-protocol formatters, payment handler interface |
| [`@financedistrict/saleor-agentic-commerce-nextjs`](./packages/nextjs) | Ready-made Next.js App Router route handlers for UCP and ACP |
| [`@financedistrict/saleor-prism-payment`](./packages/prism-payment) | Prism payment handler — stablecoin settlement via x402/EIP-3009 |

## Quick Start

```bash
pnpm add @financedistrict/saleor-agentic-commerce-core \
         @financedistrict/saleor-agentic-commerce-nextjs \
         @financedistrict/saleor-prism-payment
```

Wire up the route handlers in your Next.js app:

```ts
// src/lib/agentic-commerce.ts
import { createAgenticCommerce } from "@financedistrict/saleor-agentic-commerce-nextjs"
import { PrismPaymentHandler } from "@financedistrict/saleor-prism-payment"

export const agenticCommerce = createAgenticCommerce({
  saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
  storefrontUrl: process.env.NEXT_PUBLIC_STOREFRONT_URL!,
  channel: process.env.NEXT_PUBLIC_DEFAULT_CHANNEL!,
  authToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
  paymentHandlers: [new PrismPaymentHandler({
    apiUrl: process.env.PRISM_API_URL!,
    apiKey: process.env.PRISM_API_KEY!,
  })],
})
```

```ts
// src/app/api/ucp/checkout-sessions/route.ts
import { agenticCommerce } from "@/lib/agentic-commerce"
const { ucpRoutes } = agenticCommerce

export const POST = ucpRoutes.checkoutSessions
```

See the [`storefront/`](./storefront) directory for a complete reference integration with all routes.

## Architecture

These packages live in your storefront — not in the Saleor backend. They're a translation layer between agent protocols and Saleor's GraphQL API.

```
AI Agent  <-->  UCP/ACP Routes  <-->  Core Formatters  <-->  Saleor GraphQL API
                  (nextjs)              (core)
                                          |
                                    Payment Handler
                                     (prism-payment)
```

This is intentional. Agent-facing endpoints are a storefront concern: they need to live on the merchant's domain (for protocol discovery), and they don't modify Saleor's behavior — they just provide a new interface to it.

## Custom Payment Handlers

Prism is included for stablecoin payments, but you can implement any payment method by extending the `PaymentHandlerAdapter` interface:

```ts
import type { PaymentHandlerAdapter } from "@financedistrict/saleor-agentic-commerce-core"

class MyPaymentHandler implements PaymentHandlerAdapter {
  // Implement discovery, checkout preparation, and settlement
}
```

## Protocol Compliance

Types and formatters are audited against the official protocol specifications:

- **UCP** [`2026-04-08`](https://github.com/Universal-Commerce-Protocol/ucp) — checkout, fulfillment, payment, order, discovery
- **ACP** [`2026-01-30`](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/spec/2026-01-30) — checkout sessions, delegate payment, capabilities

## Development

```bash
pnpm install
pnpm build
```

## License

MIT
