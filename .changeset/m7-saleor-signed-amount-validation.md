---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
---

Security: validate the agent's signed x402/EIP-3009 payment payload against the checkout's stored Prism quote (network, asset, amount, recipient) at the UCP and ACP `/complete` route handlers before forwarding to settlement. Closes a class of payment-validation gaps where the SDK could accept a signed payload whose fields didn't match the merchant's quote. Mismatches now return HTTP 422 with a specific error code.
