# @financedistrict/saleor-agentic-commerce-nextjs

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
