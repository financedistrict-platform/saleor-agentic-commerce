---
name: add-payment-handler
description: Add a payment handler to an existing Saleor Agentic Commerce setup. Supports Prism stablecoin payments (USDC via x402/EIP-3009). Use after setup-agentic-commerce.
argument-hint: [handler-name]
allowed-tools: Read Write Edit Bash Glob Grep
---

# Add Payment Handler

You are helping a developer add a payment handler to their existing Saleor Agentic Commerce integration. This enables AI agents to pay for purchases using supported payment methods.

## Pre-flight

1. **Verify SDK is installed** — Check `package.json` for `@financedistrict/saleor-agentic-commerce-core`. If not found, tell the developer to run `/setup-agentic-commerce` first.
2. **Find the agentic-commerce config file** — Search for the file that calls `createAgenticCommerce()`. Likely at `src/lib/agentic-commerce.ts` or similar.
3. **Determine which handler** — If `$ARGUMENTS` is empty or "prism", use Prism. Otherwise explain that Prism is currently the only supported handler.

## Prism Payment Handler (Stablecoin Payments)

### What it does

Prism enables AI agents to pay with USDC and other stablecoins using x402/EIP-3009 signed authorization transfers. The agent signs an EIP-3009 `transferWithAuthorization` message, the SDK forwards it to the Prism Gateway, and Prism settles it on-chain.

### Step 1: Install the Prism package

Detect the package manager from the lockfile and use the correct command:

```bash
npm install @financedistrict/saleor-prism-payment
```

### Step 2: Update the SDK configuration

Read the existing agentic-commerce config file and add the Prism handler:

```typescript
import { createAgenticCommerce } from "@financedistrict/saleor-agentic-commerce-nextjs"
import { PrismPaymentHandler } from "@financedistrict/saleor-prism-payment"

export const agenticCommerce = createAgenticCommerce({
  // ... existing config ...
  paymentHandlers: [
    new PrismPaymentHandler({
      apiUrl: process.env.PRISM_API_URL,
      apiKey: process.env.PRISM_API_KEY,
    }),
  ],
})
```

**Important:** Don't overwrite the existing config — only add the `paymentHandlers` array and the import. Keep all existing properties.

### Step 3: Add environment variables

Append to `.env.local` and `.env.example` (if it exists):

```bash
# ─── Prism Payment (Stablecoin via x402) ────────────────
PRISM_API_URL=https://prism-gw.fd.xyz    # Prism Gateway URL
PRISM_API_KEY=                             # Your Prism API key (get from developers.fd.xyz/prism)
```

### Step 4: Verify

Show the developer:

1. What was changed (the config file diff).
2. The new env vars that need values.
3. How to get a Prism API key: Visit https://developers.fd.xyz/prism
4. How agents will pay:
   - Agent discovers payment methods via `GET /api/ucp` → sees `xyz.fd.prism_payment` in `payment_handlers`
   - Agent creates checkout, then submits a signed EIP-3009 authorization to the complete endpoint
   - Prism settles the stablecoin transfer on-chain
   - Order is confirmed

## Other Payment Handlers

If the developer asks about other payment handlers:

- **Stripe** — Not yet available. The SDK's `PaymentHandlerAdapter` interface supports any payment provider. A Stripe adapter could be built by implementing `prepareCheckoutPayment()` and `settlePayment()`.
- **Custom** — Point to the `PaymentHandlerAdapter` interface in `@financedistrict/saleor-agentic-commerce-core`. It requires: `id`, `getUcpDiscoveryHandlers()`, `getAcpDiscoveryHandlers()`, `prepareCheckoutPayment()`, `settlePayment()`.
