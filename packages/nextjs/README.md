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
  ucpVersion?: string,         // Current UCP version (default: UCP_VERSION, the latest, "2026-08-25")
  ucpSupportedVersions?: string[],  // Extra UCP versions (default: every other known version)
  ucpVersionNegotiation?: "lenient" | "strict",  // default: "lenient"
  acpVersion?: string,         // ACP version (default: "2026-01-30")
  acpApiKey?: string,          // Bearer key every ACP request must present; with none set, ACP refuses all requests
  paymentHandlers?: PaymentHandlerAdapter[],  // Payment handler adapters
  paymentReplayStore?: PaymentReplayStore,     // Required outside development and test
})
```

### ACP access

ACP routes accept only `Authorization: Bearer <acpApiKey>`, compared in
constant time. With no `acpApiKey` (or an empty one) every ACP route answers
401. The App's `/api/config-public` does not return the key set in the App
dashboard; pass the same value as `acpApiKey` here, or set `acpEnabled: false`.

### Order reads

`POST /api/ucp/checkout-sessions` returns a `UCP-Session-Secret` header once.
Only its SHA-256 hash is stored, in checkout metadata, and Saleor carries it to
the order. `GET /api/ucp/orders/{id}` needs that header: without it the answer
is 401, and with a wrong secret, or for an order whose checkout never had one,
it is 404. The `UCP-Agent` profile header identifies no one. If the hash cannot
be stored, creation answers 503 and no secret is handed out.

### Quote lifetime

Every quote is stamped with the time it was made and is good for 15 minutes.
Completing with an older quote answers 409 `payment_quote_expired`; an update to
the checkout makes a fresh one. A quote with no readable timestamp is treated as
missing. A payment already taken is never held back because its quote aged out.

### Payment replay store

Before a payment is submitted to its gateway, the settle path asks the payment
handler for the keys that identify the payment (for Prism: the signed
authorization's network, asset, payer and nonce) and claims them for the
checkout. A key held by another checkout stops the request with
`payment_already_used` and nothing is submitted. A handler that declares no keys
is refused with `settled_payment_unchecked` before anything is submitted. `settlementKeys` is a
required method of `PaymentHandlerAdapter`: handlers written against earlier releases need it,
and TypeScript fails to compile without it. After
the gateway settles, the settlement reference and the keys the handler reports
(for Prism: the transaction hash) are claimed as well.

`claim(keys, checkoutId)` must be atomic: claim every key or none, and succeed
again when the same checkout claims its own keys. `claimedBy(checkoutId)` returns
every key the checkout has claimed. Back both with a durable table shared by
every storefront instance, for example Postgres with a primary key on `key` and
an index on the checkout id, or Redis `SET NX` plus a set per checkout. A store
that loses claims also loses the ability to finish a settlement whose record
could not be saved.

`createAgenticCommerce()` throws when no store is passed and `NODE_ENV` is not
`development` or `test`. In development and test it falls back to
`createMemoryPaymentReplayStore()`, which only protects one process.

```ts
import type { PaymentReplayStore } from "@financedistrict/saleor-agentic-commerce-core"

const paymentReplayStore: PaymentReplayStore = {
  async claim(keys, checkoutId) {
    return db.claimPaymentKeys(keys, checkoutId)
  },
  async claimedBy(checkoutId) {
    return db.paymentKeysClaimedBy(checkoutId)
  },
}
```

### Settlement states

The settle path records its progress on the checkout, in the private metadata key
`agentic_commerce__settlement`, before it submits a payment:

| State | Meaning | Next `complete` |
|---|---|---|
| `pending` | The payment is about to be, or was, submitted and no result is recorded. | If the store holds the settlement reference for the checkout, finishes the order from it without calling the gateway. Otherwise 409 `settlement_pending`; the payment is not submitted again. |
| `settled` | The gateway settled the payment. A record without a state counts as settled. | Creates the transaction and completes the order. |
| `held` | The payment settled but cannot be accepted (`settled_payment_mismatch`, `settled_payment_unchecked` or `payment_already_used`). | The same 409; nothing is submitted. |
| `failed` | The gateway clearly declined the payment. The record keeps the amount that was about to be submitted. | Submits again, unless the store already holds a settlement reference for the checkout; then finishes the order from it at the recorded amount. A `failed` record without an amount gets 409 `settlement_pending` in that case. |

A failure whose outcome is unknown (timeout, network error, an unreadable reply or
a handler that does not say) leaves the checkout `pending`. Only a clear decline
makes it `failed`. Handlers report this with `outcome: "declined" | "unknown"` on a
failed settle result; a missing outcome counts as unknown.

`failed` is written only when the gateway answers clearly. How the Prism handler sorts
HTTP replies into declined and unknown is an assumption that has not been tried against a
real gateway. For a scheme whose authorization has no one-time nonce on chain, two
parallel completes of the same checkout are not safe, because reading the record back
only narrows the window.

| Code | Status | Meaning |
|---|---|---|
| `settlement_pending` | 409 | A submitted payment has no recorded result, the pending record could not be read back after three tries, or the store holds a settlement that no record accounts for. Nothing is submitted again. |
| `settlement_in_progress` | 409 | Another request is settling the same checkout, or already settled it while this request was declined. Retry shortly. The check reads the record back after writing it, which narrows the window but is not a lock. |
| `settlement_not_started` | 422 | The pending record could not be saved, so the payment was not submitted. Retry. |
| `payment_amount_mismatch` | 422 | The handler declared an amount other than the quote, so nothing was submitted. |
| `settlement_not_recorded` | 422 | The payment settled but the record could not be saved after three tries. Retry; the order is finished from the claimed reference. |
| `payment_expired` | 422 | The signed authorization has expired. Sign a new payment. |

Before a payment is submitted, the amount the handler declares it will settle must equal the
quote that was checked against the checkout total. A recovered or staff-resolved settlement is
recorded at that amount.

#### Resolving a pending or held settlement

The plugin does not look anything up on a chain or at a gateway. A person does, with
the facts the plugin recorded. `pending` and `held` records in the checkout's private
metadata carry `attemptId`, `startedAt`, `expiresAt` (the authorization's `validBefore`),
`handlerId`, `reference` (held only) and the handler's `details`. For Prism the details are
`network`, `asset`, `payer`, `nonce` and `validBefore`. No signature is stored. The same
facts are logged once, as one `console.error` line containing `settlement pending needs review`
or `settlement held needs review` and the `checkoutId`, when a checkout enters either state.

A `pending` checkout is finished automatically when the store holds the settlement
reference for it. Otherwise look the payment up by hand:

1. Open the block explorer of the `network` and the token contract at `asset`.
2. Look for an `AuthorizationUsed` event on that token with `authorizer` = `payer` and `nonce` = the recorded nonce.
3. Decide:
   - The event exists: the payment settled. Take the transaction hash and run `resolvePendingSettlement(agenticCommerce, checkoutId, { settled: true, reference: transactionHash })`. The next `complete` creates the transaction and the order.
   - No event, and the time is after `validBefore`: the authorization can no longer settle. Run `resolvePendingSettlement(agenticCommerce, checkoutId, { settled: false })`. The next `complete` submits again (the agent has to sign a new payment, since the old one has expired).
   - No event, and the time is before `validBefore`: wait. The payment may still settle.
   - Never resolve as not settled when the nonce has been used, or while the payment may still settle: the buyer would pay twice.

A `held` checkout means the gateway settled the payment (`reference`) but the settlement cannot be accepted (see `code` and `reason`). It is never submitted again and the order is not placed. Check the reference at the explorer, then refund the buyer or place the order by hand in Saleor.

```ts
import { resolvePendingSettlement } from "@financedistrict/saleor-agentic-commerce-nextjs"
import { agenticCommerce } from "./lib/agentic-commerce"

const result = await resolvePendingSettlement(agenticCommerce, checkoutId, { settled: true, reference: transactionHash })
if (!result.ok) throw new Error(`${result.code}: ${result.error}`)
```

Export the instance from the config file as `agenticCommerce` and run this from a script with the same configuration as the storefront. It is not exposed over HTTP.

## UCP versions

The store serves `ucpVersion` (default: the latest, `2026-08-25`) and every version in `ucpSupportedVersions`. `/.well-known/ucp` lists the extra versions under `ucp.supported_versions`, each linking to `/.well-known/ucp/<version>` (wire the `discoveryVersion` route shown above).

Each request picks its version from the agent profile named in the `UCP-Agent` header (`ucp.version`). The profile is fetched over HTTPS only, from public addresses, with a 3 s timeout, a 128 KiB cap and a 10 minute cache.

| Agent profile | `lenient` (default) | `strict` |
|---|---|---|
| no `UCP-Agent` header | current version | current version |
| `UCP-Agent` without `profile=` | current version | current version |
| unreachable | current version + warning | 424 `profile_unreachable` |
| no or malformed `ucp.version` | current version + warning | 422 `profile_malformed` |
| unknown version | 422 `version_unsupported` | 422 `version_unsupported` |
| known version that is not enabled | 422 `version_unsupported` | 422 `version_unsupported` |
| enabled version | that version | that version |

Lenient negotiation is a deliberate deviation from the UCP spec, which asks for a hard error: agents without a reachable profile keep working on the current version. A checkout session created by a matched agent keeps its version; another matched version on the same session answers 422, a fallback outcome serves the session version. Sessions created before this release are never pinned. Warnings are logged as one JSON line with the key `ucp_profile_resolution`.

An unknown value in `ucpVersion`, `ucpSupportedVersions` or `ucpVersionNegotiation` makes `createAgenticCommerce` throw at boot.

When `ucpSupportedVersions` is omitted, every known version other than `ucpVersion` stays enabled, so `ucpVersion: "2026-04-08"` alone keeps `2026-08-25` and `2026-01-23` available. Stores upgrading from releases that served `2026-04-08` set `ucpVersion: "2026-04-08"` to keep that root profile. The integration needs the Node.js runtime; the Edge runtime is not supported.

## Middleware

UCP header parsing utilities for custom route handling:

```ts
import { parseUcpHeaders, validateUcpHeaders } from "@financedistrict/saleor-agentic-commerce-nextjs/middleware/ucp-headers"

const headers = parseUcpHeaders(request)
// { agentProfile, requestId, idempotencyKey, contentDigest }
```

## License

MIT
