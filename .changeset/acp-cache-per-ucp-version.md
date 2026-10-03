---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
"@financedistrict/saleor-prism-payment": patch
---

The Prism ACP discovery cache is keyed by UCP version, so a store serving several UCP versions never returns a handler entry cached for another version. The prism-payment README examples pass the required `ucpVersion` to `getUcpDiscoveryHandlers` and `getAcpDiscoveryHandlers`. Core and nextjs are released together with prism-payment so the three packages stay on one patch line.
