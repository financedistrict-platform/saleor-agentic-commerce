---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
---

Register settled payments with Saleor before completing the checkout. Previously the SDK called `settlePayment` on the handler (which returns the on-chain tx hash from Prism), then went straight to `checkoutComplete`. Saleor had no record of the payment and refused to create an order with `CHECKOUT_NOT_FULLY_PAID`.

The core client now exposes `createCheckoutTransaction()`, which wraps Saleor's `transactionCreate` mutation. Both the UCP and ACP complete routes call it between settle success and `checkoutComplete`, passing the handler's `transactionReference` as `pspReference` and the checkout gross total as `amountCharged`. Settlement now flows end-to-end and the resulting order shows the on-chain hash as its PSP reference.

Requires the Saleor app token to hold the `HANDLE_PAYMENTS` permission.

Also fail the UCP and ACP `createCheckout` and shipping-address-update endpoints with `unsupported_shipping_destination` when Saleor returns no shipping methods for the supplied destination, instead of silently accepting an unfulfillable order that later dies at complete with "Shipping method is not set".
