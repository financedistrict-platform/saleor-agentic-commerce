# @financedistrict/saleor-agentic-commerce-nextjs

## 2.1.4

### Patch Changes

- [#114](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/114) [`beb6e3d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/beb6e3d769230bb72bd2c5b6ba094662a9482ca6) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - UCP routes now check an `X-API-Key` header when one is sent: a key that is not the store's API key answers 401 `key_not_found`. Requests without the header are served as before.

## 2.1.3

### Patch Changes

- [#96](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/96) [`6853639`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/6853639e962a9d4a14e247438e5263291c7fc40e) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - An agent profile status that this nextjs build does not know is treated as an unreachable profile instead of throwing, so a newer core can never break requests that declare a profile. The core peer range is now ^1.1.2 for nextjs and prism-payment, so the same-origin profile redirect fix is always present.

## 2.1.2

### Patch Changes

- [#91](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/91) [`573f659`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/573f659802348463139886267d049b5d47bc5d9b) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - The Prism ACP discovery cache is keyed by UCP version, so a store serving several UCP versions never returns a handler entry cached for another version. The prism-payment README examples pass the required `ucpVersion` to `getUcpDiscoveryHandlers` and `getAcpDiscoveryHandlers`. Core and nextjs are released together with prism-payment so the three packages stay on one patch line.

- [#91](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/91) [`573f659`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/573f659802348463139886267d049b5d47bc5d9b) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - The UCP agent-profile fetcher follows one same-origin redirect (301, 302, 303, 307, 308), so a profile URL that redirects by a trailing slash no longer falls back to the default version. Any other redirect (cross-origin, scheme change, credentials in the URL, or a second redirect) is rejected with 424 `profile_redirected` in both lenient and strict negotiation. The message names the Location and the structured log line carries it. Core and nextjs are released together with prism-payment so the three packages stay on one patch line.

## 2.1.1

### Patch Changes

- [#83](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/83) [`38bf1be`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/38bf1be647b9ed934bb393f49f2877122f1123e2) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - Prism calls now carry the UCP version (for example `2026-08-25`) so Prism can pick the handler contract for that UCP version. The `?ucp_version=` query is no longer sent. UCP checkout prepare and settle use the version the request or session is pinned to; ACP routes use the store's configured UCP version. `CheckoutPrepareInput` and `PaymentSettleInput` gain a required `ucpVersion`, and payment handler adapters' `getAcpDiscoveryHandlers` and `getUcpDiscoveryHandlers` receive it as a required argument.

  The 2026-01-23 profile now links `services/shopping/openapi.json`. Strict negotiation answers 424 `profile_unreachable` and 422 `profile_malformed`. An unknown declared version is rejected with 422 `version_unsupported` in both modes. A pin mismatch says "This session is bound to UCP version X; the agent profile now declares Y." A `UCP-Agent` header without `profile=` is treated as no profile and serves the current version. The agent profile body cap is 128 KiB.

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

- Updated dependencies [[`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9), [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9), [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9)]:
  - @financedistrict/saleor-agentic-commerce-core@1.0.0

## 1.0.0

### Minor Changes

- [#56](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/56) [`05c4837`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/05c483711ce2de1a699494377b4060b5877451a3) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Add UCP catalog routes: `POST /api/ucp/catalog/search` and `POST /api/ucp/catalog/lookup`

  Implements the `dev.ucp.shopping.catalog.search` and `dev.ucp.shopping.catalog.lookup` capabilities per UCP spec

### Patch Changes

- Updated dependencies [[`05c4837`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/05c483711ce2de1a699494377b4060b5877451a3)]:
  - @financedistrict/saleor-agentic-commerce-core@0.7.0

## 0.6.6

### Patch Changes

- [#50](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/50) [`f5cb606`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/f5cb606b982c3daa98cca6648a79ffc216d361f8) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Security: validate the agent's signed x402/EIP-3009 payment payload against the checkout's stored Prism quote (network, asset, amount, recipient) at the UCP and ACP `/complete` route handlers before forwarding to settlement. Closes a class of payment-validation gaps where the SDK could accept a signed payload whose fields didn't match the merchant's quote. Mismatches now return HTTP 422 with a specific error code.

- Updated dependencies [[`f5cb606`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/f5cb606b982c3daa98cca6648a79ffc216d361f8)]:
  - @financedistrict/saleor-agentic-commerce-core@0.6.3

## 0.6.5

### Patch Changes

- [#47](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/47) [`04c6adc`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/04c6adc1b4c5f28ba2fd74a9e81c427336b6fc07) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Surface Saleor SDK errors that were silently swallowed in three route call sites (UCP + ACP):

  - **Cancel** — `updatePrivateMetadata` write result was discarded. If the write failed, the route returned `status: "canceled"` but the flag never landed, so the cancel guards from [#42](https://github.com/financedistrict-platform/saleor-agentic-commerce/issues/42) would not fire on the next request. Now returns HTTP 422 `cancel_persist_failed` on write failure.
  - **Complete** — `selectedInstrument.billing_address` (UCP) / `payment_data.billing_address` (ACP) override discarded the `updateCheckoutBillingAddress` result. Settlement could proceed against the previous billing address with no error. Now returns HTTP 422 `billing_address_update_failed`, mirroring the PUT route.
  - **Prepare-payment** — `updatePrivateMetadata` write of the prepared Prism config was discarded. Failures rendered empty `payment_handlers` invisibly. Now logged via `console.error` with the checkout id; flow continues (self-healing on retry).

  Happy paths unchanged. Tests 64/64. `tsc --noEmit` clean.

## 0.6.4

### Patch Changes

- [#42](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/42) [`e26df69`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/e26df69f12f429b6ef10fc5faa81998f3eedb997) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Fix cancel guards never firing. PR [#40](https://github.com/financedistrict-platform/saleor-agentic-commerce/issues/40) added server-side cancel enforcement on the UCP and ACP `update`, `complete`, and `GET` routes, but the guards were comparing `metadata.{ucp,acp}_canceled === "true"` (string) — and `metadataToRecord` runs `JSON.parse` on every value, so the literal `"true"` written by the cancel route comes back as the boolean `true`. The string comparison therefore never matched and the guards never fired; an agent that aborted and retried could still mutate, sign, and settle against a session it thought was dead. The guards now compare against the boolean `true`, which is what `JSON.parse("true")` actually returns. A regression test on `metadataToRecord` pins this contract so a future "cleanup" of the parser can't silently re-break the guards.

## 0.6.3

### Patch Changes

- [#40](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/40) [`5947b04`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/5947b0437ab77f4318bc7f019a7d6b368a39c9ce) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Auto-mirror the billing address from the shipping address. UCP has no first-class billing block in its body, and ACP only carries one optionally — without a fallback, Saleor's `checkoutComplete` fails with `BILLING_ADDRESS_NOT_SET`. The UCP `createCheckout` and shipping-address-update routes now always mirror billing to the supplied shipping address. The ACP routes mirror only when the caller did not provide an explicit `billing_address`. In both cases the mirror is skipped on update if Saleor already has a billing address recorded, so we don't clobber a deliberate one.

  Make cancel actually stick. The cancel endpoint was writing a `{ucp,acp}_canceled=true` flag into the checkout's private metadata, but neither the complete nor the update endpoint inspected it — so an agent that aborted and retried could still sign and settle against a session it thought was dead. The UCP and ACP `complete` endpoints now refuse with HTTP 409 `session_canceled` when the flag is set, the `update` endpoints do the same to block further mutations, and the `GET` endpoint reflects the canceled status instead of always reporting the active checkout.

## 0.6.2

### Patch Changes

- [#38](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/38) [`ced051d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/ced051d3acdaa04cc6502d7a2cb20fa454b80b62) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Register settled payments with Saleor before completing the checkout. Previously the SDK called `settlePayment` on the handler (which returns the on-chain tx hash from Prism), then went straight to `checkoutComplete`. Saleor had no record of the payment and refused to create an order with `CHECKOUT_NOT_FULLY_PAID`.

  The core client now exposes `createCheckoutTransaction()`, which wraps Saleor's `transactionCreate` mutation. Both the UCP and ACP complete routes call it between settle success and `checkoutComplete`, passing the handler's `transactionReference` as `pspReference` and the checkout gross total as `amountCharged`. Settlement now flows end-to-end and the resulting order shows the on-chain hash as its PSP reference.

  Requires the Saleor app token to hold the `HANDLE_PAYMENTS` permission.

  Also fail the UCP and ACP `createCheckout` and shipping-address-update endpoints with `unsupported_shipping_destination` when Saleor returns no shipping methods for the supplied destination, instead of silently accepting an unfulfillable order that later dies at complete with "Shipping method is not set".

- Updated dependencies [[`ced051d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/ced051d3acdaa04cc6502d7a2cb20fa454b80b62)]:
  - @financedistrict/saleor-agentic-commerce-core@0.6.2

## 0.6.1

### Patch Changes

- [#28](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/28) [`28e7f6b`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/28e7f6b52af8ed97a767529334cdb5a6ad14c974) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Exclude `*.test.ts` files from the published `dist/` artifact. Trims a few KB and removes test-only `.d.ts` from the public type surface.

- Updated dependencies [[`28e7f6b`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/28e7f6b52af8ed97a767529334cdb5a6ad14c974)]:
  - @financedistrict/saleor-agentic-commerce-core@0.6.1
