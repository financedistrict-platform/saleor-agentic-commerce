---
"@financedistrict/saleor-prism-payment": patch
---

Fix `settlePayment` posting the wrong shape to Prism. The handler was sending the full `PaymentHandlerConfig` (with `accepts[]` array) as `paymentRequirements`, but Prism's `/api/v2/payment/settle` expects a single accepts entry with `network`, `asset`, `amount`, `scheme`, `payTo` at the top level. Settlement was failing with `400 Bad Request: PaymentRequirements must include network / asset`.

The handler now picks the accepts entry whose `network` (and `scheme`, when present) matches the submitted x402 credential, and submits that single entry. When the network is ambiguous (multiple assets on the same chain) and the credential carries no extra hint, settlement fails fast with a clear error rather than guessing.
