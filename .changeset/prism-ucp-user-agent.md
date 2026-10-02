---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
"@financedistrict/saleor-prism-payment": patch
---

Prism calls now send `User-Agent: fd-saleor-prism/<ucp-version>` (for example `2026-08-25`) so Prism can pick the handler contract for that UCP version; the old user agent carried the package version, which Prism never recognised. The `?ucp_version=` query is no longer sent. UCP checkout prepare and settle use the version the request or session is pinned to; ACP routes use the store's configured UCP version. `CheckoutPrepareInput` and `PaymentSettleInput` gain a required `ucpVersion`, and payment handler adapters' `getAcpDiscoveryHandlers` and `getUcpDiscoveryHandlers` receive it as a required argument.

The 2026-01-23 profile now links `services/shopping/openapi.json`. Strict negotiation answers 424 `profile_unreachable` and 422 `profile_malformed`. An unknown declared version is rejected with 422 `version_unsupported` in both modes. A pin mismatch says "This session is bound to UCP version X; the agent profile now declares Y." A `UCP-Agent` header without `profile=` is treated as no profile and serves the current version. The agent profile body cap is 128 KiB.
