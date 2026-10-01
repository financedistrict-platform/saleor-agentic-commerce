---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
---

Gate checkout completion on the commerce engine's own validation. The complete endpoint now confirms the checkout is completable before settling payment, so funds are captured only once the order can actually be placed. Checkout sessions expose readiness through `status` (`incomplete` / `ready_for_complete`) and surface the engine's validation errors as UCP `messages`.
