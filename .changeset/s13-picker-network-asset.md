---
"@financedistrict/saleor-prism-payment": patch
---

Match `accepts[]` entries on (network, asset) so carts advertising multiple assets per network resolve to the entry the wallet actually signed for. Falls back to legacy (network, scheme) and single-entry resolution when asset is unreadable.
