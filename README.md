# Saleor Agentic Commerce

Make your Saleor store shoppable by AI agents.

This SDK adds [UCP](https://ucp.dev/) and [ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) protocol endpoints to your existing Next.js storefront, so AI shopping agents can discover your products, create checkouts, and complete purchases — without any changes to your Saleor backend.

## Why this matters

AI agents are becoming the next commerce channel. Just like merchants once added mobile apps alongside their websites, they'll soon need to serve autonomous agents that shop on behalf of consumers. But agents don't browse — they need structured APIs with standardized discovery, checkout flows, and payment settlement.

**UCP** (Universal Commerce Protocol) and **ACP** (Agentic Commerce Protocol) are the emerging open standards for this. This SDK implements both, so your Saleor store speaks the language agents understand.

## What you get

- **Agent discovery** — A `.well-known/ucp` profile that tells agents what your store supports, which payment methods are available, and where the API lives
- **Checkout sessions** — Agents can create carts, set shipping addresses, select delivery options, and complete purchases through protocol-compliant endpoints
- **Pluggable payments** — Ships with [Finance District Prism](https://financedistrict.xyz) for stablecoin payments (x402/EIP-3009), or implement your own payment handler
- **No backend changes** — Everything runs in your Next.js storefront layer, consuming the same Saleor GraphQL API your storefront already uses
- **Zero runtime dependencies** — The packages add no transitive dependencies to your project

## Packages

| Package | What it does |
|---------|-------------|
| [`@financedistrict/saleor-agentic-commerce-core`](./packages/core) | Protocol types, Saleor-to-protocol formatters, payment handler interface |
| [`@financedistrict/saleor-agentic-commerce-nextjs`](./packages/nextjs) | Ready-made Next.js App Router route handlers for UCP and ACP |
| [`@financedistrict/saleor-prism-payment`](./packages/prism-payment) | Prism payment handler — stablecoin settlement via x402/EIP-3009 |

## Installation

```bash
# npm
npm install @financedistrict/saleor-agentic-commerce-core \
            @financedistrict/saleor-agentic-commerce-nextjs \
            @financedistrict/saleor-prism-payment

# pnpm
pnpm add @financedistrict/saleor-agentic-commerce-core \
         @financedistrict/saleor-agentic-commerce-nextjs \
         @financedistrict/saleor-prism-payment

# yarn
yarn add @financedistrict/saleor-agentic-commerce-core \
         @financedistrict/saleor-agentic-commerce-nextjs \
         @financedistrict/saleor-prism-payment
```

> If you don't need stablecoin payments, skip `@financedistrict/saleor-prism-payment` and implement your own payment handler (see [Custom Payment Handlers](#custom-payment-handlers)).

## Quick Start

### 1. Environment variables

Add these to your `.env`:

```env
# Saleor (you likely already have these)
NEXT_PUBLIC_SALEOR_API_URL=https://your-instance.saleor.cloud/graphql/
NEXT_PUBLIC_STOREFRONT_URL=https://your-store.com
NEXT_PUBLIC_DEFAULT_CHANNEL=default-channel

# Agentic Commerce
SALEOR_AGENTIC_AUTH_TOKEN=your-saleor-app-token    # Needs MANAGE_CHECKOUTS + MANAGE_ORDERS
SALEOR_AGENTIC_STORE_NAME=Your Store Name

# Prism Payment (optional — only if using stablecoin payments)
PRISM_API_URL=https://prism-gw.financedistrict.xyz
PRISM_API_KEY=your-prism-api-key
```

### 2. Create the agentic commerce instance

```ts
// src/lib/agentic-commerce.ts
import { createAgenticCommerce, createUcpRoutes, createAcpRoutes } from "@financedistrict/saleor-agentic-commerce-nextjs"
import { PrismPaymentHandler } from "@financedistrict/saleor-prism-payment"

const agenticCommerce = createAgenticCommerce({
  saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
  saleorAuthToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
  storefrontUrl: process.env.NEXT_PUBLIC_STOREFRONT_URL!,
  storeName: process.env.SALEOR_AGENTIC_STORE_NAME!,
  channel: process.env.NEXT_PUBLIC_DEFAULT_CHANNEL,
  paymentHandlers: [
    new PrismPaymentHandler({
      apiUrl: process.env.PRISM_API_URL,
      apiKey: process.env.PRISM_API_KEY,
    }),
  ],
})

export const ucpRoutes = createUcpRoutes(agenticCommerce)
export const acpRoutes = createAcpRoutes(agenticCommerce)
```

### 3. Wire up the route handlers

Each route file is a one-liner that re-exports from your agentic commerce instance:

```ts
// src/app/api/ucp/checkout-sessions/route.ts
import { ucpRoutes } from "@/lib/agentic-commerce"
export const { POST } = ucpRoutes.checkoutSessions

// src/app/api/ucp/checkout-sessions/[id]/route.ts
import { ucpRoutes } from "@/lib/agentic-commerce"
export const { GET, PUT } = ucpRoutes.checkoutSession

// src/app/api/ucp/checkout-sessions/[id]/complete/route.ts
import { ucpRoutes } from "@/lib/agentic-commerce"
export const { POST } = ucpRoutes.checkoutSessionComplete

// src/app/api/ucp/checkout-sessions/[id]/cancel/route.ts
import { ucpRoutes } from "@/lib/agentic-commerce"
export const { POST } = ucpRoutes.checkoutSessionCancel

// src/app/api/ucp/orders/[id]/route.ts
import { ucpRoutes } from "@/lib/agentic-commerce"
export const { GET } = ucpRoutes.order
```

ACP routes follow the same pattern with `acpRoutes`. See [`storefront/`](./storefront) for the complete reference integration.

### 4. Verify it works

Start your dev server and check the UCP discovery endpoint:

```bash
curl http://localhost:3000/.well-known/ucp
```

You should see a JSON response with your store's UCP profile, available services, and payment handlers.

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

class StripeAgentPaymentHandler implements PaymentHandlerAdapter {
  id = "com.stripe.agent_payment"

  // Return handler info for UCP/ACP discovery responses
  getUcpDiscoveryHandlers() { /* ... */ }
  getAcpDiscoveryHandlers() { /* ... */ }

  // Return handler info for individual checkout sessions
  getUcpCheckoutHandlers(metadata?) { /* ... */ }
  getAcpCheckoutHandlers(metadata?) { /* ... */ }

  // Prepare checkout — called when agent selects this handler
  prepareCheckoutPayment(input) { /* ... */ }

  // Settle — called when agent submits payment credential
  settlePayment(input) { /* ... */ }
}
```

## Protocol Compliance

Types and formatters are audited against the official protocol specifications:

- **UCP** [`2026-04-08`](https://github.com/Universal-Commerce-Protocol/ucp) — checkout, fulfillment, payment, order, discovery
- **ACP** [`2026-01-30`](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/spec/2026-01-30) — checkout sessions, delegate payment, capabilities

## Versioning

All three packages follow [semver](https://semver.org/). While pre-1.0:

- **Protocol spec changes** → all packages bump minor together (e.g., 0.2.x → 0.3.0)
- **Saleor API changes** → only `core` bumps patch (e.g., 0.2.0 → 0.2.1)
- **Payment handler changes** → only the affected handler package bumps

The `nextjs` and `prism-payment` packages declare `core` as a peer dependency with a `^` range (e.g., `^0.2.0`), so incompatible combinations are caught at install time.

## Requirements

- **Node.js** >= 20
- **Next.js** >= 14 (App Router)
- **Saleor** >= 3.x with a valid App Token (MANAGE_CHECKOUTS + MANAGE_ORDERS permissions)

## Development

```bash
git clone https://github.com/financedistrict-platform/saleor-agentic-commerce.git
cd saleor-agentic-commerce
pnpm install
pnpm build
```

## License

MIT
