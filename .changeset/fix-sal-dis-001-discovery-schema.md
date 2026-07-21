---
"@financedistrict/saleor-agentic-commerce-core": patch
---

Fix discovery profile to include required `spec` and `schema` fields on all capability entries, and `schema` on the service block, per UCP spec (REST transport requires `schema`; all capabilities require `version`, `spec`, and `schema`).
