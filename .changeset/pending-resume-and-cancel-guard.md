---
"@financedistrict/saleor-agentic-commerce-core": patch
"@financedistrict/saleor-agentic-commerce-nextjs": patch
"@financedistrict/saleor-prism-payment": patch
"@financedistrict/saleor-dummy-payment": patch
---

A pending payment can now be resumed. The pending settlement record keeps a sha256 digest of the payment credential and any transaction the gateway reported. A later `complete` with the same credential goes back to the gateway as a resume (the expired-authorization check is skipped, the gateway decides); a different credential gets 409 `payment_pending_mismatch`; a pending record without a digest is held for review. Two parallel resumes record one checkout transaction.

Breaking UCP changes: a pending payment answers 202 with the checkout session, `status: "complete_in_progress"` and message `settlement_pending` (was 409). A payment that needs review answers 200 with `status: "requires_escalation"` and message `payment_requires_review` followed by the specific code (was 409). This includes a failure to record or complete the order after the payment settled. The quote-expired code is renamed `quote_expired` (was `payment_quote_expired`). ACP keeps 409 for pending and review, with corrected messages.

Cancel and update now refuse while money is pending, held or settled, on UCP and ACP: 409 `session_complete_in_progress`, `session_requires_escalation` or `session_completed`. Cancel writes its flag, reads it back and rolls it back if a settlement started meanwhile (409 `cancel_conflict` when another write replaced the flag, 503 `cancel_not_confirmed` when the roll back fails). A complete that finds the cancel flag after recording its pending settlement does not submit the payment. GET reports `complete_in_progress` for a pending record and `requires_escalation` for a held one. `PaymentSettleInput` gains `resume`, and a held record's `reference` is now optional.
