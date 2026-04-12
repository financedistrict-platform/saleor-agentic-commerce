# @financedistrict/saleor-prism-payment

Stablecoin payment handler for [Saleor Agentic Commerce](https://github.com/financedistrict-platform/saleor-agentic-commerce). Enables AI agents to pay with USDC and other stablecoins via [Finance District Prism](https://developers.fd.xyz/prism) using x402/EIP-3009 signed transfers.

Zero runtime dependencies.

## Installation

```bash
npm install @financedistrict/saleor-agentic-commerce-core @financedistrict/saleor-prism-payment
```

## Peer Dependencies

- `@financedistrict/saleor-agentic-commerce-core` ^0.2.0

## Usage

### With the Next.js package (recommended)

```ts
// src/lib/agentic-commerce.ts
import { createAgenticCommerce } from "@financedistrict/saleor-agentic-commerce-nextjs"
import { PrismPaymentHandler } from "@financedistrict/saleor-prism-payment"

const agenticCommerce = createAgenticCommerce({
  saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
  saleorAuthToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
  storefrontUrl: process.env.NEXT_PUBLIC_STOREFRONT_URL!,
  storeName: process.env.SALEOR_AGENTIC_STORE_NAME!,
  paymentHandlers: [
    new PrismPaymentHandler({
      apiUrl: process.env.PRISM_API_URL,
      apiKey: process.env.PRISM_API_KEY,
    }),
  ],
})
```

### Standalone

```ts
import { PrismPaymentHandler } from "@financedistrict/saleor-prism-payment"

const prism = new PrismPaymentHandler({
  apiUrl: "https://prism-gw.fd.xyz",
  apiKey: "your-api-key",
})

// Discovery — what payment methods this handler supports
const ucpHandlers = prism.getUcpDiscoveryHandlers()
const acpHandlers = prism.getAcpDiscoveryHandlers()

// Prepare — create a payment session for a checkout
const prepared = await prism.prepareCheckoutPayment({
  checkoutId: "checkout_123",
  amount: 5000,      // $50.00 in minor units
  currency: "usd",
  metadata: {},
})

// Settle — submit the agent's signed payment credential
const result = await prism.settlePayment({
  checkoutId: "checkout_123",
  handlerId: "xyz.fd.prism_payment",
  amount: 5000,
  currency: "usd",
  credential: { type: "x402", token: "signed-eip3009-authorization" },
  metadata: {},
})
```

## Configuration

```ts
new PrismPaymentHandler({
  apiUrl?: string,   // Prism Gateway URL (default: PRISM_API_URL env or "https://prism-gw.fd.xyz")
  apiKey?: string,   // Prism API key (default: PRISM_API_KEY env)
})
```

## How it works

1. **Discovery** — The handler registers itself in UCP/ACP profiles with `id: "xyz.fd.prism_payment"`, advertising x402 stablecoin payment support
2. **Prepare** — When an agent selects Prism as their payment method, the handler calls the Prism Gateway to create a payment session and stores the session config in Saleor's checkout metadata
3. **Settle** — When the agent submits a signed EIP-3009 authorization, the handler forwards it to the Prism Gateway for on-chain settlement

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PRISM_API_URL` | Prism Gateway base URL | `https://prism-gw.fd.xyz` |
| `PRISM_API_KEY` | Prism API key for authentication | — |

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `PrismPaymentHandler` | class | Payment handler adapter for Prism |
| `PrismClient` | class | Low-level Prism Gateway API client |
| `PRISM_HANDLER_ID` | const | Handler identifier (`"xyz.fd.prism_payment"`) |
| `PRISM_CHECKOUT_CONFIG_KEY` | const | Metadata key for storing checkout config |

## License

MIT
