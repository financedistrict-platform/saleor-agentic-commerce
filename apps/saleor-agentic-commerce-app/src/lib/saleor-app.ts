import { SaleorApp } from "@saleor/app-sdk/saleor-app"
import type { APL } from "@saleor/app-sdk/APL"

/**
 * Auth Persistence Layer (APL) — where the App stores the Saleor auth token it
 * receives once, at install time.
 *
 * The token is the App's only key to its own data: every request reads/writes
 * the App's `privateMetadata` in Saleor, which needs the token. Lose it and the
 * App is inoperative until reinstalled (GH-62). So the store MUST survive a
 * container restart/replace.
 *
 * The backend is chosen explicitly by the `APL` env var — no default, no
 * fallback chain. Unknown/missing THROWS rather than silently degrading to a
 * temp file (the failure mode GH-62 is about):
 *
 *   redis     durable Redis/Valkey (self-hosted default). Needs REDIS_URL.
 *   dynamodb  AWS DynamoDB (IAM auth). Needs DYNAMODB_TABLE.
 *   upstash   serverless Upstash Redis (Vercel/one-click). Needs UPSTASH_URL/TOKEN.
 *   file      LOCAL DEV ONLY — lost on restart; refused under NODE_ENV=production.
 *
 * Selection validation is synchronous and dependency-free (`resolveAplType`).
 * The backends themselves are Node-only (redis → `node:crypto`, AWS SDK, etc.),
 * so they are **dynamically imported** in `buildApl` — this keeps them out of
 * the static/edge bundle (they must never be webpack-bundled for the edge
 * runtime). Changing APL after install strands the token — see DEPLOYMENT.md.
 */
export type AplType = "redis" | "dynamodb" | "upstash" | "file"

const VALID: AplType[] = ["redis", "dynamodb", "upstash", "file"]

function isProduction(): boolean {
  return process.env.NODE_ENV === "production"
}

/**
 * Validate the `APL` selection and its required connection env, synchronously.
 * Throws on any misconfiguration so it surfaces at deploy, not at a later
 * restart. Dependency-free and safe to bundle anywhere. Exported for tests.
 */
export function resolveAplType(aplType: string | undefined = process.env.APL): AplType {
  switch (aplType) {
    case "redis":
      if (!process.env.REDIS_URL) {
        throw new Error(
          'APL="redis" requires REDIS_URL (e.g. redis://cache:6379/2 — a db number distinct from Saleor\'s cache).',
        )
      }
      return "redis"

    case "dynamodb":
      if (!process.env.DYNAMODB_TABLE) {
        throw new Error(
          'APL="dynamodb" requires DYNAMODB_TABLE (the table name; credentials come from the AWS IAM environment).',
        )
      }
      return "dynamodb"

    case "upstash":
      if (!process.env.UPSTASH_URL || !process.env.UPSTASH_TOKEN) {
        throw new Error('APL="upstash" requires UPSTASH_URL and UPSTASH_TOKEN.')
      }
      return "upstash"

    case "file":
      if (isProduction()) {
        throw new Error(
          'APL="file" is local-development only — tokens are lost on every restart/redeploy, which silently breaks the App (GH-62). ' +
            "Set APL=redis (self-hosted), dynamodb (AWS), or upstash (serverless).",
        )
      }
      return "file"

    case undefined:
    case "":
      throw new Error(
        "APL is not set. Choose a token store before deploying (it must exist before install — the token is issued exactly once): " +
          "APL=redis | dynamodb | upstash (production), or APL=file (local dev only). See DEPLOYMENT.md.",
      )

    default:
      throw new Error(
        `Unknown APL "${aplType}". Valid values: ${VALID.join(", ")}. ` +
          "Refusing to start rather than silently degrade to a throwaway file.",
      )
  }
}

/**
 * Build the configured APL. Async because each backend is dynamically imported
 * (see the node-only note above). Validation happens up front via
 * `resolveAplType`, so a bad config rejects immediately.
 */
export async function buildApl(type: AplType = resolveAplType()): Promise<APL> {
  switch (type) {
    case "redis": {
      const [{ RedisAPL }, { createClient }] = await Promise.all([
        import("@saleor/app-sdk/APL/redis"),
        import("redis"),
      ])
      return new RedisAPL({ client: createClient({ url: process.env.REDIS_URL! }) })
    }

    case "dynamodb": {
      const [{ DynamoAPL }, { Table }, { DynamoDBClient }, { DynamoDBDocumentClient }] =
        await Promise.all([
          import("@saleor/app-sdk/APL/dynamodb"),
          import("dynamodb-toolbox"),
          import("@aws-sdk/client-dynamodb"),
          import("@aws-sdk/lib-dynamodb"),
        ])
      const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
      const table = new Table({
        name: process.env.DYNAMODB_TABLE!,
        partitionKey: { name: "PK", type: "string" },
        sortKey: { name: "SK", type: "string" },
        documentClient,
      })
      return DynamoAPL.create({ table })
    }

    case "upstash": {
      const { UpstashAPL } = await import("@saleor/app-sdk/APL/upstash")
      return new UpstashAPL({
        restURL: process.env.UPSTASH_URL!,
        restToken: process.env.UPSTASH_TOKEN!,
      })
    }

    case "file": {
      const { FileAPL } = await import("@saleor/app-sdk/APL/file")
      return new FileAPL()
    }
  }
}

/**
 * Boot canary: prove the configured store is reachable and writable BEFORE the
 * App can accept an install (the token is issued once — if the store isn't
 * working when Saleor POSTs it, it's lost). Prefer the SDK's own readiness
 * hooks; fall back to a real write/read/delete round-trip for backends that
 * don't implement them (e.g. DynamoAPL).
 */
export async function assertAplReady(instance: APL): Promise<void> {
  if (instance.isConfigured) {
    const configured = await instance.isConfigured()
    if (!configured.configured) throw configured.error
  }
  if (instance.isReady) {
    const ready = await instance.isReady()
    if (!ready.ready) throw ready.error
    return
  }
  const probe = { saleorApiUrl: "apl-canary://boot-check", token: "canary", appId: "canary" }
  await instance.set(probe)
  const got = await instance.get(probe.saleorApiUrl)
  await instance.delete(probe.saleorApiUrl)
  if (!got || got.token !== "canary") {
    throw new Error("APL canary write/read/delete round-trip did not return the written value.")
  }
}

/**
 * Lazily-built APL, memoised. Deferred so Next's build-time module analysis
 * doesn't construct a backend (or run the config-and-throw logic) before
 * runtime env exists. The canary in `instrumentation.ts` forces construction +
 * validation at server startup.
 */
let aplPromise: Promise<APL> | undefined
export function getApl(): Promise<APL> {
  return (aplPromise ??= buildApl())
}

const lazyApl: APL = {
  get: async (url) => (await getApl()).get(url),
  set: async (data) => (await getApl()).set(data),
  delete: async (url) => (await getApl()).delete(url),
  getAll: async () => (await getApl()).getAll(),
  isReady: async () => (await getApl()).isReady?.() ?? { ready: true as const },
  isConfigured: async () => (await getApl()).isConfigured?.() ?? { configured: true as const },
}

export const saleorApp = new SaleorApp({ apl: lazyApl })
