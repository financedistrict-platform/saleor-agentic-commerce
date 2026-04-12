# Saleor Agentic Commerce

SDK for exposing [Saleor](https://saleor.io/) storefronts to AI shopping agents via the [Universal Commerce Protocol (UCP)](https://ucp.dev/) and [Agentic Commerce Protocol (ACP)](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol).

## Packages

| Package | Description |
|---------|-------------|
| [`@financedistrict/saleor-agentic-commerce-core`](./packages/core) | Protocol types, formatters, status maps, and payment handler adapter interface |
| [`@financedistrict/saleor-agentic-commerce-nextjs`](./packages/nextjs) | Next.js App Router route handlers for UCP and ACP endpoints |
| [`@financedistrict/saleor-prism-payment`](./packages/prism-payment) | Payment handler adapter for Finance District Prism (x402/EIP-3009) |

## Architecture

These packages run inside the merchant's Next.js storefront — not as a Saleor App. They consume Saleor's GraphQL API and expose UCP/ACP protocol-compliant REST endpoints that AI agents can discover and interact with.

```
Agent  <-->  UCP/ACP Routes (nextjs)  <-->  Core Formatters  <-->  Saleor GraphQL API
                                              |
                                        Payment Handler
                                         (Prism/x402)
```

## Quick Start

```bash
pnpm add @financedistrict/saleor-agentic-commerce-core @financedistrict/saleor-agentic-commerce-nextjs @financedistrict/saleor-prism-payment
```

See the [`storefront/`](./storefront) directory for a reference integration.

## Protocol Versions

- UCP: `2026-04-08`
- ACP: `2026-01-30`

## Development

```bash
pnpm install
pnpm build
```

## License

MIT
