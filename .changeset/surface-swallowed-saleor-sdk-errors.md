---
"@financedistrict/saleor-agentic-commerce-nextjs": patch
---

Surface Saleor SDK errors that were silently swallowed in three route call sites (UCP + ACP):

- **Cancel** — `updatePrivateMetadata` write result was discarded. If the write failed, the route returned `status: "canceled"` but the flag never landed, so the cancel guards from #42 would not fire on the next request. Now returns HTTP 422 `cancel_persist_failed` on write failure.
- **Complete** — `selectedInstrument.billing_address` (UCP) / `payment_data.billing_address` (ACP) override discarded the `updateCheckoutBillingAddress` result. Settlement could proceed against the previous billing address with no error. Now returns HTTP 422 `billing_address_update_failed`, mirroring the PUT route.
- **Prepare-payment** — `updatePrivateMetadata` write of the prepared Prism config was discarded. Failures rendered empty `payment_handlers` invisibly. Now logged via `console.error` with the checkout id; flow continues (self-healing on retry).

Happy paths unchanged. Tests 64/64. `tsc --noEmit` clean.
