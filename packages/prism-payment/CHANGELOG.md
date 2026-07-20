# @financedistrict/saleor-prism-payment

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
