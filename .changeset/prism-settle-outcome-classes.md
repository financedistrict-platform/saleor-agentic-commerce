---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-prism-payment": patch
---

Classify every Prism settle reply into `settled`, `pending`, `review` or `declined` from explicit reason lists, instead of treating every `success: false` as declined. A pending reply (`settlement_pending`, `checkout_settlement_in_progress`, `unexpected_settle_error`, any unlisted or missing reason such as `transaction_reverted` or `receipt_timeout`, HTTP 0/5xx/408/409/429, an unreadable body, success without a transaction, or a request that throws) now keeps the settlement record `pending` instead of writing it `failed`. Only listed pre-broadcast reasons and other HTTP 4xx are declined. `SettleOutcome` is now `"declined" | "pending" | "review"` (`"unknown"` is gone), and a failed settle result can carry a `pendingReference`.
