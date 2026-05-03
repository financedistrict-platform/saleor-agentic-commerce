import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"

/**
 * POST /api/payment-handlers/test-connection
 *
 * Server-side proxy for the Payment Handlers tab's "Test Connection" button.
 * The dashboard iframe can't call Prism directly (CORS — Prism gateway
 * doesn't allow cross-origin requests from the Saleor dashboard origin), so
 * we proxy through the App's own backend.
 *
 * Body: { handlerId, apiUrl, apiKey }
 *
 * Response (200 always — failure is reported in body so the UI can render
 * the message without consuming a generic 500):
 *   { ok: boolean, status?: number, message: string }
 */
export async function POST(request: NextRequest) {
  // Same auth as /api/config — only authenticated dashboard users can probe
  // arbitrary URLs from the App's network.
  const auth = await getAuthContext(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { handlerId?: string; apiUrl?: string; apiKey?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    )
  }

  const { handlerId, apiUrl, apiKey } = body
  if (!apiUrl || !apiKey) {
    return NextResponse.json(
      { error: "apiUrl and apiKey are required" },
      { status: 400 },
    )
  }

  // For v1 we only know how to test the Prism handler. When the registry
  // lands, this dispatches by handlerId to per-handler probe logic (which
  // can come from the handler's manifest).
  if (handlerId && handlerId !== "xyz.fd.prism_payment") {
    return NextResponse.json(
      { ok: false, message: `No probe defined for handler "${handlerId}"` },
      { status: 200 },
    )
  }

  const probeUrl = `${apiUrl.replace(/\/$/, "")}/api/v2/merchant/payment-profile`

  try {
    const res = await fetch(probeUrl, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
    })

    if (res.ok) {
      return NextResponse.json({
        ok: true,
        status: res.status,
        message: "Connected to Prism. Credentials verified.",
      })
    }

    const text = await res.text().catch(() => "")
    let detail = text
    // If Prism returned JSON, surface just the error message rather than the
    // whole body.
    try {
      const j = JSON.parse(text)
      if (j && typeof j.error === "string") detail = j.error
    } catch {
      // not JSON — keep the raw text
    }
    return NextResponse.json({
      ok: false,
      status: res.status,
      message: `Prism returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
    })
  }
}
