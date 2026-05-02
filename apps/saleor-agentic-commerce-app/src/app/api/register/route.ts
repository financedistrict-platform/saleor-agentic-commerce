import { createAppRegisterHandler } from "@saleor/app-sdk/handlers/next-app-router"
import { saleorApp } from "@/lib/saleor-app"

/**
 * POST /api/register
 *
 * Saleor calls this endpoint after the merchant approves the app installation.
 * It provides the auth token that the App uses to make authenticated API calls.
 *
 * Uses the official app-sdk register handler which handles:
 * - Token validation
 * - JWKS verification of the Saleor instance
 * - Storing auth data in the configured APL
 */
const allowedSaleorUrls = process.env.ALLOWED_SALEOR_URLS
  ? process.env.ALLOWED_SALEOR_URLS.split(",").map((url) => url.trim())
  : undefined

const baseHandler = createAppRegisterHandler({
  apl: saleorApp.apl,
  allowedSaleorUrls,
  async onAuthAplSaved(_req, ctx) {
    console.log(
      `[Agentic Commerce] App registered for ${ctx.authData.saleorApiUrl}`
    )
  },
})

// Wrap so we can see exactly what Saleor sent and what our allow-list looks
// like when the SDK rejects with RestrictedAppInstallationError. Remove once
// install is stable.
export async function POST(req: Request) {
  const saleorApiUrl = req.headers.get("saleor-api-url")
  console.log(
    `[Agentic Commerce] /api/register saleor-api-url=${JSON.stringify(saleorApiUrl)} allowed=${JSON.stringify(allowedSaleorUrls)}`
  )
  const res = await baseHandler(req)
  if (!res.ok) {
    let body = ""
    try {
      body = await res.clone().text()
    } catch {
      // ignore
    }
    console.log(
      `[Agentic Commerce] /api/register status=${res.status} body=${body}`
    )
  }
  return res
}
