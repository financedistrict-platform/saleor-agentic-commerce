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
const ucpHandlers = await prism.getUcpDiscoveryHandlers("2026-08-25")
const acpHandlers = await prism.getAcpDiscoveryHandlers("2026-08-25")

// Prepare — create a payment session for a checkout
const prepared = await prism.prepareCheckoutPayment({
  checkoutId: "checkout_123",
  amount: 5000,      // $50.00 in minor units (JPY 5000 = ¥5000, KWD 5000 = 5.000 KWD)
  currency: "usd",
  metadata: {},
})

// Settle — submit the agent's signed payment credential
const result = await prism.settlePayment({
  checkoutId: "checkout_123",
  protocol: "ucp",
  handlerId: "xyz.fd.prism_payment",
  instrumentType: "x402",
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
3. **Settle** — When the agent submits a signed EIP-3009 authorization, the handler declares the authorization (network, asset, payer, nonce) as the key of the payment and refuses it when its `validBefore` has passed. The storefront claims that key, then the handler forwards the authorization to the Prism Gateway for on-chain settlement. A reply that clearly declines the payment (an HTTP 4xx other than 408 and 409, or `success: false`) is reported as declined. A timeout, an HTTP 5xx, 408 or 409, or a reply that cannot be read is reported as unknown, and the checkout stays pending until it is resolved.

Discovery caches UCP responses per UCP version. Handler discovery puts the UCP version in the Prism path. Payment requirements come from the protocol-free `/api/v2/merchant/payment-requirements`; the handler places that x402 config under the `id` and `version` from discovery for the same UCP version. The handler also accepts the older Prism entry shape (`id: "x402"`, `config_schema`) and the instruments of earlier agents (`handler_id: "x402"`, `type` `tokenized`, `default` or missing, credential without `type`).

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
