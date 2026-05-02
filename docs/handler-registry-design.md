# Handler Registry — Design Doc

**Status:** Draft, pre-implementation
**Audience:** Maintainers, future third-party handler authors
**Updated:** 2026-05-02

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

## 3. Handler manifest

Every handler exposes a manifest the App uses to render config UI and route traffic. Handlers are discoverable by the App through one of:

- **Local registry** — App ships with a list of known handler manifests (npm packages it knows about). Simplest. Works for v1.
- **URL-pasted manifest** — merchant pastes a handler manifest URL in the dashboard, App fetches it. Enables third parties without an App release.
- **Future: curated marketplace** — explicitly out of scope; FD does not intend to operate one.

### Manifest shape (proposed)

```ts
type HandlerManifest = {
  /** Stable identifier, namespaced. e.g. "xyz.fd.prism_payment", "com.stripe.acp_payment" */
  id: string

  /** Human-readable name shown in the dashboard */
  name: string

  /** Optional one-line description */
  description?: string

  /** Optional URL the dashboard deep-links to for advanced settings */
  manageUrl?: string

  /** JSON Schema describing fields the App should render in the config form */
  configSchema: JSONSchema7

  /** Protocol versions the handler supports — App uses for routing */
  protocols: {
    ucp?: { version: string }
    acp?: { version: string }
  }

  /** Optional capability flags — drives UI affordances */
  capabilities?: {
    testConnection?: boolean   // App offers a "Test Connection" button
    sandbox?: boolean          // Handler has a sandbox/test mode
    webhooks?: string[]        // Saleor event types this handler wants
  }
}
```

**Why JSON Schema for `configSchema`:**
- Existing standard, dynamic UI rendering trivial (`react-jsonschema-form` etc.)
- Adding new fields to a handler doesn't require an App release
- Aligns with the broader HTTP/OpenAPI ecosystem
- We'd like to align with whatever UCP/ACP themselves specify for discovery if anything; pending a spec audit (see §9 open questions)

### Where the manifest lives

For an in-tree handler (e.g. current Prism): exported as a static `manifest` constant from the handler npm package.

For an out-of-process handler (future Stripe): served at a known endpoint on the handler service (e.g. `GET /handler-info` returning the manifest as JSON).

The App treats both uniformly — it just needs a manifest object, doesn't care where it came from.

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

1. **Verify Prism's UCP/ACP surface** — does Prism's existing API already conform, or is the current `packages/prism-payment` adapter doing real translation? (Open question, see §9.)
2. **Define the handler protocol spec** as a separate artifact, neutral of FD branding. Public repo, permissive license. This is the contract third parties build against.
3. **Slim down the App's Payment Handlers UI** — remove hardcoded Prism fields. Replace with dynamic form rendered from `configSchema`.
4. **Build the App-side handler registry** — `privateMetadata` CRUD, channel scoping, enable/disable.
5. **Update the SDK to consume the new metadata layout** — `loadConfigFromAppCached` already does the loading; instantiation logic needs to switch from "import these packages" to "for each enabled handler in metadata, instantiate from known package".
6. **Migrate Prism handler to the new manifest-based registration** — exports static `manifest`, no special-casing in the App.
7. **Add a stub second handler** to validate the abstraction before any real third party tries.
8. **Document for third-party handler authors** — "How to build a handler for the Agentic Commerce protocol".

Steps 3–6 are likely a single milestone. Step 2 (the spec) can run in parallel with 1.

## 9. Open questions

- **Does UCP and/or ACP already define handler discovery / config introspection?** If yes, align with it. Pending audit by Sage (protocol architect agent) against the actual UCP and ACP specs.
- **Does Prism's existing API already speak UCP/ACP at the wire level?** Currently the in-tree adapter does meaningful translation (`payment-profile`, `checkout-prepare`, `settle` are Prism-specific). Either Prism grows ACP-shaped endpoints, or a thin `prism-acp-handler` service ships separately, or the in-tree adapter stays in-process for now. Decision should be informed by the spec audit.
- **Trust model for handler URL discovery (post-v1)** — when merchants paste a handler URL, what's the auth handoff? Bearer token? Signed-request? Defer until v1 ships.
- **Hot-reload mechanism** — short TTL (v1) vs. webhook-driven invalidation (v2).
- **Multi-tenancy on Saleor metadata** — if a Saleor instance hosts multiple isolated tenants, can per-tenant admins read each other's handler API keys? Confirm against Saleor's auth model.

## 10. Non-goals

- **FD-operated handler marketplace.** Out of scope.
- **In-App payment processing.** The App is a gateway; it does not process payments. All payment logic lives in handlers.
- **Saleor payment-app replacement.** UCP/ACP handlers operate on the agent flow, not the regular checkout payment gateway. Existing Saleor payment apps continue to work alongside.
- **FD-specific telemetry.** No phone-home from the gateway.

---

**Next concrete step:** spec audit (open question #1) + first PR slimming the Prism config UI. The slim-down PR can land before the broader registry exists; the new UI just hardcodes one handler manifest while we build the rest.
