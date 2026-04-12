import { SaleorApp } from "@saleor/app-sdk/saleor-app"
import { FileAPL, UpstashAPL, EnvAPL } from "@saleor/app-sdk/APL"

/**
 * Singleton SaleorApp instance.
 *
 * The APL (Auth Persistence Layer) is selected based on the APL env var:
 * - "file"    → FileAPL (local dev, writes to .auth-data.json)
 * - "env"     → EnvAPL  (single-tenant production)
 * - "upstash" → UpstashAPL (multi-tenant production)
 */
function getAPL() {
  const aplType = process.env.APL ?? "file"

  switch (aplType) {
    case "upstash":
      if (!process.env.UPSTASH_URL || !process.env.UPSTASH_TOKEN) {
        throw new Error("UPSTASH_URL and UPSTASH_TOKEN are required for Upstash APL")
      }
      return new UpstashAPL({
        restURL: process.env.UPSTASH_URL,
        restToken: process.env.UPSTASH_TOKEN,
      })

    case "env":
      return new EnvAPL({
        env: {
          token: process.env.SALEOR_APP_TOKEN!,
          appId: process.env.SALEOR_APP_ID!,
          saleorApiUrl: process.env.SALEOR_API_URL!,
        },
        allowedSaleorUrls: [process.env.SALEOR_API_URL!],
      })

    case "file":
    default:
      return new FileAPL()
  }
}

export const saleorApp = new SaleorApp({
  apl: getAPL(),
})
