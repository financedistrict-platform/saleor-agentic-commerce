---
"@financedistrict/saleor-agentic-commerce-nextjs": patch
---

Fix cancel guards never firing. PR #40 added server-side cancel enforcement on the UCP and ACP `update`, `complete`, and `GET` routes, but the guards were comparing `metadata.{ucp,acp}_canceled === "true"` (string) — and `metadataToRecord` runs `JSON.parse` on every value, so the literal `"true"` written by the cancel route comes back as the boolean `true`. The string comparison therefore never matched and the guards never fired; an agent that aborted and retried could still mutate, sign, and settle against a session it thought was dead. The guards now compare against the boolean `true`, which is what `JSON.parse("true")` actually returns. A regression test on `metadataToRecord` pins this contract so a future "cleanup" of the parser can't silently re-break the guards.
