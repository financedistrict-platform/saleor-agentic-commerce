# @financedistrict/saleor-dummy-payment

## 2.1.3

## 2.1.2

### Patch Changes

- [#91](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/91) [`573f659`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/573f659802348463139886267d049b5d47bc5d9b) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - The nextjs, prism-payment and dummy-payment packages now share one version line, so a storefront that installs all three at the same version always finds a matching release, rc snapshots included.

## 2.1.0

### Minor Changes

- [#79](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/79) [`9e5ac36`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/9e5ac36746c99537dc4ee5e98f26ab3e62142a3d) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - The default UCP version stays the latest one (currently 2026-08-25, as in 2.0.0). This release adds 2026-04-08 and 2026-01-23, which agents get when their profile declares them. Stores upgrading from 0.x or 1.x releases that served 2026-04-08 and want that root profile set `ucpVersion: "2026-04-08"`; agents that declare a version in their profile are served it either way. New optional config keys `ucpSupportedVersions` and `ucpVersionNegotiation`; new leaf route `discoveryVersion` for `/.well-known/ucp/[version]`; sessions keep the version they were created in. Prism discovery is requested per version, legacy Prism entries are accepted, and original-era instruments (`tokenized`, `default`, no type, `handler_id: "x402"`) still settle. `PaymentSettleInput` accepts input without `protocol` again.

  Known differences from the original 0.7.1 release, kept from 1.0.0 / 2.0.0 on purpose:

  - Under 2026-04-08, catalog search and lookup and the order body keep the 1.0.0 shapes (`has_next_page` / `cursor` / `total_count` instead of `total` / `limit` / `offset` / `has_more`; lookup returns resolved variants with `inputs[]`). The profile, checkout and error documents are byte-equal to 0.7.1.
  - Error behaviour from 1.0.0 stays: `invalid_instrument` (400) exists, failures after settlement answer `settlement_not_recorded`, `order_not_recorded_after_settlement` or `order_not_completed_after_settlement` instead of `transaction_create_failed` / `checkout_complete_failed`, a not-ready checkout at complete answers 200 with the session, and several errors carry `recoverable` severity.
  - The exported `UCP_VERSION` constant follows the default, so it stays `2026-08-25`; it is derived from the newest known version and moves when a later version is added, so pin `ucpVersion` if a store must not move.
  - The Next.js integration needs the Node.js runtime (the agent profile fetch uses `node:https` and `node:dns`); the Edge runtime is not supported.
  - When `ucpSupportedVersions` is omitted, every known version other than `ucpVersion` stays enabled, so `ucpVersion: "2026-04-08"` alone keeps `2026-08-25` and `2026-01-23` available.
  - The nextjs, prism-payment and dummy-payment packages now require `@financedistrict/saleor-agentic-commerce-core` `^1.1.0` as a peer: nextjs imports the version registry and the agent profile fetcher that core 1.1.0 adds.

## 2.0.0

### Patch Changes

- [#74](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/74) [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - UCP/ACP conformance + money-safety fixes.

  - **core** (response-shape changes → minor): catalog `description` now a `{plain,html,markdown}` object, uppercase currency, real `sku`, cursor pagination + `total_count` (SAC-8, U-4); `catalog/lookup` resolves product **and** variant ids with `inputs[]` correlation (SAC-8); order `checkout_id` from real `Order.checkoutId` (SAC-6); order line status/fulfilment derived from Saleor fulfillments (SAC-7); structured field errors with `path` + honest severity (SAC-5); full cart replacement on `PUT` (U-2); per-`(apiUrl, token)` config cache (U-5); correct catalog schema URLs in discovery (SAC-8 WARN).
  - **nextjs**: record settlement to checkout metadata **before** any order write so a failed complete is recoverable and never double-charges on retry; honest error messages (SAC-2, UCP + ACP).
  - **prism-payment**: unwrap the wallet credential wrapper at the settle boundary (SAC-3).
  - **dummy-payment**: read prepared config under the adapter id the registry writes (U-1).

- Updated dependencies [[`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9), [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9), [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9)]:
  - @financedistrict/saleor-agentic-commerce-core@1.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [[`05c4837`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/05c483711ce2de1a699494377b4060b5877451a3)]:
  - @financedistrict/saleor-agentic-commerce-core@0.7.0

## 0.6.1

### Patch Changes

- [#28](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/28) [`28e7f6b`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/28e7f6b52af8ed97a767529334cdb5a6ad14c974) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Exclude `*.test.ts` files from the published `dist/` artifact. Trims a few KB and removes test-only `.d.ts` from the public type surface.

- Updated dependencies [[`28e7f6b`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/28e7f6b52af8ed97a767529334cdb5a6ad14c974)]:
  - @financedistrict/saleor-agentic-commerce-core@0.6.1
