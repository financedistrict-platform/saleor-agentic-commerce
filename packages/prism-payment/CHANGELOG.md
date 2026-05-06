# @financedistrict/saleor-prism-payment

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
