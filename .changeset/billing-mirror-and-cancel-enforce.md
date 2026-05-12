---
"@financedistrict/saleor-agentic-commerce-nextjs": patch
---

Auto-mirror the billing address from the shipping address. UCP has no first-class billing block in its body, and ACP only carries one optionally — without a fallback, Saleor's `checkoutComplete` fails with `BILLING_ADDRESS_NOT_SET`. The UCP `createCheckout` and shipping-address-update routes now always mirror billing to the supplied shipping address. The ACP routes mirror only when the caller did not provide an explicit `billing_address`. In both cases the mirror is skipped on update if Saleor already has a billing address recorded, so we don't clobber a deliberate one.

Make cancel actually stick. The cancel endpoint was writing a `{ucp,acp}_canceled=true` flag into the checkout's private metadata, but neither the complete nor the update endpoint inspected it — so an agent that aborted and retried could still sign and settle against a session it thought was dead. The UCP and ACP `complete` endpoints now refuse with HTTP 409 `session_canceled` when the flag is set, the `update` endpoints do the same to block further mutations, and the `GET` endpoint reflects the canceled status instead of always reporting the active checkout.
