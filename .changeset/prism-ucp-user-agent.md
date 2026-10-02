---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
"@financedistrict/saleor-prism-payment": patch
---

Prism calls now send `User-Agent: fd-saleor-prism/<ucp-version>` (for example `2026-08-25`) so Prism can pick the handler contract for that UCP version; the old user agent carried the package version, which Prism never recognised. The `?ucp_version=` query is no longer sent. UCP checkout prepare and settle use the version the request or session is pinned to; ACP routes use the store's configured UCP version. `CheckoutPrepareInput` and `PaymentSettleInput` gain a required `ucpVersion`, and payment handler adapters' `getAcpDiscoveryHandlers` and `getUcpDiscoveryHandlers` receive it as a required argument.
