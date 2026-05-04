---
"@financedistrict/saleor-prism-payment": minor
---

Switch Prism handler to protocol-specific Merchant API endpoints. The legacy `/api/v2/merchant/payment-profile` and `/api/v2/merchant/checkout-prepare` endpoints are deprecated; the handler now calls `/api/v2/merchant/{ucp,acp}/handlers` for discovery and `/api/v2/merchant/{ucp,acp}/payment-requirements` for checkout prepare.

Behavior changes visible to consumers:

- **UCP discovery** now includes the `spec` and `schema` fields from Prism's response (previously omitted).
- **ACP discovery and checkout-context handlers** are passed through verbatim from Prism instead of being hand-constructed on the client. Fields like `requires_delegate_payment`, `psp`, `config_schema`, and `instrument_schemas` now reflect Prism's authoritative values.
- **`prepareCheckoutPayment`** calls UCP and ACP prepare endpoints in parallel (fail-soft per protocol) and stores both responses for later use.
- Settlement still uses the shared `/api/v2/payment/settle` endpoint.
