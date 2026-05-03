/**
 * POST /api/handlers/register
 *
 * Self-registration endpoint for handler packages running in the storefront.
 * On boot, each installed handler package calls this with its manifest so
 * the App's dashboard can discover it and render the appropriate config
 * form. Merchant-controlled fields (`enabled`, `channels`, `config`) are
 * preserved across registers.
 *
 * Auth: same as /api/config-public — caller passes
 *   Authorization: Bearer <SaleorAppToken>
 *   saleor-api-url: <saleor-graphql-url>
 *
 * Body: { manifest: HandlerManifest }
 *
 * Behavior:
 * - Reads existing entry under `agentic_commerce__handler__<manifest.id>`
 *   (if any).
 * - Replaces ONLY the `manifest` field; leaves `enabled`, `channels`,
 *   `config` alone (merchant-controlled).
 * - Creates a fresh entry with sensible defaults if none exists yet.
 *
 * Idempotent: callers can safely register on every boot.
 */

import { NextRequest, NextResponse } from "next/server"
import { saleorApp } from "@/lib/saleor-app"
import {
  readCallerCredentials,
  validateCallerToken,
} from "@/lib/caller-auth"
import { ConfigManager } from "@/lib/config-manager"
import {
  type HandlerManifest,
  type PaymentHandlerEntry,
} from "@/lib/metadata-keys"

type RegisterBody = {
  manifest?: Partial<HandlerManifest>
}

function isWellFormedManifest(m: unknown): m is HandlerManifest {
  if (!m || typeof m !== "object") return false
  const obj = m as Record<string, unknown>
  return (
    typeof obj.id === "string" &&
    obj.id.length > 0 &&
    typeof obj.name === "string" &&
    typeof obj.version === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(obj.version)
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Validate caller credentials.
  const creds = readCallerCredentials(request)
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "Missing credentials. Provide Authorization: Bearer <token> and saleor-api-url header.",
      },
      { status: 401 },
    )
  }
  const validation = await validateCallerToken(creds)
  if (!validation.ok) {
    return NextResponse.json(
      { error: `Unauthorized: ${validation.message}` },
      { status: validation.status },
    )
  }

  // 2. Parse body.
  let body: RegisterBody
  try {
    body = (await request.json()) as RegisterBody
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    )
  }

  if (!isWellFormedManifest(body.manifest)) {
    return NextResponse.json(
      {
        error:
          "Invalid manifest. Required fields: id (reverse-DNS string), name (string), version (YYYY-MM-DD).",
      },
      { status: 400 },
    )
  }
  const manifest = body.manifest

  // 3. Look up the App's own auth — needed to write to its own metadata.
  const ownAuth = await saleorApp.apl.get(creds.saleorApiUrl)
  if (!ownAuth) {
    return NextResponse.json(
      {
        error: `Agentic Commerce App is not registered for ${creds.saleorApiUrl}. Install it via the Saleor dashboard first.`,
      },
      { status: 503 },
    )
  }

  // 4. Read existing entry, merge manifest, write back. Preserves
  //    merchant-controlled fields across re-registers.
  try {
    const manager = new ConfigManager(ownAuth.saleorApiUrl, ownAuth.token)
    const existing = await manager.getPaymentHandler(manifest.id)

    const updated: PaymentHandlerEntry = {
      enabled: existing?.enabled ?? false,
      channels: existing?.channels ?? null,
      config: existing?.config ?? {},
      manifest,
    }

    await manager.savePaymentHandler(manifest.id, updated)

    return NextResponse.json(
      {
        ok: true,
        handlerId: manifest.id,
        created: !existing,
        // Echo back what's stored so the caller can confirm the manifest
        // landed without an extra read.
        manifestVersion: manifest.version,
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    console.error("[handlers/register] Failed to register handler:", err)
    return NextResponse.json(
      { error: "Failed to write handler entry" },
      { status: 500 },
    )
  }
}
