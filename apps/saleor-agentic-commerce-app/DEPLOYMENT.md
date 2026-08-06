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
| `APL`                            | `file` (first deploy) or `env` (steady state) — see install flow       |
| `APP_URL`                        | Public URL of THIS service, e.g. `https://agentic-app.example.com`     |
| `SALEOR_API_URL`                 | `https://saleor.example.com/graphql/`                                  |
| `NEXT_PUBLIC_SALEOR_API_URL`     | Same as above (also baked into the client bundle at build time)        |
| `NEXT_PUBLIC_STOREFRONT_URL`     | `https://saleor.example.com/`                                          |
| `SALEOR_APP_TOKEN`               | Populated post-install (Secrets Manager / Vault). Empty until install. |
| `SALEOR_APP_ID`                  | Same.                                                                  |

Optional:

| Var                              | Purpose                                                                |
|----------------------------------|------------------------------------------------------------------------|
| `ALLOWED_SALEOR_URLS`            | Comma-separated allow-list of Saleor instances. **Leave unset** for an open-tenant install. Setting it makes the App reject any Saleor whose `saleor-api-url` header isn't an exact string match — error: *"This app expects to be installed only in allowed Saleor instances"*. |
| `PRINT_AUTH_DATA_ON_REGISTER`    | `true` during the install dance to log received token + appId to stdout. Drop after capturing. |
| `UPSTASH_URL` / `UPSTASH_TOKEN`  | Only if using `APL=upstash` (multi-tenant production).                |
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

The Auth Persistence Layer stores the registration token Saleor returns at install time. Three options:

| APL       | When to use                                              | Persistence                                  |
|-----------|----------------------------------------------------------|----------------------------------------------|
| `file`    | Local development, throwaway test installs               | Container-local `/.auth-data.json`. Lost on every container replace. |
| `env`     | Single-tenant production (one Saleor instance)           | Read from env vars at boot. Operator captures token once, stores in secrets. |
| `upstash` | Multi-tenant production (many Saleor instances per App)  | Upstash Redis. App writes on every register.  |

**For single-tenant production, use `env`.** It survives task replaces because the secrets are external. `file` is only useful for the install dance itself if you don't want to set `PRINT_AUTH_DATA_ON_REGISTER`.

## First-install flow (one-time, per environment)

The full sequence to produce a permanently-registered App.

1. **Pre-deploy.** Confirm Saleor's worker has `PUBLIC_URL` set (see prerequisites). Confirm DNS for the App's `APP_URL` resolves and serves HTTPS.

2. **Initial deploy.** Service comes up with:
   - `APL=env`
   - `PRINT_AUTH_DATA_ON_REGISTER=true`
   - `SALEOR_APP_TOKEN`, `SALEOR_APP_ID` as placeholders in your secrets store

   The App responds 200 to manifest + register requests with placeholder creds. Authenticated calls back to Saleor would fail at this point, but install itself doesn't need them.

3. **Verify reachability.**
   ```bash
   curl -sI https://agentic-app.example.com/api/manifest
   # Expect: HTTP/2 200, Content-Type: application/json
   ```

4. **Install via Saleor dashboard.**
   - Open `https://saleor.example.com/dashboard/`
   - **Extensions** → **Add Extension** → **Install with Manifest URL**
   - Manifest URL: `https://agentic-app.example.com/api/manifest`
   - Approve the listed permissions

   Should complete with **"Agentic Commerce is ready to be used"**.

5. **Capture the token + appId from logs.**
   The SDK's EnvAPL with `printAuthDataOnRegister=true` logs the auth payload to stdout. Look in the App's container log stream for a JSON line containing `token`, `appId`, `saleorApiUrl`. Example (pseudo):
   ```
   [Saleor App SDK] Auth data received { token: "abc…", appId: "QXBwOjE=", saleorApiUrl: "https://saleor.example.com/graphql/" }
   ```

6. **Write captured values to your secrets store.**
   ```bash
   aws secretsmanager put-secret-value --secret-id fd-saleor-agentic-app/<env>/SALEOR_APP_TOKEN --secret-string "<token>"
   aws secretsmanager put-secret-value --secret-id fd-saleor-agentic-app/<env>/SALEOR_APP_ID --secret-string "<appId>"
   ```

7. **Drop `PRINT_AUTH_DATA_ON_REGISTER`** from the env block (or set `false`) so subsequent registers don't leak to logs.

8. **Redeploy.** New task picks up real secrets from Secrets Manager. EnvAPL initializes with working creds. App is permanently registered; subsequent task replaces don't lose state.

9. **Verify.**
   - Saleor dashboard → **Extensions** → **Installed** → "Agentic Commerce" should open the App's UI without re-prompting.
   - Logs should not contain `App not registered for ${saleorApiUrl}` errors.
   - Trigger a test order in Saleor; webhooks should reach the App's `/api/webhooks/order-created` and similar (visible in App logs).

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
