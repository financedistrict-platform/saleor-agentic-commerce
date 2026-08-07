# Deploying the Saleor Agentic Commerce App

Production-bound deployment notes for `@financedistrict/saleor-agentic-commerce-app`. The app is a Saleor App (in the `@saleor/app-sdk` sense) that gets installed into a Saleor instance from the dashboard. This document captures the gotchas we hit doing the first installation; treat it as the runbook for future environments.

## What you're deploying

A Next.js 14 (standalone output) service that:

- Serves `/api/manifest` describing itself to Saleor
- Receives `POST /api/register` from Saleor at install time
- Receives Saleor webhooks (ORDER_CREATED, ORDER_UPDATED, ORDER_CANCELLED, FULFILLMENT_CREATED)
- Renders a dashboard UI mounted into Saleor as iframe extensions

It is the **control plane**. It does not handle agent traffic — that lives in the merchant's storefront via the SDK packages (`@financedistrict/saleor-agentic-commerce-core`, `-nextjs`, etc.).

## Saleor instance prerequisites

A few non-obvious things must be true on the Saleor side before the install will work end-to-end. Most are mistakes that cause cryptic errors after the merchant clicks **Install**.

### `PUBLIC_URL` must be set on the Saleor **worker**, not just the API

Saleor's app install runs as a Celery task in the **worker container** (not the API). The worker needs `PUBLIC_URL` set to the Saleor public URL (e.g. `https://saleor.example.com`). Without it, Django's URL builder falls back to defaults and the worker sends `saleor-api-url: http://localhost:8000/graphql/` to the App's `/api/register`. The App then tries to call back to Saleor on that URL, can't reach it, and the install fails with **"The auth data given during registration request could not be used to fetch app ID"** / `UNKNOWN_APP_ID`.

Mirror these three on the worker:
```
PUBLIC_URL=https://saleor.example.com
DASHBOARD_URL=https://saleor.example.com/dashboard/
STOREFRONT_URL=https://saleor.example.com
```

### `ALLOWED_HOSTS` and `ALLOWED_CLIENT_HOSTS`

Standard Saleor settings; no surprise but easy to miss. Both API and worker need them.

### Saleor version

Manifest declares `requiredSaleorVersion: ^3.13`. Tested against Saleor 3.23.

## App service deployment

The App is a Next.js standalone container behind an HTTPS load balancer.

### Container env vars

Required at runtime:

| Var                              | Value                                                                  |
|----------------------------------|------------------------------------------------------------------------|
| `NODE_ENV`                       | `production`                                                           |
| `PORT`                           | `3001`                                                                 |
| **`HOSTNAME`**                   | **`0.0.0.0`** — see gotcha below                                       |
| `APL`                            | Token store backend: `redis` / `dynamodb` / `upstash` (production) or `file` (local dev only). **No default — unknown/missing refuses to start.** Set it (and its connection var below) *before* installing. See **APL choice**. |
| `APP_URL`                        | Public URL of THIS service, e.g. `https://agentic-app.example.com`     |
| `SALEOR_API_URL`                 | `https://saleor.example.com/graphql/`                                  |
| `NEXT_PUBLIC_SALEOR_API_URL`     | Same as above (also baked into the client bundle at build time)        |
| `NEXT_PUBLIC_STOREFRONT_URL`     | `https://saleor.example.com/`                                          |

Optional:

| Var                              | Purpose                                                                |
|----------------------------------|------------------------------------------------------------------------|
| `ALLOWED_SALEOR_URLS`            | Comma-separated allow-list of Saleor instances. **Leave unset** for an open-tenant install. Setting it makes the App reject any Saleor whose `saleor-api-url` header isn't an exact string match — error: *"This app expects to be installed only in allowed Saleor instances"*. |
| `REDIS_URL`                      | Required when `APL=redis` — e.g. `redis://cache:6379/2`. Use a **db number distinct** from Saleor's cache, on an instance with persistence and no all-keys eviction (see caveats). |
| `DYNAMODB_TABLE`                 | Required when `APL=dynamodb` — the table name (PK/SK schema; auth via the AWS IAM environment). |
| `UPSTASH_URL` / `UPSTASH_TOKEN`  | Required when `APL=upstash` (serverless / one-click).                  |
| `LOG_LEVEL`                      | `info` default; `debug` during diagnosis.                              |

### Gotcha: `HOSTNAME=0.0.0.0` is required

Without it, Next.js standalone binds to the container's own hostname (e.g. `ip-10-1-11-126.ap-east-1.compute.internal`). Container-level health checks like `wget http://localhost:3001/api/manifest` then fail because nothing is listening on `127.0.0.1`. ECS / Kubernetes mark the container UNHEALTHY and replace it in a loop. Symptom: tasks cycle every ~4 minutes, ALB returns 503.

### Gotcha: container health check must be **GET**, not HEAD

The `@saleor/app-sdk` manifest handler only registers GET. `wget --spider` issues HEAD and gets 405, so health checks fail. Use:

```
wget -q -O /dev/null http://localhost:3001/api/manifest || exit 1
```

### Manifest requirements (Saleor 3.20+)

- `brand.logo.default` must be a fetchable URL. Saleor verifies it during install; a 404 here makes the install fail with a generic "INVALID" error. Ship a real PNG at `${appUrl}/logo.png`.
- `permissions` are shown to the merchant during install. Trim to the minimum set actually used by the App's webhooks/extensions (currently `MANAGE_ORDERS`, `MANAGE_CHANNELS`).
- Subscription queries must be valid Saleor GraphQL. The App SDK's `appFetchManifest` returns specific error messages — use it (with an admin token) to debug "INVALID" responses:

  ```bash
  curl -X POST https://saleor.example.com/graphql/ \
    -H "Authorization: Bearer <admin-token>" \
    -H "Content-Type: application/json" \
    -d '{"query":"mutation($url:String!){ appFetchManifest(manifestUrl:$url){ errors{field message code} } }","variables":{"url":"https://agentic-app.example.com/api/manifest"}}'
  ```

### Gotcha: local HTTP dev under a custom hostname requires a Secure Context override

`@saleor/app-sdk`'s App Bridge calls `crypto.randomUUID()`-backed action-ID
generation, which browsers only allow in a Secure Context (HTTPS, or the
literal hostnames `localhost`/`127.0.0.1`). If you run the App locally under
a custom hostname — e.g. a Docker Compose network alias like
`agentic-commerce-app.local`, needed so both your browser and Saleor's
containers can resolve the App consistently — Chrome will throw:

    Error: Failed to generate action ID, likely as your browser doesn't
    consider current session as Secure Context.

Fix: add the origin to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
(paste e.g. `http://agentic-commerce-app.local:3001`, set to Enabled, relaunch
Chrome). This is a local-dev-only workaround — production deployments behind
HTTPS never hit this. (saleor-agentic-commerce#61)

## APL choice

The APL stores the auth token Saleor issues **once**, at install. Losing it takes
the App offline until it's reinstalled (GH-62), so the store must be durable.
Choose the backend by **what you already run** — set `APL` explicitly. There is no
default, and an unknown/missing value makes the App **refuse to start** (it never
silently degrades to a throwaway file).

| `APL` | Use when | Needs | Persistence |
|-------|----------|-------|-------------|
| `redis` | Self-hosted with Redis/Valkey in the stack (**recommended** for self-hosters — Saleor's own reference stack ships a Valkey) | `REDIS_URL` | Durable Redis; needs persistence + no all-keys eviction (caveat 2). |
| `dynamodb` | On AWS (ECS/Lambda), IAM available | `DYNAMODB_TABLE` | DynamoDB — durable by design, no eviction, IAM auth (no connection string). |
| `upstash` | Serverless / Vercel / no persistent infra | `UPSTASH_URL`, `UPSTASH_TOKEN` | Hosted Upstash Redis. |
| `file` | **Local development only** | — | Container-local `.auth-data.json`; lost on every restart/replace. Refuses to run under `NODE_ENV=production`. |

`env` (a hard-coded token in env vars) has been **removed**: Saleor calls it
"highly discouraged in any production environment — it breaks if the app token is
regenerated", and the `printAuthDataOnRegister` capture flow it relied on is
deprecated in the SDK. If you were on `APL=env`, switch to a backend above and
reinstall (caveat 1).

**Ordering — set `APL` before you install (not optional).** The token is issued
exactly once:

1. Set `APL` + its connection var → deploy. At startup the App runs a **boot
   canary** (write/read/delete against the store) and refuses to start if it
   fails, so misconfiguration surfaces at deploy — not weeks later at a restart.
2. Install the App in the Saleor Dashboard via the manifest URL.
3. Saleor POSTs the token to `/api/register` → the App writes it to the
   already-proven store.

Installing first and configuring storage after silently burns the one token you get.

**Caveats:**

1. **Changing `APL` strands the token.** Nothing migrates it between backends;
   switching (e.g. `file` → `redis`) requires **reinstalling** the App. Undocumented,
   it looks identical to the bug above.
2. **Redis eviction can reproduce the bug.** `maxmemory` + an eviction policy is
   instance-wide, not per-db — pointing `redis` at the same instance that serves
   Saleor's `CACHE_URL` risks the token being evicted under memory pressure
   (`allkeys-lru` etc.); a separate db number does **not** protect against it. Use
   a Redis with persistence and no all-keys eviction, or prefer `dynamodb`.

## First-install flow (one-time, per environment)

The sequence to produce a permanently-registered App. With a durable APL the
token persists itself — there is no token-capture-and-redeploy dance.

1. **Pre-deploy.** Confirm Saleor's worker has `PUBLIC_URL` set (see prerequisites), and that DNS for the App's `APP_URL` resolves and serves HTTPS.

2. **Deploy with a durable APL already configured.** Set `APL` + its connection var (`APL=redis` + `REDIS_URL`, `APL=dynamodb` + `DYNAMODB_TABLE`, or `APL=upstash` + `UPSTASH_URL`/`UPSTASH_TOKEN`). On boot the App runs the APL canary; if the store is unreachable it refuses to start — check logs for `[apl] BOOT CANARY FAILED`. A healthy start logs `[apl] boot canary OK — APL=<backend>`.

3. **Verify reachability.**
   ```bash
   curl -sI https://agentic-app.example.com/api/manifest
   # Expect: HTTP/2 200, Content-Type: application/json
   ```

4. **Install via the Saleor dashboard.**
   - Open `https://saleor.example.com/dashboard/`
   - **Extensions** → **Add Extension** → **Install with Manifest URL**
   - Manifest URL: `https://agentic-app.example.com/api/manifest`
   - Approve the listed permissions

   Should complete with **"Agentic Commerce is ready to be used"**. Saleor POSTs the token to `/api/register`; the App writes it straight to the APL store — no capture, no secrets to populate, no redeploy.

5. **Verify.**
   - Saleor dashboard → **Extensions** → **Installed** → "Agentic Commerce" opens the App's UI without re-prompting.
   - Logs should not contain `App not registered for ${saleorApiUrl}` errors.
   - Confirm the token landed — e.g. for redis: `redis-cli -u "$REDIS_URL" HGETALL saleor_app_auth` is non-empty.
   - **The GH-62 check:** restart/replace the App container, then reload the Installed app — it must still work (`/api/config-public` returns 200, not 503). With a durable APL the token survives the restart; with `APL=file` it would not.
   - Trigger a test order; webhooks should reach `/api/webhooks/order-created` (visible in the App logs).

## Common install failures

| Symptom                                                                                                       | Cause                                                                                                  | Fix                                                                                  |
|---------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| Dashboard says **"INVALID"** with no detail                                                                  | Manifest validation failed. Could be missing logo, bad subscription query, etc.                        | Use `appFetchManifest` mutation against Saleor with admin token to get specific error. |
| **"This app expects to be installed only in allowed Saleor instances"**                                       | `ALLOWED_SALEOR_URLS` is set and doesn't match the calling Saleor's `saleor-api-url` header exactly.   | Unset `ALLOWED_SALEOR_URLS` for open-tenant. Or add the exact URL to the allow-list. |
| **"The auth data given during registration request could not be used to fetch app ID"** referencing `localhost:8000` | Saleor worker missing `PUBLIC_URL`.                                                                    | Set `PUBLIC_URL` on the worker container, redeploy the worker.                        |
| Dashboard install spinner times out / 503 from App                                                            | App's ECS tasks cycling because of health check failure.                                               | Check `HOSTNAME=0.0.0.0` is set and health check uses GET.                            |
| **"Unexpected token '<', '<html> <h'... is not valid JSON"** in dashboard                                    | Saleor's call to App returned HTML (likely 5xx error page from infra), dashboard can't parse it.       | Check App is reachable and returning JSON; usually downstream of one of the above.   |
| Tasks stable but install hangs                                                                                | Saleor worker can reach App but App can't reach Saleor (e.g. no egress from container subnet).         | Verify outbound HTTPS from the App's subnet to the Saleor public URL.                |
| Install "succeeds" but checkout later fails with opaque GraphQL permission-denied errors                      | The App was created/installed with the `permissions` argument omitted — `appInstall`/`appCreate` silently grant **zero** permissions and return no error. | Always pass `permissions` explicitly (`MANAGE_CHECKOUTS` + `MANAGE_ORDERS` + `HANDLE_PAYMENTS`); verify post-install with `{ app { permissions { code } } }`. (saleor-agentic-commerce#60) |

## Steady-state operations

- **Webhooks** flow Saleor → App on the four events listed in the manifest. Failures are visible in the App's logs and in Saleor's dashboard under each app's webhook delivery history.
- **Token rotation**: if the token is ever invalidated (e.g. App is uninstalled and reinstalled), repeat the install dance. Old token in Secrets Manager won't work.
- **Updating the manifest**: changing the manifest (e.g. adding new webhooks, changing permissions) requires the merchant to either reinstall the App or trigger a manifest sync. There is no "auto-upgrade in place" today.
- **Multi-environment**: tokens do NOT transfer between environments. Test and prod each get their own install + own token.

## Build & image

The App's Dockerfile lives next to the source at `apps/saleor-agentic-commerce-app/Dockerfile`. Multi-stage build, monorepo-aware (build context is the repo root). Produces a `node:20-alpine` runtime image with Next.js standalone output.

For arm64 deployment targets (e.g. AWS Graviton): build natively on an arm64 runner. QEMU emulation works but is ~3-5× slower.

## References

- `src/lib/manifest.ts` — manifest definition
- `src/lib/saleor-app.ts` — APL selection
- `src/app/api/register/route.ts` — register handler
- `@saleor/app-sdk` documentation — https://docs.saleor.io/developer/extending/apps/
- ACP / UCP protocol overview — see the [UCP and ACP](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/UCP-and-ACP) wiki page
