---
"@financedistrict/saleor-agentic-commerce-core": minor
"@financedistrict/saleor-agentic-commerce-nextjs": minor
"@financedistrict/saleor-prism-payment": minor
"@financedistrict/saleor-dummy-payment": minor
---

The default UCP version stays the latest one (currently 2026-08-25, as in 2.0.0). This release adds 2026-04-08 and 2026-01-23, which agents get when their profile declares them. Stores upgrading from 0.x or 1.x releases that served 2026-04-08 and want that root profile must set `ucpVersion: "2026-04-08"` (and `ucpSupportedVersions` if 2026-08-25 should stay enabled); agents that declare a version in their profile are served it either way. New optional config keys `ucpSupportedVersions` and `ucpVersionNegotiation`; new leaf route `discoveryVersion` for `/.well-known/ucp/[version]`; sessions keep the version they were created in. Prism discovery is requested per version, legacy Prism entries are accepted, and original-era instruments (`tokenized`, `default`, no type, `handler_id: "x402"`) still settle. `PaymentSettleInput` accepts input without `protocol` again.

Known differences from the original 0.7.1 release, kept from 1.0.0 / 2.0.0 on purpose:

- Under 2026-04-08, catalog search and lookup and the order body keep the 1.0.0 shapes (`has_next_page` / `cursor` / `total_count` instead of `total` / `limit` / `offset` / `has_more`; lookup returns resolved variants with `inputs[]`). The profile, checkout and error documents are byte-equal to 0.7.1.
- Error behaviour from 1.0.0 stays: `invalid_instrument` (400) exists, failures after settlement answer `settlement_not_recorded`, `order_not_recorded_after_settlement` or `order_not_completed_after_settlement` instead of `transaction_create_failed` / `checkout_complete_failed`, a not-ready checkout at complete answers 200 with the session, and several errors carry `recoverable` severity.
- The exported `UCP_VERSION` constant follows the default, so it stays `2026-08-25`; it is derived from the newest known version and moves when a later version is added, so pin `ucpVersion` if a store must not move.
- The Next.js integration needs the Node.js runtime (the agent profile fetch uses `node:https` and `node:dns`); the Edge runtime is not supported.
- If you set `ucpVersion` explicitly, also set `ucpSupportedVersions`: the default supported list is every known version except the latest (`2026-04-08` and `2026-01-23`), so `ucpVersion: "2026-04-08"` alone leaves `2026-08-25` disabled.
- The nextjs, prism-payment and dummy-payment packages now require `@financedistrict/saleor-agentic-commerce-core` `^1.1.0` as a peer: nextjs imports the version registry and the agent profile fetcher that core 1.1.0 adds.
