# @financedistrict/saleor-prism-payment

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

- [#74](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/74) [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9) Thanks [@vu-remote-dev-fdt](https://github.com/vu-remote-dev-fdt)! - Fix the "Manage in Finance District Prism" dashboard link to point to the Prism app console (`https://apps.fd.xyz/prism`).

- Updated dependencies [[`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9), [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9), [`222720d`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/222720d5db798dc2a76343f03b1ab042b283f9c9)]:
  - @financedistrict/saleor-agentic-commerce-core@1.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [[`05c4837`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/05c483711ce2de1a699494377b4060b5877451a3)]:
  - @financedistrict/saleor-agentic-commerce-core@0.7.0

## 0.7.4

### Patch Changes

- [#54](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/54) [`de011db`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/de011dbfd75f15a7e46d40d64b934a02fe8126e9) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Include `x402Version: 2` in the Prism `/payment/settle` request body.

  Prism's settle endpoint expects `{ x402Version, paymentPayload, paymentRequirements }` — the field was present in the Medusa plugin but missing from the Saleor SDK, causing HTTP 400 rejections on all settle calls after a Prism gateway update (2026-06-25).

## 0.7.3

### Patch Changes

- [#52](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/52) [`c96b0d0`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/c96b0d0691a78b38ee8324d92048e85068ddf9f7) Thanks [@Mani-fdt](https://github.com/Mani-fdt)! - Match `accepts[]` entries on (network, asset) so carts advertising multiple assets per network resolve to the entry the wallet actually signed for. Falls back to legacy (network, scheme) and single-entry resolution when asset is unreadable.

## 0.7.2

### Patch Changes

- [#36](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/36) [`80ebcd5`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/80ebcd57b705be1b0e689c9a8204017f261cafbe) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Fix unit mismatch in Prism `/payment-requirements` requests. The handler was sending integer minor units (e.g. `"11480"` for $114.80) as the `amount` field, but Prism's gateway parses that field as a decimal string in major fiat units, which made it interpret the value as $11,480 — producing `accepts[].amount` values ~100× too large.

  The client now formats the amount according to the ISO 4217 exponent of the supplied currency (USD/EUR → 2 decimals, JPY → 0 decimals, KWD → 3 decimals, etc.) before posting. The public `PreparePaymentInput.amount` is still expressed in minor units; the conversion happens at the wire boundary.

- [#36](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/36) [`80ebcd5`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/80ebcd57b705be1b0e689c9a8204017f261cafbe) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Fix `settlePayment` posting the wrong shape to Prism. The handler was sending the full `PaymentHandlerConfig` (with `accepts[]` array) as `paymentRequirements`, but Prism's `/api/v2/payment/settle` expects a single accepts entry with `network`, `asset`, `amount`, `scheme`, `payTo` at the top level. Settlement was failing with `400 Bad Request: PaymentRequirements must include network / asset`.

  The handler now picks the accepts entry whose `network` (and `scheme`, when present) matches the submitted x402 credential, and submits that single entry. When the network is ambiguous (multiple assets on the same chain) and the credential carries no extra hint, settlement fails fast with a clear error rather than guessing.

## 0.7.1

### Patch Changes

- [#34](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/34) [`4f47aaa`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/4f47aaa15eb68e19a1024d40edfa18dce60d371f) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Fix unit mismatch in Prism `/payment-requirements` requests. The handler was sending integer minor units (e.g. `"11480"` for $114.80) as the `amount` field, but Prism's gateway parses that field as a decimal string in major fiat units, which made it interpret the value as $11,480 — producing `accepts[].amount` values ~100× too large.

  The client now formats the amount according to the ISO 4217 exponent of the supplied currency (USD/EUR → 2 decimals, JPY → 0 decimals, KWD → 3 decimals, etc.) before posting. The public `PreparePaymentInput.amount` is still expressed in minor units; the conversion happens at the wire boundary.

## 0.7.0

### Minor Changes

- [#33](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/33) [`b52bf32`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/b52bf32ee424055e209cb45bb7d67dd8d12891f3) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Switch Prism handler to protocol-specific Merchant API endpoints. The legacy `/api/v2/merchant/payment-profile` and `/api/v2/merchant/checkout-prepare` endpoints are deprecated; the handler now calls `/api/v2/merchant/{ucp,acp}/handlers` for discovery and `/api/v2/merchant/{ucp,acp}/payment-requirements` for checkout prepare.

  Behavior changes visible to consumers:

  - **UCP discovery** now includes the `spec` and `schema` fields from Prism's response (previously omitted).
  - **ACP discovery and checkout-context handlers** are passed through verbatim from Prism instead of being hand-constructed on the client. Fields like `requires_delegate_payment`, `psp`, `config_schema`, and `instrument_schemas` now reflect Prism's authoritative values.
  - **`prepareCheckoutPayment`** calls UCP and ACP prepare endpoints in parallel (fail-soft per protocol) and stores both responses for later use.
  - Settlement still uses the shared `/api/v2/payment/settle` endpoint.

### Patch Changes

- [#28](https://github.com/financedistrict-platform/saleor-agentic-commerce/pull/28) [`28e7f6b`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/28e7f6b52af8ed97a767529334cdb5a6ad14c974) Thanks [@jj-at-fdt](https://github.com/jj-at-fdt)! - Exclude `*.test.ts` files from the published `dist/` artifact. Trims a few KB and removes test-only `.d.ts` from the public type surface.

- Updated dependencies [[`28e7f6b`](https://github.com/financedistrict-platform/saleor-agentic-commerce/commit/28e7f6b52af8ed97a767529334cdb5a6ad14c974)]:
  - @financedistrict/saleor-agentic-commerce-core@0.6.1
