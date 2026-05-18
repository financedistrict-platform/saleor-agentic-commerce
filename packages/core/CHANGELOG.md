# @financedistrict/saleor-agentic-commerce-core

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
