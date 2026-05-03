/**
 * Self-registration helper for handler packages.
 *
 * Handler packages call this on storefront boot to write their manifest
 * to the Agentic Commerce App's privateMetadata. The App's dashboard
 * picks up the manifest and uses it to render dynamic config forms.
 *
 * This is the storefront-side counterpart to the App's
 * `POST /api/handlers/register` endpoint.
 *
 * Idempotent: safe to call on every storefront boot. The App preserves
 * merchant-controlled fields (`enabled`, `channels`, `config`) across
 * registers; only the `manifest` is replaced.
 *
 * Typical usage from a handler package:
 *
 *   // @yourorg/saleor-handler-foo/src/index.ts
 *   export const manifest = {
 *     id: "com.yourorg.foo_payment",
 *     name: "com.yourorg.foo_payment",
 *     version: "2026-05-03",
 *     displayName: "Foo Payments",
 *     manageUrl: "https://foo.example.com",
 *     configSchema: { type: "object", properties: { apiKey: { type: "string" } } },
 *   } satisfies HandlerManifest
 *
 *   // …merchant storefront wires it up alongside Prism:
 *   await registerHandler({
 *     agenticCommerceAppUrl: process.env.AGENTIC_COMMERCE_APP_URL!,
 *     saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
 *     saleorAppToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
 *     manifest,
 *   })
 */

/**
 * Manifest a handler package declares to the Agentic Commerce App.
 *
 * Mirrors the `HandlerManifest` type the App stores. Required fields
 * (id, name, version) are validated server-side; optional fields drive
 * dashboard rendering.
 */
export type HandlerManifest = {
  /** Reverse-DNS handler-type id (e.g. "com.example.foo_payment"). */
  id: string
  /** Mirror of `id` (per ACP `PaymentHandler.name`). */
  name: string
  /** YYYY-MM-DD; bumped by the package author on shape changes. */
  version: string
  /** Optional human-readable name for dashboard cards. */
  displayName?: string
  /** Optional one-line description. */
  description?: string
  /** Optional deep-link the dashboard renders as "Manage in X →". */
  manageUrl?: string
  /**
   * Optional JSON Schema (Draft 2020-12) describing the merchant config
   * the handler accepts. Drives the dashboard's dynamic config form.
   */
  configSchema?: Record<string, unknown>
}

export type RegisterHandlerOptions = {
  /**
   * Public URL of the Agentic Commerce App (e.g. https://agentic-app.example.com).
   *
   * **Optional.** If undefined or empty, registration is skipped with a
   * console.info — handler packages can call `registerHandler()`
   * unconditionally on storefront boot without breaking the
   * no-App-installed (Path A) deployment model. The handler still works
   * normally; it just won't appear in the App's dashboard.
   */
  agenticCommerceAppUrl?: string
  /** Saleor GraphQL URL the storefront talks to. */
  saleorApiUrl: string
  /**
   * A Saleor App token. The App-side endpoint validates this against
   * Saleor — any installed App's token works.
   */
  saleorAppToken: string
  /** The handler's manifest. */
  manifest: HandlerManifest
}

export type RegisterHandlerResult =
  | {
      ok: true
      handlerId: string
      /** True if the App created a new entry; false if it merged into existing. */
      created: boolean
      manifestVersion: string
    }
  | {
      ok: true
      /** Registration was skipped because no `agenticCommerceAppUrl` was supplied. */
      skipped: true
      reason: "no-agentic-commerce-app-url"
    }

/**
 * Register a handler manifest with the Agentic Commerce App.
 *
 * **Tolerant of missing App.** When `agenticCommerceAppUrl` is undefined
 * or empty, returns `{ ok: true, skipped: true }` without making a
 * network call. This is the Path A flow (no App installed) — handler
 * packages should call this unconditionally; the helper figures out
 * whether there's anyone to talk to.
 *
 * **Network errors and non-2xx responses are caught.** Returns a
 * rejected `Promise<RegisterHandlerResult>` so `await` flows in
 * boot-time code don't crash the storefront. Throws a descriptive
 * Error including the App's response body when available — callers
 * can decide whether to log + continue or rethrow.
 */
export async function registerHandler(
  opts: RegisterHandlerOptions,
): Promise<RegisterHandlerResult> {
  if (!opts.agenticCommerceAppUrl) {
    console.info(
      `[registerHandler] No agenticCommerceAppUrl configured — skipping registration of "${opts.manifest.id}". (Path A: handler still works via env vars.)`,
    )
    return { ok: true, skipped: true, reason: "no-agentic-commerce-app-url" }
  }

  const url = `${opts.agenticCommerceAppUrl.replace(/\/$/, "")}/api/handlers/register`

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.saleorAppToken}`,
        "saleor-api-url": opts.saleorApiUrl,
      },
      body: JSON.stringify({ manifest: opts.manifest }),
    })
  } catch (err) {
    throw new Error(
      `registerHandler: failed to reach App at ${url}: ${err instanceof Error ? err.message : "unknown"}`,
    )
  }

  if (!response.ok) {
    let detail = ""
    try {
      const body = (await response.json()) as { error?: string }
      if (body?.error) detail = `: ${body.error}`
    } catch {
      // ignore
    }
    throw new Error(
      `registerHandler: App returned ${response.status}${detail}`,
    )
  }

  const body = (await response.json()) as Extract<
    RegisterHandlerResult,
    { skipped?: undefined }
  >
  return body
}
