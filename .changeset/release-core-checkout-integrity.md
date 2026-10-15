---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
---

Publish the core code that the Next.js and Prism payment packages already depend on: settlement is recorded as pending before the gateway is called and recovered on retry, a settled payment cannot be reused by another checkout, amounts are converted by each currency's minor unit, payment quotes expire, and every checkout session route (get, update, complete, cancel) and order read needs the UCP-Session-Secret header: 401 session_secret_required without it, 404 checkout_not_found or order_not_found with a wrong one. The Next.js and Prism payment packages now require core 1.1.3 or newer, so an install can no longer pair them with the older core.
