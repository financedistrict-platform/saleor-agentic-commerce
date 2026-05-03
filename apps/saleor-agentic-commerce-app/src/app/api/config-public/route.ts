/**
 * GET /api/config-public
 *
 * Public configuration endpoint for the storefront SDK. Returns the parsed
 * AppConfig (storeName, protocol toggles, payment handlers, channels) so the
 * SDK doesn't have to query Saleor App metadata directly.
 *
 * Why this exists: Saleor's `{ app { ... } }` GraphQL query always returns
 * the *calling* App's own metadata. The Agentic Commerce App and the
 * storefront's service-account App are two distinct Saleor Apps with
 * separate metadata namespaces. Without this endpoint, the storefront's
 * `loadConfigFromApp` would read the wrong App's metadata (its own,
 * which is empty).
 *
 * Auth: caller sends `Authorization: Bearer <token>` + `saleor-api-url`
 * header. We validate the token by querying Saleor `{ app { id } }`.
 * Any token belonging to a real, installed App on the same Saleor
 * instance passes — they're already trusted to be in your Saleor, and
 * we don't have a finer-grained allow-list mechanism today.
 *
 * The Agentic Commerce App reads its OWN privateMetadata using its OWN
 * stored auth (looked up via the APL by saleorApiUrl), then bundles the
 * parsed config into the response.
 *
 * Response shape mirrors the SDK's `AppConfig` (in
 * @financedistrict/saleor-agentic-commerce-core), so the SDK just
 * deserializes JSON and uses it as-is.
 */

import { NextRequest, NextResponse } from "next/server"
import { saleorApp } from "@/lib/saleor-app"
import { ConfigManager } from "@/lib/config-manager"
import type { PaymentHandlerEntry } from "@/lib/metadata-keys"

// =====================================================
// Response shape — mirrors SDK's AppConfig
// =====================================================

type AppConfigResponse = {
  enabled: boolean
  storeName: string
  storeDescription: string
  ucpEnabled: boolean
  acpEnabled: boolean
  acpApiKey: string
  channels: Record<
    string,
    {
      enabled: boolean
      protocols: string[]
    }
  >
  paymentHandlers: Array<{
    handlerId: string
    enabled: boolean
    channels?: string[] | null
    config: Record<string, unknown>
  }>
}

// =====================================================
// Caller token validation
// =====================================================

async function validateCallerToken(
  saleorApiUrl: string,
  token: string,
): Promise<{ ok: true; appId: string } | { ok: false; reason: string }> {
  // Probe Saleor with the caller's token. If it resolves to a real App,
  // the token is valid. We don't use the returned App ID for anything
  // beyond logging today; future work might add an allow-list.
  let res: Response
  try {
    res = await fetch(saleorApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: "{ app { id name } }" }),
    })
  } catch (err) {
    return {
      ok: false,
      reason: `Saleor unreachable: ${err instanceof Error ? err.message : "unknown"}`,
    }
  }

  if (!res.ok) {
    return { ok: false, reason: `Saleor returned ${res.status}` }
  }

  const json = (await res.json()) as {
    data?: { app: { id: string; name: string } | null }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    return {
      ok: false,
      reason: json.errors.map((e) => e.message).join(", "),
    }
  }
  if (!json.data?.app) {
    return { ok: false, reason: "Token does not resolve to an App" }
  }

  return { ok: true, appId: json.data.app.id }
}

// =====================================================
// Handler
// =====================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Extract caller credentials.
  const authHeader = request.headers.get("authorization") ?? ""
  const callerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : ""
  const saleorApiUrl =
    request.headers.get("saleor-api-url") ??
    request.nextUrl.searchParams.get("saleorApiUrl") ??
    ""

  if (!callerToken || !saleorApiUrl) {
    return NextResponse.json(
      {
        error:
          "Missing credentials. Provide Authorization: Bearer <token> and saleor-api-url header.",
      },
      { status: 401 },
    )
  }

  // 2. Validate the caller's token against Saleor.
  const validation = await validateCallerToken(saleorApiUrl, callerToken)
  if (!validation.ok) {
    return NextResponse.json(
      { error: `Unauthorized: ${validation.reason}` },
      { status: 401 },
    )
  }

  // 3. Look up the Agentic Commerce App's own auth for this Saleor
  //    instance. The APL was populated during install (EnvAPL reads from
  //    env vars; UpstashAPL from Redis; FileAPL from local disk).
  const ownAuth = await saleorApp.apl.get(saleorApiUrl)
  if (!ownAuth) {
    return NextResponse.json(
      {
        error: `Agentic Commerce App is not registered for ${saleorApiUrl}. Install it via the Saleor dashboard first.`,
      },
      { status: 503 },
    )
  }

  // 4. Read the App's own privateMetadata using its own credentials and
  //    parse into the AppConfig shape the storefront SDK expects.
  try {
    const manager = new ConfigManager(ownAuth.saleorApiUrl, ownAuth.token)

    const [globalConfig, channelConfigs, paymentHandlersMap] = await Promise.all([
      manager.getGlobalConfig(),
      manager.getAllChannelConfigs(),
      manager.getAllPaymentHandlers(),
    ])

    const channels: AppConfigResponse["channels"] = {}
    for (const [slug, cfg] of Object.entries(channelConfigs)) {
      channels[slug] = {
        enabled: cfg.enabled,
        protocols: cfg.protocols,
      }
    }

    const paymentHandlers: AppConfigResponse["paymentHandlers"] = Object.entries(
      paymentHandlersMap,
    )
      .filter(([, entry]) => (entry as PaymentHandlerEntry).enabled)
      .map(([handlerId, entry]) => {
        const e = entry as PaymentHandlerEntry
        return {
          handlerId,
          enabled: e.enabled,
          channels: e.channels ?? null,
          config: e.config,
        }
      })

    const body: AppConfigResponse = {
      enabled: globalConfig.enabled,
      storeName: globalConfig.storeName,
      storeDescription: globalConfig.storeDescription,
      ucpEnabled: globalConfig.ucpEnabled,
      acpEnabled: globalConfig.acpEnabled,
      acpApiKey: globalConfig.acpApiKey,
      channels,
      paymentHandlers,
    }

    return NextResponse.json(body, {
      // No CDN caching — this contains API keys and changes whenever a
      // merchant edits config in the dashboard. Storefront SDK has its
      // own short TTL on `loadConfigFromAppCached`.
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err) {
    console.error("[config-public] Failed to read App config:", err)
    return NextResponse.json(
      { error: "Failed to load App configuration" },
      { status: 500 },
    )
  }
}

