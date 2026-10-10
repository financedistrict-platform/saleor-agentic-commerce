---
"@financedistrict/saleor-agentic-commerce-nextjs": patch
---

UCP routes now check an `X-API-Key` header when one is sent: a key that is not the store's API key answers 401 `key_not_found`. Requests without the header are served as before.
