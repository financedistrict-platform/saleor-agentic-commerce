# @financedistrict/saleor-dummy-payment

Dummy / test payment handler for the Saleor Agentic Commerce SDK.

**This handler does not move money.** It synthesizes a payment lifecycle
locally with no remote API calls. It exists to:

1. **Validate multi-handler support end-to-end.** Adding the dummy
   alongside Prism (or any other real handler) confirms the App's
   registry, the storefront SDK's factory dispatch, and the protocol
   formatters all work without single-handler assumptions baked in.
2. **Serve as a reference implementation** for third-party handler
   authors. Reading the source is a quick way to learn what shape a
   handler needs without having to mentally subtract any specific
   payment vendor's logic.
3. **Exercise error paths.** Configurable settlement mode lets tests
   provoke deterministic failures.

Don't use it in production.

## Install

```bash
npm install @financedistrict/saleor-dummy-payment
```

This package has a `peerDependency` on
`@financedistrict/saleor-agentic-commerce-core`.

## Usage — explicit instance (Path A or B)

```ts
import { DummyPaymentHandler } from "@financedistrict/saleor-dummy-payment"

const dummy = new DummyPaymentHandler({
  mode: "always_succeed",  // or "always_fail" / "random"
  delayMs: 0,
})

const ac = createAgenticCommerce({
  // ...
  paymentHandlers: [dummy],
})
```

Env vars take precedence over passed options:

| Env var                    | Effect                                      |
|----------------------------|---------------------------------------------|
| `DUMMY_PAYMENT_MODE`       | `always_succeed` / `always_fail` / `random` |
| `DUMMY_PAYMENT_DELAY_MS`   | Artificial settlement latency (integer ms)  |

## Usage — self-registration (App-managed mode)

```ts
import { manifest } from "@financedistrict/saleor-dummy-payment"
import { registerHandler } from "@financedistrict/saleor-agentic-commerce-core"

await registerHandler({
  agenticCommerceAppUrl: process.env.AGENTIC_COMMERCE_APP_URL,
  saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
  saleorAppToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
  manifest,
})
```

## Behavior

### `mode = "always_succeed"` (default)
Settlement returns `{ success: true, transactionReference: "dummy_tx_<timestamp>_<rand>" }`.

### `mode = "always_fail"`
Settlement returns `{ success: false, error: "Dummy handler simulated failure (mode=always_fail)" }`.

### `mode = "random"`
Coin flip per settlement call. Useful for confirming the gateway handles both paths gracefully in retry/log/UX code.

### `delayMs > 0`
Both `prepareCheckoutPayment` and `settlePayment` sleep that long before responding. Useful for testing timeout handling in callers.

## What this handler is NOT

- Not a payment gateway integration (use a real one in production)
- Not a sandbox for an upstream provider — there is no upstream
- Not authenticated — anyone calling settle gets the configured response

## Config schema

The `manifest.configSchema` advertises:

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": ["always_succeed", "always_fail", "random"],
      "default": "always_succeed"
    },
    "delayMs": {
      "type": "integer",
      "minimum": 0,
      "maximum": 30000,
      "default": 0
    }
  }
}
```

The Agentic Commerce App's dashboard renders this as a form once the
dynamic config form renderer ships (currently the dashboard hardcodes
the Prism form; that's tracked as a follow-up).

## Instrument schema

Not applicable — there is no payment instrument. The `instrument_schemas`
URL in this handler's discovery output is a placeholder pointing at this
README; agents should not attempt to render an instrument form for the
dummy.
