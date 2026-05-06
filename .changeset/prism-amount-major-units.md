---
"@financedistrict/saleor-prism-payment": patch
---

Fix unit mismatch in Prism `/payment-requirements` requests. The handler was sending integer minor units (e.g. `"11480"` for $114.80) as the `amount` field, but Prism's gateway parses that field as a decimal string in major fiat units, which made it interpret the value as $11,480 — producing `accepts[].amount` values ~100× too large.

The client now formats the amount according to the ISO 4217 exponent of the supplied currency (USD/EUR → 2 decimals, JPY → 0 decimals, KWD → 3 decimals, etc.) before posting. The public `PreparePaymentInput.amount` is still expressed in minor units; the conversion happens at the wire boundary.
