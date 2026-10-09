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

- **UCP** (the latest version, `2026-08-25`, by default, plus `2026-04-08` and `2026-01-23` through `createUcpVersionRegistry`) — `UcpCheckoutSession`, `UcpOrder`, `UcpProfile`, `UcpPaymentInstrument`, `UcpFulfillment`, and more
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
  settlementKeys(input) { /* required: keys that identify this payment and the amount it will settle, declared before it is submitted */ }
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
| `toMinor` / `fromMinor` / `minorToDecimalString` | function | Convert money by each currency's own minor unit (USD 2, JPY 0, KWD 3); unknown currencies throw `UnsupportedCurrencyError` |

## License

MIT
