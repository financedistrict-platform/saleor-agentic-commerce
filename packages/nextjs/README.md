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
// src/app/.well-known/ucp/route.ts
import { ucpRoutes } from "@/lib/agentic-commerce"
export const { GET } = ucpRoutes.discovery

// src/app/.well-known/ucp/[version]/route.ts
import { ucpRoutes } from "@/lib/agentic-commerce"
export const { GET } = ucpRoutes.discoveryVersion

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
  ucpVersion?: string,         // Current UCP version (default: UCP_VERSION, "2026-04-08")
  ucpSupportedVersions?: string[],  // Extra UCP versions (default: ["2026-08-25", "2026-01-23"])
  ucpVersionNegotiation?: "lenient" | "strict",  // default: "lenient"
  acpVersion?: string,         // ACP version (default: "2026-01-30")
  acpApiKey?: string,          // API key for ACP Bearer token auth
  paymentHandlers?: PaymentHandlerAdapter[],  // Payment handler adapters
})
```

## UCP versions

The store serves `ucpVersion` (default `2026-04-08`) and every version in `ucpSupportedVersions`. `/.well-known/ucp` lists the extra versions under `ucp.supported_versions`, each linking to `/.well-known/ucp/<version>` (wire the `discoveryVersion` route shown above).

Each request picks its version from the agent profile named in the `UCP-Agent` header (`ucp.version`). The profile is fetched over HTTPS only, from public addresses, with a 3 s timeout, a 64 KiB cap and a 10 minute cache.

| Agent profile | `lenient` (default) | `strict` |
|---|---|---|
| no `UCP-Agent` header | current version | current version |
| unreachable | current version + warning | 424 `agent_profile_unavailable` |
| no or malformed `ucp.version` | current version + warning | 422 `version_unsupported` |
| unknown version | current version + warning | 422 `version_unsupported` |
| known version that is not enabled | 422 `version_unsupported` | 422 `version_unsupported` |
| enabled version | that version | that version |

Lenient negotiation is a deliberate deviation from the UCP spec, which asks for a hard error: agents without a reachable profile keep working on the current version. A checkout session created by a matched agent keeps its version; another matched version on the same session answers 422, a fallback outcome serves the session version. Sessions created before this release are never pinned. Warnings are logged as one JSON line with the key `ucp_profile_resolution`.

An unknown value in `ucpVersion`, `ucpSupportedVersions` or `ucpVersionNegotiation` makes `createAgenticCommerce` throw at boot.

## Middleware

UCP header parsing utilities for custom route handling:

```ts
import { parseUcpHeaders, validateUcpHeaders } from "@financedistrict/saleor-agentic-commerce-nextjs/middleware/ucp-headers"

const headers = parseUcpHeaders(request)
// { agentProfile, requestId, idempotencyKey, contentDigest }
```

## License

MIT
