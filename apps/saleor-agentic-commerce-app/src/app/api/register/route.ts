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
export const POST = createAppRegisterHandler({
  apl: saleorApp.apl,
  allowedSaleorUrls: process.env.ALLOWED_SALEOR_URLS
    ? process.env.ALLOWED_SALEOR_URLS.split(",").map((url) => url.trim())
    : undefined,
  async onAuthAplSaved(_req, ctx) {
    console.log(
      `[Agentic Commerce] App registered for ${ctx.authData.saleorApiUrl}`
    )
  },
})
