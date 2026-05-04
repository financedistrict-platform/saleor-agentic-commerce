# Saleor Agentic Commerce

[![CI](https://github.com/financedistrict-platform/saleor-agentic-commerce/actions/workflows/ci.yml/badge.svg)](https://github.com/financedistrict-platform/saleor-agentic-commerce/actions/workflows/ci.yml)
[![Release](https://github.com/financedistrict-platform/saleor-agentic-commerce/actions/workflows/release.yml/badge.svg)](https://github.com/financedistrict-platform/saleor-agentic-commerce/actions/workflows/release.yml)
[![npm: core](https://img.shields.io/npm/v/@financedistrict/saleor-agentic-commerce-core?label=core)](https://www.npmjs.com/package/@financedistrict/saleor-agentic-commerce-core)
[![npm: nextjs](https://img.shields.io/npm/v/@financedistrict/saleor-agentic-commerce-nextjs?label=nextjs)](https://www.npmjs.com/package/@financedistrict/saleor-agentic-commerce-nextjs)
[![npm: prism-payment](https://img.shields.io/npm/v/@financedistrict/saleor-prism-payment?label=prism-payment)](https://www.npmjs.com/package/@financedistrict/saleor-prism-payment)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Make your Saleor store shoppable by AI agents.

This SDK adds [UCP](https://ucp.dev/) and [ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) protocol endpoints to your existing Next.js storefront, so AI shopping agents can discover your products, create checkouts, and complete purchases — without any changes to your Saleor backend.

> **[→ Get started in 5 minutes (Wiki: Quick Start)](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Quick-Start)**

## Why this matters

AI agents are becoming the next commerce channel. Just like merchants once added mobile apps alongside their websites, they'll soon need to serve autonomous agents that shop on behalf of consumers. But agents don't browse — they need structured APIs with standardized discovery, checkout flows, and payment settlement.

**UCP** (Universal Commerce Protocol) and **ACP** (Agentic Commerce Protocol) are the emerging open standards for this. This SDK implements both, so your Saleor store speaks the language agents understand.

## What you get

- **Agent discovery** — A `.well-known/ucp` profile that tells agents what your store supports, which payment methods are available, and where the API lives
- **Checkout sessions** — Agents can create carts, set shipping addresses, select delivery options, and complete purchases through protocol-compliant endpoints
- **Pluggable payments** — Ships with [Finance District Prism](https://developers.fd.xyz/prism) for stablecoin payments (x402/EIP-3009), or implement your own payment handler
- **No backend changes** — Everything runs in your Next.js storefront layer, consuming the same Saleor GraphQL API your storefront already uses
- **Zero runtime dependencies** — The packages add no transitive dependencies to your project

## Packages

| Package | What it does |
|---------|-------------|
| [`@financedistrict/saleor-agentic-commerce-core`](./packages/core) | Protocol types, Saleor-to-protocol formatters, payment handler interface |
| [`@financedistrict/saleor-agentic-commerce-nextjs`](./packages/nextjs) | Ready-made Next.js App Router route handlers for UCP and ACP |
| [`@financedistrict/saleor-prism-payment`](./packages/prism-payment) | Prism payment handler — stablecoin settlement via x402/EIP-3009 |
| [`@financedistrict/saleor-dummy-payment`](./packages/dummy-payment) | Always-succeeds simulator — for integration testing and as a reference implementation for new handler authors |
| [`@financedistrict/saleor-agentic-commerce-skill`](./packages/claude-skill) | Claude Code plugin — `/setup-agentic-commerce`, `/add-payment-handler`, `/diagnose-agentic-commerce` |

The [`apps/saleor-agentic-commerce-app`](./apps/saleor-agentic-commerce-app) folder also contains an optional **Saleor Dashboard App** that acts as a control plane for the SDK — see [The App is Optional](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/The-App-is-Optional) on the wiki for the three configuration paths.

## Documentation

The [wiki](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki) is the canonical reference. Highlights:

- **[Quick Start](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Quick-Start)** — get a Saleor storefront agent-shoppable in 5 minutes
- **[Architecture](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Architecture)** — the gateway pattern and design framing
- **[Storefront SDK](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Storefront-SDK)** — full configuration reference and route wire-up
- **[The App](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/The-App)** — what the Saleor Dashboard App does (FD-hosted by default, self-host optional)
- **[The App is Optional](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/The-App-is-Optional)** — three configuration paths (env-only, App-managed, hybrid)
- **[Build a Handler](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Build-a-Handler)** — author your own payment handler package
- **[Saleor Cloud](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Saleor-Cloud)** — Cloud-specific setup notes
- **[UCP and ACP](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/UCP-and-ACP)** — protocol overview and conformance status
- **[Authentication](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Authentication)** — five token contexts in this stack
- **[Glossary](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Glossary)** — terminology reference

## Claude Code Plugin

If you use [Claude Code](https://claude.ai/code), install the skill plugin and let Claude set everything up:

```
/setup-agentic-commerce
```

See [`packages/claude-skill`](./packages/claude-skill) for installation options.

## Versioning & Releases

All published packages follow [semver](https://semver.org/). Releases are automated via [Changesets](https://github.com/changesets/changesets) — see [CONTRIBUTING.md](CONTRIBUTING.md#release-flow-automated) for the flow.

## Contributing

Issues and pull requests welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the basics and the [wiki](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki) for architecture and integration guides.

If you're shipping a new payment handler package, you don't need to fork or PR this repo — handler packages live in their own repos and self-register at storefront boot. See the [Build a Handler](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Build-a-Handler) wiki page.

## License

[MIT](LICENSE) © 2026 Finance District.

The project is built for eventual handover to a neutral steward (e.g. Saleor, a protocol foundation) — see [Architecture: The gateway pattern](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Architecture) on the wiki for the framing.
