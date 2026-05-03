# TODO

Backlog for the Saleor Agentic Commerce App + SDK. Living document — keep
items sized so they're individually shippable. When something starts, link
the PR; when it's done, strike or remove.

## In flight

_(empty)_

## Up next

- [ ] **Webhook live test (test env).** Create a regular Saleor order in the
      dashboard; verify the four webhook subscriptions deliver 200s in the
      App's webhook history (Apps → Agentic Commerce → Webhooks). The App's
      handlers will no-op on non-agent orders by design — what we're proving
      is just that the wire is up.

## Tab audit — follow-ups
*(survey of General / Channels / Activity tabs in the App, 2026-05-03)*

The dashboard saves a number of fields the SDK reads but doesn't actually
enforce. Either close the gap (make the SDK honor them) or remove the
fields so we don't mislead merchants.

- [ ] **Master `enabled` toggle is decorative.** Saved as
      `agentic_commerce__enabled`, read by `loadConfigFromApp` into
      `appConfig.enabled`, **never used** anywhere in the SDK. Merchants
      who toggle off in the dashboard still serve UCP/ACP routes. Either:
      (a) the SDK's UCP/ACP route handlers short-circuit when
      `appConfig.enabled === false`, or (b) hide the toggle until (a)
      ships. Currently misleading.
- [ ] **`ucpEnabled` / `acpEnabled` per-protocol toggles are decorative.**
      Same pattern as the master toggle — saved, read, ignored. Either
      enforce (route handlers 404 when disabled) or remove.
- [ ] **Per-channel `enabled` is decorative.** Saved per channel via the
      Channels tab, never enforced. UCP/ACP requests aren't filtered by
      channel today (the SDK uses a default channel from config). Tied
      to per-channel handler scoping work in the registry track —
      probably best implemented together.
- [ ] **Per-channel `protocols` selector is decorative.** Same.
- [ ] **GeneralSettings "SDK Setup" code example is out of date.** Shows
      a minimal `configFromApp: true` snippet but omits the
      `paymentHandlerFactory` callback that's actually required to
      instantiate handlers (mirroring what we just shipped in
      fd-grocery-store#7). Update the example to match real usage, or
      link to fd-grocery-store as a reference impl.
- [ ] **Activity tab is a pure stub.** All stats `—`, empty-state
      reads "Phase 4 coming soon". No data fetching. Implementation
      blocked on activity persistence (today the webhook handlers
      `// TODO Phase 4: Write to activity tracking storage`). Decide
      whether to ship a minimal v1 (e.g. show recent agent orders read
      directly from Saleor with the `agent_session` privateMetadata
      filter) or leave the stub and remove the misleading numbers row.
- [ ] **ACP API Key regeneration is local-only.** Pressing "Regenerate"
      in GeneralSettings produces `acp_<random hex>` purely client-side.
      No server-side validation that it's well-formed; nothing rotates
      stored consumers of the previous key. Fine for v1 (single
      Bearer-token model), but worth a doc note.

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
- ✅ Handler registry design doc — spec audit + §12 Saleor-native vs external services (#7)
- ✅ Install runbook rewrite for the EnvAPL flow (fd-infra#49)
- ✅ TODO.md backlog (#12) + release-automation item (#14)
- ✅ Tab audit (this doc, 2026-05-03) — gap items captured above
- ✅ **Pattern A architecture proven end-to-end** (2026-05-03):
  dashboard → privateMetadata → App `/api/config-public` (cross-App
  HTTP bridge with Saleor-token validation) → SDK `loadConfigFromApp`
  (HTTP mode via `agenticCommerceAppUrl`) → `paymentHandlerFactory`
  → registry → discovery output. `/.well-known/ucp` finally shows
  `payment_handlers.xyz.fd.prism_payment` populated from the dashboard
  config. PRs: saleor-agentic-commerce#16 (App + SDK 0.4.0),
  fd-grocery-store#8 (storefront), fd-infra#50 (env var).
