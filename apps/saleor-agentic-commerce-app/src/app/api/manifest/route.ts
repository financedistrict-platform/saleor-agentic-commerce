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
    return createManifest(appBaseUrl)
  },
})
