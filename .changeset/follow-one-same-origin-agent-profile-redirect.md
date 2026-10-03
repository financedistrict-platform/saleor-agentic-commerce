---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
"@financedistrict/saleor-prism-payment": patch
---

The UCP agent-profile fetcher follows one same-origin redirect (301, 302, 303, 307, 308), so a profile URL that redirects by a trailing slash no longer falls back to the default version. Any other redirect (cross-origin, scheme change, credentials in the URL, or a second redirect) is rejected with 424 `profile_redirected` in both lenient and strict negotiation. The message names the Location and the structured log line carries it. Core and nextjs are released together with prism-payment so the three packages stay on one patch line.
