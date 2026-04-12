---
name: setup-agentic-commerce
description: Install and configure Saleor Agentic Commerce SDK in a Next.js storefront. Use when a developer wants to make their Saleor store shoppable by AI agents via UCP/ACP protocols.
argument-hint: [saleor-api-url]
allowed-tools: Read Write Edit Bash Glob Grep
---

# Set Up Saleor Agentic Commerce

You are helping a developer add AI agent commerce support to their Saleor storefront. The SDK enables AI shopping agents to discover products, create checkouts, and complete purchases through UCP (Universal Commerce Protocol) and ACP (Agentic Commerce Protocol) endpoints.

## Pre-flight Checks

Before starting, verify the project:

1. **Confirm it's a Next.js project** — Look for `next.config.js` or `next.config.mjs` and `package.json` with `next` as a dependency.
2. **Confirm Saleor integration exists** — Look for `SALEOR_API_URL` or `NEXT_PUBLIC_SALEOR_API_URL` in `.env*` files, or `@saleor/*` packages in `package.json`.
3. **Check Next.js version** — Must be >=14. Read `package.json` to confirm.
4. **Check if App Router is used** — Look for `src/app/` or `app/` directory structure. The SDK uses App Router route handlers.

If any check fails, explain what's missing and what the developer needs first.

If the SDK packages are already installed (check `package.json` for `@financedistrict/saleor-agentic-commerce-core`), skip to the configuration step and ask what needs to be changed.

## Step 1: Install Packages

Install the core and Next.js packages:

```bash
npm install @financedistrict/saleor-agentic-commerce-core @financedistrict/saleor-agentic-commerce-nextjs
```

If the project uses pnpm or yarn, detect this from the lockfile (pnpm-lock.yaml → pnpm, yarn.lock → yarn) and use the correct command.

## Step 2: Create the SDK Instance

Create a configuration file. Detect the project's source directory structure first:
- If `src/lib/` exists → create `src/lib/agentic-commerce.ts`
- If `src/` exists but no `lib/` → create `src/lib/agentic-commerce.ts` (make the dir)
- If `lib/` exists at root → create `lib/agentic-commerce.ts`
- Otherwise → create `src/lib/agentic-commerce.ts`

**File contents:**

```typescript
import { createAgenticCommerce } from "@financedistrict/saleor-agentic-commerce-nextjs"

// If the Saleor Agentic Commerce App is installed in the Dashboard,
// use configFromApp: true to load config from the App's metadata.
// Otherwise, configure everything explicitly here.

export const agenticCommerce = createAgenticCommerce({
  saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
  saleorAuthToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
  storefrontUrl: process.env.NEXT_PUBLIC_STOREFRONT_URL!,
  storeName: process.env.SALEOR_AGENTIC_STORE_NAME!,
  storeDescription: process.env.SALEOR_AGENTIC_STORE_DESCRIPTION,
})
```

**Important:** Look at the project's existing env var naming patterns. If they use `NEXT_PUBLIC_SALEOR_API_URL`, match that. If they use `SALEOR_API_URL` (without `NEXT_PUBLIC_`), use that instead.

## Step 3: Create UCP Route Handlers

Create the following route handler files. Detect the app router root:
- `src/app/` or `app/` — whichever exists.

All routes go under `{app-root}/api/ucp/`.

### 3a. Discovery Profile — `api/ucp/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"
import { agenticCommerce } from "@/lib/agentic-commerce"
import { formatUcpProfile } from "@financedistrict/saleor-agentic-commerce-core"

export async function GET() {
  const profile = formatUcpProfile(agenticCommerce.formatterContext)

  return NextResponse.json(profile, {
    headers: { "X-UCP-Version": agenticCommerce.config.ucpVersion },
  })
}
```

### 3b. Create Checkout — `api/ucp/checkout/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"
import { agenticCommerce } from "@/lib/agentic-commerce"
import { formatUcpCheckoutSession } from "@financedistrict/saleor-agentic-commerce-core"

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { items, buyer } = body

  const lines = items.map((item: any) => ({
    variantId: item.variant_id || item.id,
    quantity: item.quantity,
  }))

  const result = await agenticCommerce.saleorClient.createCheckout({
    lines,
    email: buyer?.email,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: { message: result.error } },
      { status: 400 }
    )
  }

  const session = formatUcpCheckoutSession(
    result.data,
    agenticCommerce.formatterContext
  )

  return NextResponse.json(session, { status: 201 })
}
```

### 3c. Get/Update Checkout — `api/ucp/checkout/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"
import { agenticCommerce } from "@/lib/agentic-commerce"
import { formatUcpCheckoutSession } from "@financedistrict/saleor-agentic-commerce-core"

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await agenticCommerce.saleorClient.getCheckout(params.id)

  if (!result.ok) {
    return NextResponse.json(
      { error: { message: result.error } },
      { status: 404 }
    )
  }

  const session = formatUcpCheckoutSession(
    result.data,
    agenticCommerce.formatterContext
  )

  return NextResponse.json(session)
}
```

### 3d. Complete Checkout — `api/ucp/checkout/[id]/complete/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"
import { agenticCommerce } from "@/lib/agentic-commerce"
import { formatUcpCompleteResponse } from "@financedistrict/saleor-agentic-commerce-core"

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json()

  // Handle payment if credential provided
  if (body.payment?.credential) {
    const handler = agenticCommerce.paymentHandlers.getHandler(
      body.payment.credential.handler_id || body.payment.handler_id
    )
    if (handler) {
      await handler.settlePayment({
        checkoutId: params.id,
        handlerId: handler.id,
        amount: body.payment.amount,
        currency: body.payment.currency,
        credential: body.payment.credential,
        metadata: {},
      })
    }
  }

  const result = await agenticCommerce.saleorClient.completeCheckout(params.id)

  if (!result.ok) {
    return NextResponse.json(
      { error: { message: result.error } },
      { status: 400 }
    )
  }

  const response = formatUcpCompleteResponse(
    result.data,
    agenticCommerce.formatterContext
  )

  return NextResponse.json(response)
}
```

### 3e. Get Order — `api/ucp/orders/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"
import { agenticCommerce } from "@/lib/agentic-commerce"
import { formatUcpOrder } from "@financedistrict/saleor-agentic-commerce-core"

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await agenticCommerce.saleorClient.getOrder(params.id)

  if (!result.ok) {
    return NextResponse.json(
      { error: { message: result.error } },
      { status: 404 }
    )
  }

  const order = formatUcpOrder(result.data, agenticCommerce.formatterContext)

  return NextResponse.json(order)
}
```

## Step 4: Environment Variables

Add these to the project's `.env.local` (or `.env`). Check which env file the project uses.

Also update `.env.example` if it exists — append to the end under a clear section header.

```bash
# ─── Agentic Commerce (AI Agent Shopping) ───────────────
SALEOR_AGENTIC_AUTH_TOKEN=       # Saleor App Token with MANAGE_CHECKOUTS + MANAGE_ORDERS
SALEOR_AGENTIC_STORE_NAME=       # Store name shown to AI agents
SALEOR_AGENTIC_STORE_DESCRIPTION= # Optional store description
NEXT_PUBLIC_STOREFRONT_URL=       # Public URL of this storefront (e.g., https://store.com)
```

**Important:** `SALEOR_AGENTIC_AUTH_TOKEN` is a Saleor App Token — not a user token. The developer needs to create an App in Saleor Dashboard → Configuration → Service Accounts (or Apps) with `MANAGE_CHECKOUTS` and `MANAGE_ORDERS` permissions.

## Step 5: Verify Setup

After creating all files, show the developer:

1. The route structure created:
   ```
   api/ucp/
   ├── route.ts                    → GET  /api/ucp (discovery profile)
   └── checkout/
       ├── route.ts                → POST /api/ucp/checkout (create)
       └── [id]/
           ├── route.ts            → GET  /api/ucp/checkout/:id
           └── complete/
               └── route.ts        → POST /api/ucp/checkout/:id/complete
   api/ucp/orders/
       └── [id]/
           └── route.ts            → GET  /api/ucp/orders/:id
   ```

2. Required env vars that need values.

3. How to test:
   ```bash
   # Start the dev server
   npm run dev

   # Test the discovery endpoint
   curl http://localhost:3000/api/ucp | jq .
   ```

4. Next steps:
   - Run `/add-payment-handler` to add stablecoin payments via Prism
   - Visit the UCP spec: https://github.com/Universal-Commerce-Protocol/ucp
   - Read the full SDK docs: https://github.com/financedistrict-platform/saleor-agentic-commerce

## Error Handling

If you encounter issues during setup:
- **`Module not found`** after install → Check the import paths match the project's tsconfig paths (`@/` alias).
- **Build errors in route handlers** → Ensure the project uses App Router (not Pages Router).
- **`next` version too old** → SDK requires Next.js 14+. Suggest upgrading.
- **No Saleor env vars found** → The project may not be a Saleor storefront. Ask the developer to confirm.
