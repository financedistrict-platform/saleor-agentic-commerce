# Handler Registry — Design Doc

**Status:** Draft, pre-implementation
**Audience:** Maintainers, future third-party handler authors
**Updated:** 2026-05-02 (rev 2 — Prism gateway findings folded in)

## 1. Framing — neutral protocol gateway

The Saleor Agentic Commerce App is a **neutral protocol gateway**. It implements the UCP/ACP wire protocols for Saleor and routes traffic to pluggable payment handlers. It is *not* a payment product. Finance District happens to maintain it today, but the long-term home is a neutral party (Saleor, or a protocol-foundation org) — Finance District should be just one handler vendor in the resulting ecosystem.

Design consequences this doc enforces:

- **No handler-specific code in the App.** The App knows about a generic handler interface and nothing else. Prism is *one* handler, exactly the same shape any third party would build.
- **Open-source, permissive license, public protocol spec.** No private APIs between the App and the FD-built handler.
- **Repo and package ownership decoupled from feature ownership.** Anyone can contribute or fork. Eventual transfer to a neutral org should be a paperwork-only event.
- **No FD branding or telemetry baked in.** Author/manifest fields are configurable; no FD-phone-home in the gateway.

## 2. Two processes, one source of truth

There are two separate processes today, and the design clarifies who owns config:

```
┌────────────────────────────────┐         ┌────────────────────────────────┐
│ Saleor Agentic Commerce App    │         │ Merchant Storefront            │
│ (control plane)                │         │ (Next.js + storefront SDK)     │
│                                │         │                                │
│ - Dashboard UI in Saleor       │         │ - UCP/ACP endpoints            │
│ - Reads/writes Saleor metadata │         │ - Calls Saleor GraphQL         │
│ - Webhook receiver             │         │ - Routes UCP/ACP → handlers    │
│                                │         │                                │
│ TASK: write config to metadata │         │ TASK: read config at boot      │
│       render handler config UI │         │       instantiate handlers     │
└─────────────┬──────────────────┘         └────────────────┬───────────────┘
              │                                             │
              │ writes                                      │ reads
              ▼                                             ▼
       ┌─────────────────────────────────────────────────────────┐
       │ Saleor App `privateMetadata`  ← single source of truth  │
       │   key = `agentic-commerce.handler.{handler-id}.config`  │
       └─────────────────────────────────────────────────────────┘
```

**The App is the source of truth.** The storefront SDK is a consumer. This already aligns with the SDK's existing `configFromApp` / `loadConfigFromAppCached` mode — we are completing a half-built picture, not inventing one.

Implication: API keys, credentials, enable/disable flags, all per-handler config — managed in the App's dashboard, persisted to `privateMetadata`, read by the storefront at boot. No env vars on the storefront for handler config.

### Trade-off — secrets in metadata

Saleor `privateMetadata` is a metadata store, not a secrets vault. Whoever has `MANAGE_APPS` permission on the Saleor instance can read it. For most single-tenant deployments this is fine — same admin who installs the App is the one who'd otherwise set env vars. It also matches the precedent of Saleor's own Stripe payment App.

If field-level secret protection is needed later, the upgrade path is **store-a-reference-not-a-value**: privateMetadata holds e.g. `secret://aws-sm/prism-api-key`, the storefront resolves at boot. Don't build this until a real requirement appears.

## 3. Handler shape — align with the specs

**Both UCP and ACP define the handler shape on the wire.** We do not invent our own. The App's internal model is the union of fields both specs require, with two output adapters that serialize to each protocol's wire format.

### ACP `PaymentHandler` (from `spec/2026-04-17/json-schema/schema.agentic_checkout.json`)

Required:

```jsonc
{
  "id": "handler_stripe_01",                  // seller-defined instance identifier
  "name": "dev.acp.tokenized.card",           // reverse-DNS handler type
  "version": "2026-04-17",                    // YYYY-MM-DD
  "spec": "https://example.com/spec",         // URL to human-readable handler spec
  "requires_delegate_payment": false,         // bool
  "requires_pci_compliance": false,           // bool
  "psp": "stripe",                            // PSP identifier
  "config_schema": "https://.../config.json", // URL to JSON Schema for config
  "instrument_schemas": ["https://..."],      // URLs to JSON Schemas for instruments
  "config": { /* handler-specific */ }
}
```

Optional: `display_name` (human-readable label for buyer-facing UI), `display_order` (integer, lower = higher preference; suggestive only).

Discovery transport: per-session, embedded in the `CheckoutSession` response under `capabilities.payment.handlers[]`. There is **no** ACP well-known endpoint for handlers themselves — only `DiscoveryCapabilities` (services, extensions, intervention_types, supported_currencies, supported_locales).

### UCP handler declaration (from `payment-handler-guide.md`)

```jsonc
{
  "ucp": {
    "payment_handlers": {
      "com.example.handler": [
        {
          "id": "processor_tokenizer_1234",
          "version": "{{ ucp_version }}",
          "spec": "https://example.com/ucp/handler",
          "schema": "https://example.com/ucp/handler/schema.json",
          "available_instruments": [/* optional */],
          "config": { /* handler-specific */ }
        }
      ]
    }
  }
}
```

- Reverse-DNS identifier is the **object key** under `payment_handlers`, not a field.
- Single `schema` URL (not separated into config vs instrument like ACP).
- No `requires_*` flags, no `psp` field.
- Discovery transport: static, served at `/.well-known/ucp` (merchant-published).

### So they differ in shape

UCP and ACP share **concepts** (instance id, dated version, externally-hosted JSON Schema, merchant-supplied config blob) but the wire formats are not interchangeable. The gateway maintains a single internal model and serializes through two adapters: one to `/.well-known/ucp`, one to `capabilities.payment.handlers[]` in the `CheckoutSession` response.

### App internal model

The App stores per handler what's needed to drive both serializations and the dashboard UI:

```ts
type HandlerRegistration = {
  // Identity (both protocols)
  instanceId: string          // e.g. "handler_prism_01"   — stable per-merchant
  type: string                // e.g. "xyz.fd.prism_payment" (ACP `name` / UCP key)
  version: string             // YYYY-MM-DD

  // Spec + schemas (both protocols, slightly different layout)
  specUrl: string             // ACP `spec` / UCP `spec`
  configSchemaUrl: string     // ACP `config_schema` / UCP `schema`
  instrumentSchemas?: string[] // ACP `instrument_schemas` (UCP folds into `schema`)

  // ACP-only flags
  requiresDelegatePayment: boolean
  requiresPciCompliance: boolean
  psp: string

  // UCP-only
  availableInstruments?: unknown[]

  // Optional UI metadata
  displayName?: string
  displayOrder?: number

  // Merchant config (validated against configSchemaUrl)
  config: Record<string, unknown>
}
```

The dashboard fetches the JSON Schema at `configSchemaUrl` and renders the form (`react-jsonschema-form` or similar). Adding fields to a handler doesn't require an App release.

### Where handlers come from (App-side)

The App needs to obtain the metadata above from somewhere. Options, in order of complexity:

1. **In-tree manifest export** — handler npm package exports a static `manifest` constant. App imports it. Simplest. Works for any handler shipped alongside the App.
2. **Handler URL in privateMetadata** — merchant pastes a URL in the dashboard, App fetches `${url}/spec` (or follows the published `spec` URL convention) and derives the registration. Enables third parties without an App code change.
3. **Future** — npm-package convention (App scans installed packages for a known export marker). Defer.

Both ACP and UCP explicitly leave merchant onboarding / handler installation **out of band** ("non-goal" in ACP, "out-of-band" in UCP prerequisites section). This is our free space — the install UX is the App's invention.

### Prism gateway as the reference implementation

The Prism gateway (`fd-prism-platform/src/api/Prism.Platform.Api.Gateway/`) is a working reference for what a handler service should expose. As of latest develop it hosts both the protocol-conforming response *and* the spec docs the response references:

| Endpoint                                            | Purpose                                                      |
|-----------------------------------------------------|--------------------------------------------------------------|
| `POST /api/v2/merchant/acp/payment-requirements`    | Returns ACP-conforming `PaymentHandler` with config filled in (per-merchant, per-cart) |
| `GET /acp/spec.md`                                  | ACP handler specification (markdown)                         |
| `GET /acp/config_schema.json`                       | ACP `config_schema` URL target (JSON Schema Draft 2020-12)   |
| `GET /acp/instrument_schema.json`                   | ACP `instrument_schemas[]` URL target                        |
| `GET /ucp/schema.json`                              | UCP `schema` URL target                                      |
| `GET /ucp/prism.md`                                 | UCP handler specification (markdown)                         |

Two things this gives us:

1. **The adapter becomes a passthrough.** It doesn't construct the handler shape locally — it calls Prism, returns what Prism returned. No hardcoded URLs, no fake `https://fd.xyz/specs/...` references. The current Saleor adapter at `packages/prism-payment/src/handler.ts` does ad-hoc enrichment with placeholder URLs; this is wrong and should be deleted.
2. **The architecture generalizes.** Stripe (or any third party) builds a Stripe handler service that exposes the same shape: a `POST .../payment-requirements` per protocol + the static spec docs at well-known relative paths. The adapter doesn't change — only the configured base URL does.

Open gap on Prism's side: there is currently no `POST /api/v2/merchant/ucp/payment-requirements` analogue. The legacy `GET /api/v2/merchant/payment-profile` returns the minimal `{namespace: [{id, version}]}` shape, missing UCP's required `spec`, `schema`, and `config` fields. **The right fix is for the Prism team to add a UCP-conforming endpoint mirroring the ACP one.** Tracked in §10. As an interim, the adapter can enrich the minimal response with `spec: ${prismBaseUrl}/ucp/prism.md` and `schema: ${prismBaseUrl}/ucp/schema.json` (the static docs already exist at known paths) — but this is a stopgap, not the design.

## 4. Configuration storage layout

All configuration lives under a single namespace in Saleor App `privateMetadata`:

```
agentic-commerce.handler.{handlerId}.enabled        : boolean
agentic-commerce.handler.{handlerId}.config         : { ... per configSchema ... }
agentic-commerce.handler.{handlerId}.channels       : ["channel-slug-1", ...] | null  (null = all channels)
agentic-commerce.handlers.order                     : ["xyz.fd.prism_payment", "com.stripe.acp_payment"]
agentic-commerce.protocol.version                   : "1"  (for future migrations)
```

- **`.enabled`** — global on/off. Disabled = handler doesn't appear in discovery, no traffic routed.
- **`.config`** — values matching the handler's `configSchema`.
- **`.channels`** — per-channel scoping. `null` means all channels. Scoping is always allow-list; empty array = effectively disabled.
- **`handlers.order`** — explicit ordering, used as priority/fallback chain (see §6).
- **`protocol.version`** — allows future schema migration without breaking existing installs.

### Storefront SDK boot

The SDK at boot:
1. Calls `loadConfigFromAppCached(...)` (already implemented) to fetch all handler configs in one round trip.
2. For each enabled handler matching the current channel:
   - Resolves the handler implementation by `id` from a known set of npm packages
   - `new Handler(config)` — instantiate
   - `registry.registerAdapter(handler)` — register in the existing PaymentHandlerRegistry

If a handler is in metadata but not in the storefront's known npm deps, log a warning and skip — graceful degradation. Merchants can be told via the App dashboard "Storefront does not have this handler installed."

## 5. Enable/disable & per-channel scoping

Three levels of granularity, in increasing specificity:

| Level                  | Storage                                          | UI                  |
|------------------------|--------------------------------------------------|---------------------|
| Global enable          | `agentic-commerce.handler.{id}.enabled`          | Checkbox on handler card |
| Channel allow-list     | `agentic-commerce.handler.{id}.channels`         | Channels tab → matrix |
| Per-channel config (future) | `agentic-commerce.handler.{id}.channelConfig.{slug}` | Channel-specific override form |

For v1, levels 1 + 2 are sufficient. Level 3 (different config per channel for the same handler) is a possible future extension but adds complexity — defer.

**Hot-reload vs. boot-only:** The SDK loads config at boot today. To make dashboard toggles take effect immediately, either (a) shorten the cache TTL, or (b) emit a Saleor metadata-changed webhook from the App to the storefront. (b) is more correct but requires the storefront SDK to expose an invalidation endpoint. v1 = short TTL (60s). v2 = webhook invalidation.

## 6. Routing, priority, fallback

When multiple handlers are enabled for a channel:

- **Discovery (UCP/ACP "what handlers exist?")** — return all enabled handlers for the channel, in `handlers.order` order. Agents see all options.
- **Settlement (UCP/ACP "use this handler")** — agent specifies handler id; App routes to that exact handler. No ambiguity.
- **Optional fallback (future)** — if a handler returns a transient error during `prepareCheckoutPayment`, the registry attempts the next handler in `handlers.order`. Off by default.

Priority/fallback is mostly useful for resilience. Most agent flows want deterministic routing, so don't make fallback the default.

## 7. Other capabilities the model unlocks (idea backlog)

These fall naturally out of having a metadata-driven, dashboard-controlled registry. Not all v1, but worth designing for:

- **Threshold routing** — per-handler min/max amount, currency whitelist. "Prism for ≥$50, X for everything else."
- **Test mode toggle per handler** — separate sandbox API key with visual indicator.
- **Connection health** — last successful handshake, last error, surfaced on the handler card.
- **Activity log / audit trail** — who changed what config when. Natural fit for the existing Activity tab.
- **Scheduled enable/disable** — auto-enable a handler at a specific time (Black Friday).
- **Webhook subscription filtering** — choose which Saleor events flow to which handler.
- **Embedded handler admin UI** — manifest declares an iframe-able URL the App embeds for advanced settings beyond what `configSchema` can express.
- **A/B traffic splits** — same primitive as priority/fallback, different policy.

Each of these is an additional metadata key, not a new architecture. Keep them in mind so the v1 schema doesn't preclude them.

## 8. Sequencing

1. **Switch the adapter to call `POST /api/v2/merchant/acp/payment-requirements`** for ACP discovery + checkout-prepare in BOTH the Saleor (`packages/prism-payment/src/handler.ts`) and Medusa adapters. The endpoint already returns the ACP 2026-04-17 conforming shape with correct `id`, `name`, schema URLs, etc. — adapter becomes a passthrough. Delete the local hardcoding of `https://fd.xyz/specs/...` URLs and the `id: namespace` enrichment (which had `id` and `name` semantically backwards).
2. **For UCP:** request the Prism team to add `POST /api/v2/merchant/ucp/payment-requirements` mirroring the ACP one. As an interim, adapter enriches `payment-profile` with `spec: ${prismBaseUrl}/ucp/prism.md` + `schema: ${prismBaseUrl}/ucp/schema.json`.
3. **Pin protocol versions.** ACP `2026-04-17`, UCP latest stable. Document in code as constants.
4. **Slim down the App's Payment Handlers UI.** Remove hardcoded Prism fields. Replace with dynamic form rendered from the handler's `config_schema` URL.
5. **Build the App-side handler registry.** `privateMetadata` CRUD per §4, channel scoping per §5, enable/disable.
6. **Update the SDK to consume the new metadata layout.** `loadConfigFromAppCached` already does the fetch; instantiation logic switches from "import these packages" to "for each enabled handler registration, instantiate the matching adapter with config".
7. **Migrate the Prism handler package to expose a static manifest export.** No special-casing in the App.
8. **Add a stub second handler** to validate the abstraction before any real third party tries.
9. **Document for third-party handler authors** — "How to build a handler for the Agentic Commerce protocol", pointing at the actual ACP and UCP spec docs as the source of truth for wire formats. Use Prism gateway (`fd-prism-platform`) as the reference implementation.

Steps 1 + 2 are independent of the design doc and can ship before everything else — they fix existing bugs. Steps 4–7 are likely a single milestone.

## 9. Spec audit — resolved

A targeted audit of UCP (`universal-commerce-protocol/ucp`) and ACP (`agentic-commerce-protocol/agentic-commerce-protocol`, version `2026-04-17`) confirms:

- **Both specs define the handler shape.** Field names verified against `spec/2026-04-17/json-schema/schema.agentic_checkout.json` (ACP `PaymentHandler`) and `docs/specification/payment-handler-guide.md` (UCP). See §3 for the actual shapes.
- **Discovery transports differ.** ACP = per-session capability negotiation in `CheckoutSession`. UCP = static `/.well-known/ucp` document. The App implements both surfaces over the same internal model.
- **Both specs leave merchant onboarding / handler installation flow out of band** (ACP explicitly states "non-goal: centralized handler registry"; UCP describes prerequisites as out-of-band). Admin UX, secret storage, enable/disable, channel scoping — all our free space.
- **Schemas are JSON Schema Draft 2020-12 in both cases.** Validation library choice: anything Draft 2020-12 compliant.
- **OpenAPI for ACP gateway endpoints lives in `spec/2026-04-17/openapi/`.** Use it directly rather than authoring a parallel description.
- **`credential_schema` is NOT a field on ACP `PaymentHandler`.** Sage's initial recommendation included it; the actual schema does not.

### Reality check against Prism gateway source (latest develop)

- **Prism gateway implements the ACP-conforming endpoint** — `POST /api/v2/merchant/acp/payment-requirements` returns a fully ACP 2026-04-17 conforming `PaymentHandler` (see `Features/Merchant/AcpPaymentRequirements/Response.cs`). All required fields (`id`, `name`, `version`, `spec`, `requires_delegate_payment`, `requires_pci_compliance`, `psp`, `config_schema`, `instrument_schemas`, `config`) are present and correctly populated.
- **Prism hosts its own spec docs** at `/acp/spec.md`, `/acp/config_schema.json`, `/acp/instrument_schema.json`, `/ucp/schema.json`, `/ucp/prism.md`. URLs in the response point at these gateway-hosted resources.
- **The current Saleor and Medusa adapters call the wrong endpoint.** They call legacy `/api/v2/merchant/payment-profile` (which still returns the minimal `{namespace: [{id, version}]}` shape) and locally enrich with placeholder `https://fd.xyz/specs/...` URLs that don't resolve. Both should switch to `acp/payment-requirements` and pass the response through unchanged. See §8 step 1.
- **Prism does NOT yet have a UCP-conforming endpoint.** No analogue to `acp/payment-requirements` for UCP. The legacy `payment-profile` is missing the required `spec`, `schema`, `config` fields. Tracked in §10 as a request to the Prism team.
- **Prism's actual `id`/`name` semantics:** `id` is the instance/scheme identifier (literal value `"x402"`), `name` is the reverse-DNS handler type (`"xyz.fd.prism_payment"`). Both adapters had these fields backwards (set `id` to the namespace string). Fixed by switching to passthrough.

## 10. Remaining open questions

- **Prism team to add `POST /api/v2/merchant/ucp/payment-requirements`** mirroring the ACP-conforming endpoint. Until that lands, adapters fall back to local enrichment of `payment-profile` with the gateway-hosted UCP spec URLs (`/ucp/prism.md`, `/ucp/schema.json`).
- **Trust model for handler URL discovery (post-v1)** — when merchants paste a handler URL, what's the auth handoff? Bearer token? Signed request? Defer until v1 ships.
- **Hot-reload mechanism** — short TTL (v1) vs. webhook-driven invalidation (v2).
- **Multi-tenancy on Saleor metadata** — if a Saleor instance hosts multiple isolated tenants, can per-tenant admins read each other's handler API keys? Confirm against Saleor's auth model.
- **Deprecate or keep `/api/v2/merchant/payment-profile`?** Once both adapters are off it, decide whether Prism keeps the legacy endpoint for back-compat or removes it.

## 11. Non-goals

- **FD-operated handler marketplace.** Out of scope.
- **In-App payment processing.** The App is a gateway; it does not process payments. All payment logic lives in handlers.
- **Saleor payment-app replacement.** UCP/ACP handlers operate on the agent flow, not the regular checkout payment gateway. Existing Saleor payment apps continue to work alongside.
- **FD-specific telemetry.** No phone-home from the gateway.
- **Re-implementing Saleor-native concerns** (shipping methods, channels, currencies, products, addresses, …). See §12.

## 12. Saleor-native concerns vs. external services — two integration patterns

Not everything the protocols expose is a third-party service that needs registration. The App must keep these two patterns separate:

**Pattern A — External services (handler registry):**
- Examples: payment handlers (Prism, Stripe), future tax-calculation services, future address-validation services.
- Source of truth lives outside Saleor. Each one is a separate deployable service.
- App's role: register them, configure them in dashboard, route protocol traffic.
- This is what §3–§6 describe.

**Pattern B — Saleor-native concerns (read-through translation):**
- Examples: shipping methods, channels, currencies, products, fulfillment zones, customer addresses, taxes-as-configured-on-Saleor.
- Source of truth lives in Saleor itself, configured via Saleor's existing admin UI.
- App's role: **none in the configuration plane**. The storefront SDK reads from Saleor at request time and translates the data into UCP/ACP shapes.
- The merchant configures these in Saleor as they always have. Adding an "Agentic Shipping" tab in the App would be re-implementing what already exists.

Concrete example, shipping methods:

```
[Agent] ──UCP/ACP request──▶ [Storefront SDK]
                                    │
                                    │ GraphQL: Checkout.availableShippingMethods
                                    ▼
                              [Saleor backend]
                                    │
                                    │ shippingMethods (already filtered by
                                    │ channel, zone, cart contents)
                                    ▼
                            [Storefront SDK formatters/ucp.ts:
                             formatCheckoutFulfillment()
                             → fulfillment.methods[]]
                                    │
[Agent] ◀──fulfillment.methods[]── │
```

This already works today — `packages/core/src/lib/formatters/{ucp,acp}.ts` translate `checkout.shippingMethods` to `fulfillment.methods[]` / `fulfillment_options[]`. The App is not in the loop, by design.

**How to decide which pattern a new concern belongs to:**

| Question                                                                 | Pattern A (handler registry)         | Pattern B (read-through translation)   |
|--------------------------------------------------------------------------|--------------------------------------|----------------------------------------|
| Does it require its own deployable service?                              | Yes                                  | No — Saleor handles it                 |
| Does each merchant configure it differently per-instance?                | Yes (different API keys, etc.)       | Yes, but in Saleor's UI, not ours      |
| Does the configuration belong to the protocol or to Saleor?              | Protocol (handler-specific schemas)  | Saleor (already-modeled domain)        |
| Multiple competing implementations possible?                             | Yes (Prism vs Stripe vs Klarna)      | No — Saleor *is* the implementation    |

If unsure, default to Pattern B. Adding an "Agentic X" tab to the App should require justification, not be the default.

---

**Next concrete step:** spec audit (open question #1) + first PR slimming the Prism config UI. The slim-down PR can land before the broader registry exists; the new UI just hardcodes one handler manifest while we build the rest.
