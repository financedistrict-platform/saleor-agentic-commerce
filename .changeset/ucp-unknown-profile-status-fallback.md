---
"@financedistrict/saleor-agentic-commerce-nextjs": patch
"@financedistrict/saleor-prism-payment": patch
---

An agent profile status that this nextjs build does not know is treated as an unreachable profile instead of throwing, so a newer core can never break requests that declare a profile. The core peer range is now ^1.1.2 for nextjs and prism-payment, so the same-origin profile redirect fix is always present.
