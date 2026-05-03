# TODO

Backlog for the Saleor Agentic Commerce App + SDK. Living document — keep
items sized so they're individually shippable. When something starts, link
the PR; when it's done, strike or remove.

## In flight

- **fd-infra#49** — install runbook rewrite (docs only)
- **saleor-agentic-commerce#7** — handler registry design doc (review)

## Up next

- [ ] **Webhook live test (test env).** Create a regular Saleor order in the
      dashboard; verify the four webhook subscriptions deliver 200s in the
      App's webhook history (Apps → Agentic Commerce → Webhooks). The App's
      handlers will no-op on non-agent orders by design — what we're proving
      is just that the wire is up.
- [ ] **Storefront SDK end-to-end check.** Hit the storefront's
      `/.well-known/ucp` and `/.well-known/acp.json`. Confirm:
      - UCP `payment_handlers` includes `xyz.fd.prism_payment` with the
        new (post-#8) `id="x402"`, `name="xyz.fd.prism_payment"` semantics.
      - ACP `capabilities.payment.handlers[]` includes the same with
        gateway-hosted spec URLs (no more `fd.xyz/specs/...` placeholders).
      - `fulfillment.methods[]` reflects whichever shipping methods are
        configured on the active channel in Saleor (sanity-check the
        Pattern B read-through is working).
- [ ] **Audit App's other tabs** — General / Channels / Activity. What's
      actually wired vs. stub? Likely the same `no-save` pattern the Prism
      tab had until #10. Map each tab's state and queue follow-ups.

## Cleanup / DX

- [ ] **Automated SDK release workflow.** Today every npm publish is
      manual: bump versions in three packages, push, merge, run
      `pnpm -r publish` from a workstation, then bump the storefront's
      deps in a separate PR. Use Changesets or release-please so version
      bumps are derived from PR descriptions and publish happens from CI
      on merge. Bonus: auto-generate a CHANGELOG. This was painful
      enough on the 0.2.2 → 0.3.0 ship that it's worth doing before the
      next release.
- [ ] **Drop `ALLOWED_SALEOR_URLS` plumbing from `route.ts`.** The conditional
      that splits the env var is now dead code (we're explicitly
      open-tenant). Small refactor.
- [ ] **Add a "Deploy Saleor Stack" workflow.** Today the saleor-api /
      worker / dashboard deploy via manual `terraform apply -target=...`.
      We hit this when applying the worker `PUBLIC_URL` fix. A reusable
      caller workflow analogous to `deploy-saleor-agentic-app.yml` would
      make it ops-friendly.
- [ ] **Investigate the JWKS-returning-HTML bug.** During the install dance
      the SDK logged `"jwks": "<!DOCTYPE html>…"` — the storefront's JWKS
      endpoint returned a 404 HTML page. Install completed anyway, so
      cosmetic — but worth understanding: is the JWKS supposed to be at the
      App URL or the Saleor URL? Verify against the SDK source and either
      fix the route or filter the field out of the print.
- [ ] **`PaymentHandlerSettings`: dynamic config form from JSON Schema.**
      Today the v1 Prism form is hand-written. When the registry lands and
      handlers expose their `config_schema` URL, swap to schema-driven
      rendering (e.g. `react-jsonschema-form`).

## Handler registry — implementation tracks
*(driven by design doc PR #7)*

- [ ] **Implement handler registry storage layer.** `privateMetadata` shape:
      `agentic-commerce.handler.{id}.{enabled,config,channels}` +
      `agentic-commerce.handlers.order`. Replace the current hardcoded
      Prism-only path.
- [ ] **Storefront SDK: read registry config at boot.**
      `loadConfigFromAppCached(...)` already does the fetch; instantiation
      logic switches from "import these packages" to "for each enabled
      handler in metadata, instantiate from known package".
- [ ] **Migrate Prism handler package to expose static manifest export.**
      `id`, `name`, `version`, `configSchema`, `manageUrl`. App imports
      the manifest; no special-casing.
- [ ] **Add a stub second handler** to validate the registry abstraction
      before any real third party tries.
- [ ] **Multi-handler "Add Handler" UI** in the App. Manifest URL paste +
      auto-discovery from handler's `/handler-info` (or whatever shape lands
      from fd-prism-platform#22).
- [ ] **Per-channel scoping UI.** Surfaces the
      `PaymentHandlerEntry.channels` field. Today defaulted to `null` (all
      channels); UI exposes an allow-list per handler.
- [ ] **Connection health badge** on each handler card. "Last successful
      connection: 5 min ago / Last error: …". Stored in privateMetadata so
      multiple App instances share state.
- [ ] **Webhook subscription filtering per handler.** Manifest declares
      which Saleor events a handler wants; App routes accordingly.

## Documentation / handover prep
*(per design doc framing — App should be hand-off-ready)*

- [ ] **Add MIT or Apache-2.0 LICENSE** to the saleor-agentic-commerce repo.
      Currently no top-level license — required for the open-source posture.
- [ ] **Public handler-protocol spec repo** (or top-level `spec/` directory).
      Separate artifact from the App so third parties can implement against
      it without forking ours.
- [ ] **"How to build a handler"** developer guide. Points at ACP 2026-04-17
      and UCP specs as wire-format authority; uses Prism gateway as the
      reference implementation.
- [ ] **Re-brand the App for neutrality.** Today `manifest.ts` says
      `author: "Finance District"`. When/if the repo transfers to a neutral
      org, flip these. Track here so we don't forget.

## Cross-repo / external

- [ ] **fd-prism-platform#22** — Prism team to add discovery endpoints:
      - `GET /api/v2/merchant/acp/handlers` (ACP without cart context)
      - `POST /api/v2/merchant/ucp/payment-requirements` (UCP with cart
        context, mirroring the existing ACP one)
      Once these land, the Saleor + Medusa adapters become pure
      passthroughs (no local enrichment).
- [ ] **Medusa adapter parallel fix.** Update
      `medusa-plugin-agentic-commerce` Prism handler to match #8: correct
      `id`/`name` semantics, drop placeholder URLs, point to gateway-hosted
      spec URLs. (Larger than the Saleor fix because Medusa was using the
      old inline `credential_schema` shape — needs a more substantial
      migration to URL-based.)

## Future capability ideas
*(from design doc §7 — defer until after registry lands)*

- [ ] Threshold routing (per-handler min/max amount, currency whitelist).
- [ ] Test mode toggle per handler (separate sandbox API key, visual
      indicator).
- [ ] Activity log / audit trail of dashboard config changes.
- [ ] Scheduled enable/disable (e.g. flip on a high-throughput handler at
      Black Friday).
- [ ] Embedded handler admin UI (handler manifest declares an iframe-able
      URL the App embeds for advanced settings).
- [ ] A/B traffic split between handlers.

## Done

- ✅ App installed + registered on test (FileAPL → captured token → EnvAPL,
      `PRINT_AUTH_DATA_ON_REGISTER` cycle complete)
- ✅ Saleor worker `PUBLIC_URL` fix
- ✅ Agentic-app `HOSTNAME=0.0.0.0` + GET health check + manifest fixes
- ✅ Open-tenant config (no `ALLOWED_SALEOR_URLS`)
- ✅ `apps/saleor-agentic-commerce-app/DEPLOYMENT.md`
- ✅ Prism handler ACP id/name fix + gateway-hosted URLs (#8)
- ✅ Slim Prism config UI + privateMetadata persistence (#10)
- ✅ Test Connection proxy (CORS fix) (#11)
- ✅ Storefront SDK fixes — `endpoint` from `storefrontUrl`, handler reader
      reads new `agentic_commerce__handler__*` shape (#13)
- ✅ Published SDK packages 0.3.0 to npm (core, nextjs, prism-payment)
- ✅ fd-grocery-store bumped to 0.3.0 (1stdigital/fd-grocery-store#6)
- ✅ Handler registry design doc (PR #7, in review)
- ✅ Spec audit confirming UCP/ACP shape (folded into #7)
- ✅ §12: Saleor-native concerns vs external services (folded into #7)
