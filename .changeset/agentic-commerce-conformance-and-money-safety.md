---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
"@financedistrict/saleor-prism-payment": patch
"@financedistrict/saleor-dummy-payment": patch
---

UCP/ACP conformance + money-safety fixes.

- **core** (response-shape changes → minor): catalog `description` now a `{plain,html,markdown}` object, uppercase currency, real `sku`, cursor pagination + `total_count` (SAC-8, U-4); `catalog/lookup` resolves product **and** variant ids with `inputs[]` correlation (SAC-8); order `checkout_id` from real `Order.checkoutId` (SAC-6); order line status/fulfilment derived from Saleor fulfillments (SAC-7); structured field errors with `path` + honest severity (SAC-5); full cart replacement on `PUT` (U-2); per-`(apiUrl, token)` config cache (U-5); correct catalog schema URLs in discovery (SAC-8 WARN).
- **nextjs**: record settlement to checkout metadata **before** any order write so a failed complete is recoverable and never double-charges on retry; honest error messages (SAC-2, UCP + ACP).
- **prism-payment**: unwrap the wallet credential wrapper at the settle boundary (SAC-3).
- **dummy-payment**: read prepared config under the adapter id the registry writes (U-1).
