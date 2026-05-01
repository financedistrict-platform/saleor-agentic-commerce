import { SaleorApp } from "@saleor/app-sdk/saleor-app"
import { FileAPL } from "@saleor/app-sdk/APL/file"
import { UpstashAPL } from "@saleor/app-sdk/APL/upstash"
import { EnvAPL } from "@saleor/app-sdk/APL/env"

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
      // EnvAPL in @saleor/app-sdk@1.x no longer accepts `allowedSaleorUrls`
      // — that restriction lives on the register handler now (see
      // /api/register/route.ts which uses `ALLOWED_SALEOR_URLS` env).
      //
      // `printAuthDataOnRegister` (new in 1.x) prints the auth payload to
      // stdout when Saleor calls /api/register, so the captured token can
      // be picked up from CloudWatch logs during the first install. After
      // tokens are populated in Secrets Manager, set the env to false.
      return new EnvAPL({
        env: {
          token: process.env.SALEOR_APP_TOKEN!,
          appId: process.env.SALEOR_APP_ID!,
          saleorApiUrl: process.env.SALEOR_API_URL!,
        },
        printAuthDataOnRegister:
          process.env.PRINT_AUTH_DATA_ON_REGISTER === "true",
      })

    case "file":
    default:
      return new FileAPL()
  }
}

export const saleorApp = new SaleorApp({
  apl: getAPL(),
})
