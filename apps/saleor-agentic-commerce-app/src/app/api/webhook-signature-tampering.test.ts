import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { FlattenedSign, exportJWK, generateKeyPair, type KeyLike } from "jose"
import { NextRequest } from "next/server"

const APP_TOKEN = "app-token"

const aplGet = vi.hoisted(() => vi.fn())

vi.mock("@/lib/saleor-app", () => ({ saleorApp: { apl: { get: aplGet } } }))

const BODY = JSON.stringify({
  order: {
    id: "T3JkZXI6MQ==",
    number: "1001",
    status: "UNFULFILLED",
    channel: { slug: "default-channel" },
    total: { gross: { amount: 54.97, currency: "USD" } },
    privateMetadata: [{ key: "agentic_commerce__agent_session", value: "forged" }],
    fulfillments: [],
  },
})

type JwksMode = "serve" | "error" | "drop"

let signer: KeyLike
let attacker: KeyLike
let jwks: { keys: unknown[] }
let jwksMode: JwksMode = "serve"
let jwksRequests = 0
let server: Server
let saleorApiUrl: string

beforeAll(async () => {
  const legit = await generateKeyPair("RS256")
  const other = await generateKeyPair("RS256")
  signer = legit.privateKey
  attacker = other.privateKey
  jwks = { keys: [{ ...(await exportJWK(legit.publicKey)), kid: "legit", alg: "RS256", use: "sig" }] }
  server = createServer((req, res) => {
    jwksRequests += 1
    if (req.url !== "/.well-known/jwks.json" || jwksMode === "error") {
      res.writeHead(500).end("boom")
    } else if (jwksMode === "drop") {
      res.destroy()
    } else {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(jwks))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  saleorApiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql/`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function sign(body: string, key: KeyLike, kid = "legit"): Promise<string> {
  const jws = await new FlattenedSign(new TextEncoder().encode(body))
    .setProtectedHeader({ alg: "RS256", b64: false, crit: ["b64"], kid })
    .sign(key)
  return `${jws.protected}..${jws.signature}`
}

function webhook(body: string, headers: Record<string, string | undefined> = {}): NextRequest {
  const merged: Record<string, string> = { "content-type": "application/json", "saleor-api-url": saleorApiUrl }
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) merged[name] = value
  }
  return new NextRequest("https://app.example/api/webhooks/order-created", { method: "POST", headers: merged, body })
}

async function postOrderCreated(request: NextRequest): Promise<Response> {
  vi.resetModules()
  const { POST } = await import("./webhooks/order-created/route")
  return POST(request)
}

beforeEach(() => {
  jwksMode = "serve"
  jwksRequests = 0
  aplGet.mockReset()
  aplGet.mockImplementation(async (url: string) =>
    url === saleorApiUrl ? { saleorApiUrl, appId: "app-123", token: APP_TOKEN } : undefined,
  )
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("webhook signature tampering — only Saleor-signed payloads are accepted", () => {
  it("accepts a payload signed by the Saleor instance key", async () => {
    const response = await postOrderCreated(webhook(BODY, { "saleor-signature": await sign(BODY, signer) }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ received: true, orderNumber: "1001" })
  })

  it("rejects a request with a signature header that is not a signature", async () => {
    const response = await postOrderCreated(webhook(BODY, { "saleor-signature": "forged" }))

    expect(response.status).toBe(401)
  })

  it("rejects a payload signed with a key Saleor does not publish", async () => {
    const response = await postOrderCreated(webhook(BODY, { "saleor-signature": await sign(BODY, attacker) }))

    expect(response.status).toBe(401)
  })

  it("rejects a payload changed after it was signed", async () => {
    const signature = await sign(BODY, signer)

    const response = await postOrderCreated(webhook(BODY.replace("1001", "9999"), { "saleor-signature": signature }))

    expect(response.status).toBe(401)
  })

  it("rejects a signature that names a key id Saleor does not publish", async () => {
    const response = await postOrderCreated(webhook(BODY, { "saleor-signature": await sign(BODY, signer, "unknown") }))

    expect(response.status).toBe(401)
  })

  it("rejects a valid signature replayed with a different body of the same signer", async () => {
    const signature = await sign(JSON.stringify({ order: { id: "T3JkZXI6Mg==" } }), signer)

    const response = await postOrderCreated(webhook(BODY, { "saleor-signature": signature }))

    expect(response.status).toBe(401)
  })

  it("rejects when the signature header is missing", async () => {
    const response = await postOrderCreated(webhook(BODY))

    expect(response.status).toBe(401)
  })

  it("rejects an instance that is not registered, without fetching any key set", async () => {
    const request = webhook(BODY, { "saleor-signature": await sign(BODY, signer), "saleor-api-url": "https://attacker.example/graphql/" })

    const response = await postOrderCreated(request)

    expect(response.status).toBe(401)
    expect(jwksRequests).toBe(0)
  })

  it("answers 503 so Saleor retries when the Saleor key set answers with an error", async () => {
    jwksMode = "error"

    const response = await postOrderCreated(webhook(BODY, { "saleor-signature": await sign(BODY, signer) }))

    expect(response.status).toBe(503)
  })

  it("answers 503 so Saleor retries when the Saleor key set cannot be reached", async () => {
    jwksMode = "drop"

    const response = await postOrderCreated(webhook(BODY, { "saleor-signature": await sign(BODY, signer) }))

    expect(response.status).toBe(503)
  })

  it("does not fetch the key set for a signature that is not even shaped like one", async () => {
    const response = await postOrderCreated(webhook(BODY, { "saleor-signature": "a.b.c.d" }))

    expect(response.status).toBe(401)
    expect(jwksRequests).toBe(0)
  })
})

const WEBHOOKS_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "webhooks")

describe("webhook signature tampering — every webhook route verifies the signature first", () => {
  const routes = readdirSync(WEBHOOKS_DIR, { recursive: true, encoding: "utf8" })
    .map((file) => file.split(sep))
    .filter((parts) => parts.at(-1) === "route.ts")
    .map((parts) => parts.join("/"))

  it("finds the webhook routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(4)
  })

  it.each(routes)("%s returns the refusal before it touches the payload", (route) => {
    const source = readFileSync(join(WEBHOOKS_DIR, route), "utf8")
    const verified = source.indexOf("await verifyWebhook(request)")
    const refusal = source.indexOf("return verified.response")
    const firstPayloadUse = source.indexOf("context.payload")

    expect(verified).toBeGreaterThan(-1)
    expect(source).toMatch(/if \(!verified\.ok\)/)
    expect(refusal).toBeGreaterThan(verified)
    expect(firstPayloadUse).toBeGreaterThan(refusal)
  })
})
