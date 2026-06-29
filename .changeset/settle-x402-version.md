---
"@financedistrict/saleor-prism-payment": patch
---

Include `x402Version: 2` in the Prism `/payment/settle` request body.

Prism's settle endpoint expects `{ x402Version, paymentPayload, paymentRequirements }` — the field was present in the Medusa plugin but missing from the Saleor SDK, causing HTTP 400 rejections on all settle calls after a Prism gateway update (2026-06-25).
