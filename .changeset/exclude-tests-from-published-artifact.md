---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
"@financedistrict/saleor-prism-payment": patch
"@financedistrict/saleor-dummy-payment": patch
---

Exclude `*.test.ts` files from the published `dist/` artifact. Trims a few KB and removes test-only `.d.ts` from the public type surface.
