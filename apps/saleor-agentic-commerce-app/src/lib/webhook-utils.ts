/**
 * Webhook verification and processing utilities.
 *
 * Saleor sends webhooks with a JWKS-signed JWT in the
 * `saleor-signature` header. We verify this signature
 * against the Saleor instance's JWKS endpoint.
 */

import { NextRequest, NextResponse } from "next/server"
import { createRemoteJWKSet, errors, flattenedVerify } from "jose"
import { saleorApp } from "./saleor-app"
import { KEYS, type OrderEvent } from "./metadata-keys"
import { SaleorApiClient, MUTATIONS } from "./saleor-api"

const METADATA_PREFIX = "agentic_commerce__"

type WebhookContext = {
  saleorApiUrl: string
  token: string
  payload: unknown
}

const JWKS_PATH = "/.well-known/jwks.json"
const JWKS_TIMEOUT_MS = 5000
const KEY_SET_UNAVAILABLE_CODES = new Set(["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JOSE_GENERIC"])

type SignatureCheck = "verified" | "invalid" | "unavailable"

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function keySetFor(saleorApiUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const url = new URL(JWKS_PATH, saleorApiUrl)
  let keySet = keySets.get(url.href)
  if (!keySet) {
    keySet = createRemoteJWKSet(url, { timeoutDuration: JWKS_TIMEOUT_MS })
    keySets.set(url.href, keySet)
  }
  return keySet
}

async function checkSaleorSignature(
  saleorApiUrl: string,
  signature: string,
  body: string
): Promise<SignatureCheck> {
  const [header, detachedPayload, jwsSignature, ...rest] = signature.split(".")
  if (!header || detachedPayload !== "" || !jwsSignature || rest.length > 0) {
    return "invalid"
  }

  try {
    await flattenedVerify(
      { protected: header, payload: body, signature: jwsSignature },
      keySetFor(saleorApiUrl),
      { algorithms: ["RS256"] }
    )
    return "verified"
  } catch (error) {
    const keySetUnavailable =
      !(error instanceof errors.JOSEError) || KEY_SET_UNAVAILABLE_CODES.has(error.code)
    return keySetUnavailable ? "unavailable" : "invalid"
  }
}

export type WebhookVerification =
  | { ok: true; context: WebhookContext }
  | { ok: false; response: NextResponse }

const refuse = (message: string, status = 401): WebhookVerification => ({
  ok: false,
  response: webhookError(message, status),
})

/**
 * Verify a Saleor webhook request and extract the payload.
 *
 * A forged or unreadable request is answered 401. When Saleor's key set cannot
 * be fetched the answer is 503, so Saleor retries the delivery.
 */
export async function verifyWebhook(
  request: NextRequest
): Promise<WebhookVerification> {
  const saleorApiUrl = request.headers.get("saleor-api-url")
  const saleorSignature = request.headers.get("saleor-signature")

  if (!saleorApiUrl || !saleorSignature) {
    console.warn("[Webhook] Missing saleor-api-url or saleor-signature header")
    return refuse("Webhook verification failed")
  }

  // Look up auth data for this Saleor instance
  const authData = await saleorApp.apl.get(saleorApiUrl)

  if (!authData) {
    console.warn(`[Webhook] No auth data found for ${saleorApiUrl}`)
    return refuse("Webhook verification failed")
  }

  const body = await request.text()

  const signature = await checkSaleorSignature(authData.saleorApiUrl, saleorSignature, body)
  if (signature === "unavailable") {
    console.warn(`[Webhook] Could not fetch the signing keys of ${saleorApiUrl}`)
    return refuse("Webhook verification unavailable", 503)
  }
  if (signature === "invalid") {
    console.warn(`[Webhook] Signature verification failed for ${saleorApiUrl}`)
    return refuse("Webhook verification failed")
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    console.warn("[Webhook] Failed to parse request body as JSON")
    return refuse("Webhook verification failed")
  }

  return {
    ok: true,
    context: {
      saleorApiUrl: authData.saleorApiUrl,
      token: authData.token,
      payload,
    },
  }
}

/**
 * Check if an order was created by an AI agent.
 */
export function isAgentOrder(
  metadata: Array<{ key: string; value: string }>
): boolean {
  return metadata.some((m) => m.key === KEYS.agentSession)
}

/**
 * Append a fulfillment event to order metadata.
 */
export async function appendOrderEvent(
  apiUrl: string,
  token: string,
  orderId: string,
  event: OrderEvent,
  existingMetadata: Array<{ key: string; value: string }>
): Promise<void> {
  const client = new SaleorApiClient(apiUrl, token)

  // Read existing events
  const eventsEntry = existingMetadata.find((m) => m.key === KEYS.orderEvents)
  let events: OrderEvent[] = []

  if (eventsEntry) {
    try {
      events = JSON.parse(eventsEntry.value) as OrderEvent[]
    } catch {
      events = []
    }
  }

  // Append new event
  events.push(event)

  // Write back
  await client.query(MUTATIONS.UPDATE_ORDER_METADATA, {
    id: orderId,
    input: [{ key: KEYS.orderEvents, value: JSON.stringify(events) }],
  })
}

/**
 * Create a standard webhook error response.
 */
export function webhookError(message: string, status = 401): NextResponse {
  return NextResponse.json({ error: message }, { status })
}
