---
name: setup-agentic-commerce
description: Install and configure Saleor Agentic Commerce SDK in a Next.js storefront. Use when a developer wants to make their Saleor store shoppable by AI agents via UCP/ACP protocols.
argument-hint: [saleor-api-url]
allowed-tools: Read Write Edit Bash Glob Grep
---

# Set Up Saleor Agentic Commerce

You are helping a developer add AI agent commerce support to their Saleor storefront. The SDK enables AI shopping agents to discover products, create checkouts, and complete purchases through UCP (Universal Commerce Protocol) and ACP (Agentic Commerce Protocol) endpoints.

The route handlers are produced by the SDK's `createUcpRoutes()` / `createAcpRoutes()` factories — you do **not** hand-write handlers or call the formatters directly. Each route file is a one-line re-export of a factory-produced handler. This is the only supported wiring; hand-rolled handlers drift out of sync with the SDK.

## Pre-flight Checks

Before starting, verify the project:

1. **Confirm it's a Next.js project** — Look for `next.config.js`/`next.config.mjs` and `next` in `package.json`.
2. **Confirm Saleor integration exists** — Look for `SALEOR_API_URL` or `NEXT_PUBLIC_SALEOR_API_URL` in `.env*`, or `@saleor/*` in `package.json`.
3. **Check Next.js version** — Must be >=14. (If it's Next.js 16 with `cacheComponents`/PPR, the lazy wiring in Step 2 is required — it's included below.)
4. **Check App Router is used** — Look for `src/app/` or `app/`. The SDK uses App Router route handlers.

If the SDK is already installed (`@financedistrict/saleor-agentic-commerce-core` in `package.json`), skip to configuration and ask what needs changing.

## Step 1: Install Packages

```bash
npm install @financedistrict/saleor-agentic-commerce-core @financedistrict/saleor-agentic-commerce-nextjs
```

Detect pnpm (`pnpm-lock.yaml`) or yarn (`yarn.lock`) from the lockfile and use the matching command.

## Step 2: Create the SDK Instance + Route Bundles

Create `src/lib/agentic-commerce.ts` (make `src/lib/` if needed; if the project uses root-level `lib/`, put it there and adjust the `@/` alias accordingly).

`createAgenticCommerce()` is **async** and validates required config at construction, so it must not run at module top-level — Next.js's build-time route analysis would invoke it before runtime secrets exist. Defer construction to first request with a lazy proxy:

```typescript
import { connection } from "next/server"
import {
  createAgenticCommerce,
  createUcpRoutes,
  createAcpRoutes,
  type AgenticCommerceInstance,
} from "@financedistrict/saleor-agentic-commerce-nextjs"

type UcpRouteHandlers = ReturnType<typeof createUcpRoutes>
type AcpRouteHandlers = ReturnType<typeof createAcpRoutes>

type Bundle = {
  agenticCommerce: AgenticCommerceInstance
  ucpRoutes: UcpRouteHandlers
  acpRoutes: AcpRouteHandlers
}

let cached: Bundle | undefined
let cachedPromise: Promise<Bundle> | undefined

async function buildBundle(): Promise<Bundle> {
  const ac = await createAgenticCommerce({
    saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
    saleorAuthToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
    storefrontUrl: process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000",
    storeName: process.env.SALEOR_AGENTIC_STORE_NAME,
    storeDescription: process.env.SALEOR_AGENTIC_STORE_DESCRIPTION,
    channel: process.env.NEXT_PUBLIC_DEFAULT_CHANNEL || "default-channel",
    // Payment handlers are added by `/add-payment-handler` (it inserts a
    // paymentHandlerFactory here). With none, the store is agent-browsable
    // and can create/cancel checkouts, but cannot complete a payment yet.
  })
  return { agenticCommerce: ac, ucpRoutes: createUcpRoutes(ac), acpRoutes: createAcpRoutes(ac) }
}

async function getBundle(): Promise<Bundle> {
  if (cached) return cached
  if (cachedPromise) return cachedPromise
  cachedPromise = buildBundle()
  try {
    cached = await cachedPromise
    return cached
  } finally {
    cachedPromise = undefined
  }
}

// Two-level proxy: reading `ucpRoutes.discovery` and destructuring `GET` never
// constructs the SDK — only *calling* the handler does (at request time, after
// `await connection()` marks the route dynamic under Next 16 PPR).
function lazyRoutes<T extends Record<string, Record<string, (...a: any[]) => any>>>(
  pick: (b: Bundle) => T,
): T {
  return new Proxy({} as T, {
    get(_t, groupKey) {
      return new Proxy({} as any, {
        get(_t2, methodKey) {
          return async function lazyHandler(...args: any[]) {
            await connection()
            const bundle = await getBundle()
            const group = pick(bundle)[groupKey as keyof T] as Record<string, (...a: any[]) => any>
            return group[methodKey as string]!.apply(group, args)
          }
        },
      })
    },
  })
}

export const ucpRoutes: UcpRouteHandlers = lazyRoutes((b) => b.ucpRoutes)
export const acpRoutes: AcpRouteHandlers = lazyRoutes((b) => b.acpRoutes)
```

**Match the project's env var names.** If it uses `SALEOR_API_URL` (no `NEXT_PUBLIC_`), use that.

If the project is Next.js <=15 (no `cacheComponents`), the `await connection()` line is a harmless no-op; keep it for forward-compatibility.

## Step 3: Create UCP Route Handlers (thin re-exports)

Each file re-exports a factory-produced handler. Route paths are fixed by the UCP spec — use exactly these (note `checkout-sessions`, and `.well-known/ucp`):

```typescript
// src/app/.well-known/ucp/route.ts
export const { GET } = ucpRoutes.discovery
// (add: import { ucpRoutes } from "@/lib/agentic-commerce")
```

Create these files, each importing `{ ucpRoutes }` from `@/lib/agentic-commerce`:

| File | Re-export |
|---|---|
| `src/app/.well-known/ucp/route.ts` | `export const { GET } = ucpRoutes.discovery` |
| `src/app/api/ucp/checkout-sessions/route.ts` | `export const { POST } = ucpRoutes.checkoutSessions` |
| `src/app/api/ucp/checkout-sessions/[id]/route.ts` | `export const { GET, PUT } = ucpRoutes.checkoutSession` |
| `src/app/api/ucp/checkout-sessions/[id]/complete/route.ts` | `export const { POST } = ucpRoutes.checkoutSessionComplete` |
| `src/app/api/ucp/checkout-sessions/[id]/cancel/route.ts` | `export const { POST } = ucpRoutes.checkoutSessionCancel` |
| `src/app/api/ucp/orders/[id]/route.ts` | `export const { GET } = ucpRoutes.order` |
| `src/app/api/ucp/catalog/search/route.ts` | `export const { POST } = ucpRoutes.catalogSearch` |
| `src/app/api/ucp/catalog/lookup/route.ts` | `export const { POST } = ucpRoutes.catalogLookup` |

Example (`src/app/api/ucp/checkout-sessions/route.ts`):

```typescript
import { ucpRoutes } from "@/lib/agentic-commerce"
export const { POST } = ucpRoutes.checkoutSessions
```

(ACP is optional. If wanted, add `.well-known/acp.json` + `api/acp/...` re-exports from `acpRoutes` — see the SDK README.)

## Step 4: Environment Variables

Add to `.env.local` (or whichever `.env*` the project uses); mirror into `.env.example` if present:

```bash
# ─── Agentic Commerce (AI Agent Shopping) ───────────────
SALEOR_AGENTIC_AUTH_TOKEN=        # Saleor App token — see permissions below
SALEOR_AGENTIC_STORE_NAME=        # Store name shown to AI agents
SALEOR_AGENTIC_STORE_DESCRIPTION= # Optional
NEXT_PUBLIC_STOREFRONT_URL=       # Public URL of this storefront
```

**`SALEOR_AGENTIC_AUTH_TOKEN` is a Saleor App token** (not a user token), created in Dashboard → Apps. It needs:

- **`MANAGE_CHECKOUTS`** — create/update checkouts
- **`MANAGE_ORDERS`** — complete checkouts into orders
- **`HANDLE_PAYMENTS`** — **required**: `transactionCreate` (called when a payment settles) is gated on it. Without it, a payment settles and then the order creation fails, leaving the buyer charged with no order. Do not omit it.

## Step 5: Verify Setup

Show the developer the route tree:

```
src/app/
├── .well-known/ucp/route.ts                          GET  /.well-known/ucp
└── api/ucp/
    ├── checkout-sessions/route.ts                    POST /api/ucp/checkout-sessions
    ├── checkout-sessions/[id]/route.ts               GET,PUT /api/ucp/checkout-sessions/:id
    ├── checkout-sessions/[id]/complete/route.ts      POST .../:id/complete
    ├── checkout-sessions/[id]/cancel/route.ts        POST .../:id/cancel
    ├── orders/[id]/route.ts                          GET  /api/ucp/orders/:id
    └── catalog/{search,lookup}/route.ts              POST /api/ucp/catalog/*
```

Then:

```bash
npm run dev
curl http://localhost:3000/.well-known/ucp | jq .   # discovery profile
curl -X POST http://localhost:3000/api/ucp/catalog/search -d '{"query":"shirt"}' | jq .
```

Discovery should return a `ucp` object; `payment_handlers` will be `{}` until you add one.

**Next steps:**
- Run `/add-payment-handler` to add stablecoin payments via Prism (inserts the `paymentHandlerFactory`).
- SDK docs: https://github.com/financedistrict-platform/saleor-agentic-commerce

## Error Handling

- **`Module not found`** after install → check the `@/` alias matches the project's tsconfig paths.
- **`saleorAuthToken is required` at build time** → construction leaked to module top-level; ensure the lazy proxy in Step 2 is used (don't call `createAgenticCommerce` at the top level).
- **Build errors in route handlers** → ensure App Router (not Pages Router).
- **Payment settles but no order / `transaction_create_failed`** → the App token is missing `HANDLE_PAYMENTS` (Step 4).
- **`next` too old** → SDK requires Next.js 14+.
