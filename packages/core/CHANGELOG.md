# @financedistrict/saleor-agentic-commerce-core

## 1.1.0

### Minor Changes

- [#79](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/79) [`9e5ac36`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/9e5ac36746c99537dc4ee5e98f26ab3e62142a3d) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - The default UCP version stays the latest one (currently 2026-08-25, as in 2.0.0). This release adds 2026-04-08 and 2026-01-23, which agents get when their profile declares them. Stores upgrading from 0.x or 1.x releases that served 2026-04-08 and want that root profile set `ucpVersion: "2026-04-08"`; agents that declare a version in their profile are served it either way. New optional config keys `ucpSupportedVersions` and `ucpVersionNegotiation`; new leaf route `discoveryVersion` for `/.well-known/ucp/[version]`; sessions keep the version they were created in. Prism discovery is requested per version, legacy Prism entries are accepted, and original-era instruments (`tokenized`, `default`, no type, `handler_id: "x402"`) still settle. `PaymentSettleInput` accepts input without `protocol` again.

  Known differences from the original 0.7.1 release, kept from 1.0.0 / 2.0.0 on purpose:

  - Under 2026-04-08, catalog search and lookup and the order body keep the 1.0.0 shapes (`has_next_page` / `cursor` / `total_count` instead of `total` / `limit` / `offset` / `has_more`; lookup returns resolved variants with `inputs[]`). The profile, checkout and error documents are byte-equal to 0.7.1.
  - Error behaviour from 1.0.0 stays: `invalid_instrument` (400) exists, failures after settlement answer `settlement_not_recorded`, `order_not_recorded_after_settlement` or `order_not_completed_after_settlement` instead of `transaction_create_failed` / `checkout_complete_failed`, a not-ready checkout at complete answers 200 with the session, and several errors carry `recoverable` severity.
  - The exported `UCP_VERSION` constant follows the default, so it stays `2026-08-25`; it is derived from the newest known version and moves when a later version is added, so pin `ucpVersion` if a store must not move.
  - The Next.js integration needs the Node.js runtime (the agent profile fetch uses `node:https` and `node:dns`); the Edge runtime is not supported.
  - When `ucpSupportedVersions` is omitted, every known version other than `ucpVersion` stays enabled, so `ucpVersion: "2026-04-08"` alone keeps `2026-08-25` and `2026-01-23` available.
  - The nextjs, prism-payment and dummy-payment packages now require `@financedistrict/saleor-agentic-commerce-core` `^1.1.0` as a peer: nextjs imports the version registry and the agent profile fetcher that core 1.1.0 adds.

## 1.0.0

### Major Changes

- [#74](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/74) [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - Upgrade to UCP 2026-08-25.

  - The `ucpVersion` option is kept; its default is now `UCP_VERSION` (`"2026-08-25"`), exported from core. The discovery profile no longer emits `signing_keys`.
  - UCP checkout complete requires the selected instrument to carry string `id`, `handler_id` and `type`, and a sent `credential` to carry string `type`; otherwise it returns 400 `invalid_instrument`.
  - The Prism handler id is `xyz.fd.prism_payment` and its entry version is `2026-10-07`. Prism settlement requires instrument `type` and `credential.type` to be `"x402"`. A Prism discovery entry without `id`, `version`, `spec` or `schema` is not advertised.
  - `PaymentSettleInput` now requires `protocol`: `{ protocol: "ucp", instrumentType }` from the UCP complete route, `{ protocol: "acp" }` from the ACP complete route. ACP settlement behaviour is unchanged.

### Patch Changes

- [#74](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/74) [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - UCP/ACP conformance + money-safety fixes.

  - **core** (response-shape changes → minor): catalog `description` now a `{plain,html,markdown}` object, uppercase currency, real `sku`, cursor pagination + `total_count` (SAC-8, U-4); `catalog/lookup` resolves product **and** variant ids with `inputs[]` correlation (SAC-8); order `checkout_id` from real `Order.checkoutId` (SAC-6); order line status/fulfilment derived from Saleor fulfillments (SAC-7); structured field errors with `path` + honest severity (SAC-5); full cart replacement on `PUT` (U-2); per-`(apiUrl, token)` config cache (U-5); correct catalog schema URLs in discovery (SAC-8 WARN).
  - **nextjs**: record settlement to checkout metadata **before** any order write so a failed complete is recoverable and never double-charges on retry; honest error messages (SAC-2, UCP + ACP).
  - **prism-payment**: unwrap the wallet credential wrapper at the settle boundary (SAC-3).
  - **dummy-payment**: read prepared config under the adapter id the registry writes (U-1).

- [#74](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/74) [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - Gate checkout completion on the commerce engine's own validation. The complete endpoint now confirms the checkout is completable before settling payment, so funds are captured only once the order can actually be placed. Checkout sessions expose readiness through `status` (`incomplete` / `ready_for_complete`) and surface the engine's validation errors as UCP `messages`.

## 0.7.1

### Patch Changes

- [#58](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/58) [`6b153bf`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/6b153bf8112a829fa212b876fa73a557dbf3a979) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Fix discovery profile to include required `spec` and `schema` fields on all capability entries, and `schema` on the service block, per UCP spec (REST transport requires `schema`; all capabilities require `version`, `spec`, and `schema`).

## 0.7.0

### Minor Changes

- [#56](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/56) [`05c4837`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/05c483711ce2de1a699494377b4060b5877451a3) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Add UCP catalog routes: `POST /api/ucp/catalog/search` and `POST /api/ucp/catalog/lookup`

  Implements the `dev.ucp.shopping.catalog.search` and `dev.ucp.shopping.catalog.lookup` capabilities per UCP spec

## 0.6.3

### Patch Changes

- [#50](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/50) [`f5cb606`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/f5cb606b982c3daa98cca6648a79ffc216d361f8) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Security: validate the agent's signed x402/EIP-3009 payment payload against the checkout's stored Prism quote (network, asset, amount, recipient) at the UCP and ACP `/complete` route handlers before forwarding to settlement. Closes a class of payment-validation gaps where the SDK could accept a signed payload whose fields didn't match the merchant's quote. Mismatches now return HTTP 422 with a specific error code.

## 0.6.2

### Patch Changes

- [#38](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/38) [`ced051d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/ced051d3acdaa04cc6502d7a2cb20fa454b80b62) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Register settled payments with Saleor before completing the checkout. Previously the SDK called `settlePayment` on the handler (which returns the on-chain tx hash from Prism), then went straight to `checkoutComplete`. Saleor had no record of the payment and refused to create an order with `CHECKOUT_NOT_FULLY_PAID`.

  The core client now exposes `createCheckoutTransaction()`, which wraps Saleor's `transactionCreate` mutation. Both the UCP and ACP complete routes call it between settle success and `checkoutComplete`, passing the handler's `transactionReference` as `pspReference` and the checkout gross total as `amountCharged`. Settlement now flows end-to-end and the resulting order shows the on-chain hash as its PSP reference.

  Requires the Saleor app token to hold the `HANDLE_PAYMENTS` permission.

  Also fail the UCP and ACP `createCheckout` and shipping-address-update endpoints with `unsupported_shipping_destination` when Saleor returns no shipping methods for the supplied destination, instead of silently accepting an unfulfillable order that later dies at complete with "Shipping method is not set".

## 0.6.1

### Patch Changes

- [#28](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/28) [`28e7f6b`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/28e7f6b52af8ed97a767529334cdb5a6ad14c974) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Exclude `*.test.ts` files from the published `dist/` artifact. Trims a few KB and removes test-only `.d.ts` from the public type surface.
