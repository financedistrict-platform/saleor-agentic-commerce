# @financedistrict/saleor-agentic-commerce-nextjs

Drop-in Next.js App Router route handlers that expose your [Saleor](https://saleor.io/) storefront to AI shopping agents via [UCP](https://ucp.dev/) and [ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol).

One config file, a few one-line route files, and your store is agent-ready. Zero runtime dependencies.

Part of the [Saleor Agentic Commerce](https://github.com/financedistrict-platform/saleor-agentic-commerce) SDK.

## Installation

```bash
npm install @financedistrict/saleor-agentic-commerce-core @financedistrict/saleor-agentic-commerce-nextjs
```

## Peer Dependencies

- `@financedistrict/saleor-agentic-commerce-core` ^0.2.0
- `next` >= 14.0.0

## Quick Start

### 1. Create the config

```ts
// src/lib/agentic-commerce.ts
import { createAgenticCommerce, createUcpRoutes, createAcpRoutes } from "@financedistrict/saleor-agentic-commerce-nextjs"

const agenticCommerce = createAgenticCommerce({
  saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
  saleorAuthToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
  storefrontUrl: process.env.NEXT_PUBLIC_STOREFRONT_URL!,
  storeName: process.env.SALEOR_AGENTIC_STORE_NAME!,
  channel: process.env.NEXT_PUBLIC_DEFAULT_CHANNEL,
  // paymentHandlers: [new PrismPaymentHandler({ ... })],
})

export const ucpRoutes = createUcpRoutes(agenticCommerce)
export const acpRoutes = createAcpRoutes(agenticCommerce)
```

### 2. Wire up route handlers

Each route file is a one-liner:

**UCP Routes**

```
src/app/api/ucp/
├── checkout-sessions/
│   ├── route.ts                    → POST (create)
│   └── [id]/
│       ├── route.ts                → GET (read), PUT (update)
│       ├── complete/route.ts       → POST
│       └── cancel/route.ts         → POST
└── orders/
    └── [id]/route.ts               → GET
```

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

**ACP Routes**

```
src/app/api/acp/
└── checkout_sessions/
    ├── route.ts                    → POST (create)
    └── [id]/
        ├── route.ts                → GET (read), POST (update)
        ├── complete/route.ts       → POST
        └── cancel/route.ts         → POST
```

```ts
// src/app/api/acp/checkout_sessions/route.ts
import { acpRoutes } from "@/lib/agentic-commerce"
export const { POST } = acpRoutes.checkoutSessions

// src/app/api/acp/checkout_sessions/[id]/route.ts
import { acpRoutes } from "@/lib/agentic-commerce"
export const { GET, POST } = acpRoutes.checkoutSession

// src/app/api/acp/checkout_sessions/[id]/complete/route.ts
import { acpRoutes } from "@/lib/agentic-commerce"
export const { POST } = acpRoutes.checkoutSessionComplete

// src/app/api/acp/checkout_sessions/[id]/cancel/route.ts
import { acpRoutes } from "@/lib/agentic-commerce"
export const { POST } = acpRoutes.checkoutSessionCancel
```

### 3. Verify

```bash
curl http://localhost:3000/.well-known/ucp
```

## Configuration

```ts
createAgenticCommerce({
  // Required
  saleorApiUrl: string,        // Saleor GraphQL endpoint
  saleorAuthToken: string,     // App token (MANAGE_CHECKOUTS + MANAGE_ORDERS + HANDLE_PAYMENTS)
  storefrontUrl: string,       // Public storefront URL
  storeName: string,           // Store name for discovery profiles

  // Optional
  channel?: string,            // Saleor channel slug (default: "default-channel")
  storeDescription?: string,   // Store description for discovery
  ucpVersion?: string,         // UCP version (default: "2026-04-08")
  acpVersion?: string,         // ACP version (default: "2026-01-30")
  acpApiKey?: string,          // API key for ACP Bearer token auth
  paymentHandlers?: PaymentHandlerAdapter[],  // Payment handler adapters
})
```

## Middleware

UCP header parsing utilities for custom route handling:

```ts
import { parseUcpHeaders, validateUcpHeaders } from "@financedistrict/saleor-agentic-commerce-nextjs/middleware/ucp-headers"

const headers = parseUcpHeaders(request)
// { agentProfile, requestId, idempotencyKey, contentDigest }
```

## License

MIT
