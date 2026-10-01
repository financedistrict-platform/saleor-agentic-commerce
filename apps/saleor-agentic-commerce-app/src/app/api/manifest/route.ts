import { createManifestHandler } from "@saleor/app-sdk/handlers/next-app-router"
import { createManifest } from "@/lib/manifest"

/**
 * GET /api/manifest
 *
 * Returns the Saleor App manifest. Saleor calls this endpoint
 * during app installation to learn about the app's identity,
 * permissions, webhooks, and extensions.
 *
 * Uses the official app-sdk manifest handler which handles
 * base URL resolution and schema version negotiation.
 */
export const GET = createManifestHandler({
  manifestFactory({ appBaseUrl }) {
    // On a first cloud deploy the operator hasn't set APP_URL yet. Fall back to
    // the platform-provided public URL (Vercel sets VERCEL_URL) so the one-click
    // deploy works without a manual env round-trip; APP_URL still wins if set.
    const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined
    return createManifest(process.env.APP_URL || vercelUrl || appBaseUrl)
  },
})
