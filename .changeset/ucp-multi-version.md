---
"@financedistrict/saleor-agentic-commerce-core": minor
"@financedistrict/saleor-agentic-commerce-nextjs": minor
"@financedistrict/saleor-prism-payment": minor
"@financedistrict/saleor-dummy-payment": minor
---

Serve UCP 2026-04-08 by default again, plus 2026-08-25 and 2026-01-23 per agent profile. New optional config keys `ucpSupportedVersions` and `ucpVersionNegotiation`; new leaf route `discoveryVersion` for `/.well-known/ucp/[version]`; sessions keep the version they were created in. Prism discovery is requested per version, legacy Prism entries are accepted, and original-era instruments (`tokenized`, `default`, no type, `handler_id: "x402"`) still settle. `PaymentSettleInput` accepts input without `protocol` again.
