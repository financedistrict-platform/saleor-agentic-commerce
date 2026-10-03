---
"@financedistrict/saleor-prism-payment": patch
---

Call Prism with the UCP version in the path (`/api/v2/merchant/ucp/<ucp-version>/handlers` and `/payment-requirements`). User-Agent is `fd-saleor-prism/<package version>`. Settle and ACP no longer send a UCP version. Needs Prism with versioned routes.
