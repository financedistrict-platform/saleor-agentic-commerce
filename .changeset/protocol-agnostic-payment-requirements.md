---
"@financedistrict/saleor-prism-payment": patch
---

Get payment requirements from Prism's protocol-free `/api/v2/merchant/payment-requirements`. The UCP checkout entry takes its `id` and `version` from Prism discovery for the same UCP version, so discovery and checkout always agree. If discovery has no declaration, the UCP entry is left out. ACP is unchanged. Needs Prism with the protocol-free payment-requirements route.
