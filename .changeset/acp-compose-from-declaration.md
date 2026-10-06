---
"@financedistrict/saleor-prism-payment": patch
---

The ACP checkout entry is composed from `/api/v2/merchant/acp/handlers` and `/api/v2/merchant/payment-requirements`. One Prism call serves UCP and ACP. `PrismClient.prepareAcpPayment` is removed. Needs Prism with the shared payment-requirements endpoint.
