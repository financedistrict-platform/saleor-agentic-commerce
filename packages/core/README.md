# @financedistrict/saleor-agentic-commerce-core

Core library for exposing [Saleor](https://saleor.io/) storefronts to AI shopping agents via [UCP](https://ucp.dev/) and [ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol).

Provides protocol types, Saleor-to-protocol formatters, the payment handler adapter interface, and a lightweight Saleor GraphQL client. Framework-agnostic — no runtime dependencies.

Part of the [Saleor Agentic Commerce](https://github.com/financedistrict-platform/saleor-agentic-commerce) SDK.

## Installation

```bash
npm install @financedistrict/saleor-agentic-commerce-core
```

Most users should install this alongside [`@financedistrict/saleor-agentic-commerce-nextjs`](https://www.npmjs.com/package/@financedistrict/saleor-agentic-commerce-nextjs) which provides ready-made route handlers. Use this package directly only if you're building a custom integration outside of Next.js.

## What's included

### Protocol Types

Full TypeScript types for both protocols, audited against the official specs:

- **UCP** (`2026-04-08`) — `UcpCheckoutSession`, `UcpOrder`, `UcpProfile`, `UcpPaymentInstrument`, `UcpFulfillment`, and more
- **ACP** (`2026-01-30`) — `AcpCheckoutSession`, `AcpOrder`, `AcpCapabilities`, `AcpPaymentHandler`, `AcpFulfillmentOption`, and more

```ts
import type { UcpCheckoutSession, AcpCheckoutSession } from "@financedistrict/saleor-agentic-commerce-core"
```

### Formatters

Transform Saleor GraphQL responses into protocol-compliant shapes:

```ts
import {
  formatUcpCheckoutSession,
  formatUcpProfile,
  formatUcpOrder,
  formatAcpCheckoutSession,
} from "@financedistrict/saleor-agentic-commerce-core"
```

### Saleor GraphQL Client

Lightweight client using raw `fetch` — no dependency on urql, Apollo, or graphql libraries:

```ts
import { SaleorClient } from "@financedistrict/saleor-agentic-commerce-core"

const client = new SaleorClient({
  apiUrl: "https://your-instance.saleor.cloud/graphql/",
  authToken: "your-app-token",
  channel: "default-channel",
})

const result = await client.getCheckout(checkoutId)
```

### Payment Handler Interface

Pluggable adapter for any payment method:

```ts
import type { PaymentHandlerAdapter } from "@financedistrict/saleor-agentic-commerce-core"

class MyPaymentHandler implements PaymentHandlerAdapter {
  id = "com.example.my_payment"

  getUcpDiscoveryHandlers() { /* ... */ }
  getAcpDiscoveryHandlers() { /* ... */ }
  getUcpCheckoutHandlers(metadata?) { /* ... */ }
  getAcpCheckoutHandlers(metadata?) { /* ... */ }
  prepareCheckoutPayment(input) { /* ... */ }
  settlePayment(input) { /* ... */ }
}
```

### Utilities

- **Address translation** — `saleorToUcpAddress()`, `ucpToSaleorAddress()`, `saleorToAcpAddress()`, `acpToSaleorAddress()`
- **Status mapping** — `resolveUcpCheckoutStatus()`, `resolveAcpCheckoutStatus()`
- **Error formatting** — `formatUcpError()`, `formatAcpError()`
- **Metadata helpers** — `metadataToRecord()`, `recordToMetadataInput()`

## API Reference

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `SaleorClient` | class | GraphQL client for Saleor checkout/order operations |
| `PaymentHandlerRegistry` | class | Registry for payment handler adapters |
| `formatUcpProfile` | function | Format UCP discovery profile |
| `formatUcpCheckoutSession` | function | Format Saleor checkout as UCP session |
| `formatUcpOrder` | function | Format Saleor order as UCP order |
| `formatAcpCheckoutSession` | function | Format Saleor checkout as ACP session |
| `formatUcpError` / `formatAcpError` | function | Format protocol-compliant error responses |
| `saleorToUcpAddress` / `saleorToAcpAddress` | function | Translate Saleor addresses to protocol format |
| `resolveUcpCheckoutStatus` / `resolveAcpCheckoutStatus` | function | Map Saleor checkout state to protocol status |
| `toMinor` | function | Convert decimal amounts to minor units (cents) |

## License

MIT
