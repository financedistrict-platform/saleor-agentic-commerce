---
"@financedistrict/saleor-prism-payment": patch
---

Send the checkout's quoted resource url to Prism with every settle, and refuse a signed payment whose own `resource` names another url with `resource_mismatch`. A signed payment without a `resource` now settles instead of failing with `unexpected_settle_error`.
