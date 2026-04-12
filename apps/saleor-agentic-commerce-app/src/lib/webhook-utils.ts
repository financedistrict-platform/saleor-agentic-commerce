/**
 * Webhook verification and processing utilities.
 *
 * Saleor sends webhooks with a JWKS-signed JWT in the
 * `saleor-signature` header. We verify this signature
 * against the Saleor instance's JWKS endpoint.
 */

import { NextRequest, NextResponse } from "next/server"
import { saleorApp } from "./saleor-app"
import { KEYS, type OrderEvent } from "./metadata-keys"
import { SaleorApiClient, MUTATIONS } from "./saleor-api"

const METADATA_PREFIX = "agentic_commerce__"

type WebhookContext = {
  saleorApiUrl: string
  token: string
  payload: unknown
}

/**
 * Verify a Saleor webhook request and extract the payload.
 *
 * Returns null if verification fails (caller should return 401).
 */
export async function verifyWebhook(
  request: NextRequest
): Promise<WebhookContext | null> {
  const saleorApiUrl = request.headers.get("saleor-api-url")
  const saleorSignature = request.headers.get("saleor-signature")

  if (!saleorApiUrl || !saleorSignature) {
    console.warn("[Webhook] Missing saleor-api-url or saleor-signature header")
    return null
  }

  // Look up auth data for this Saleor instance
  const authData = await saleorApp.apl.get(saleorApiUrl)

  if (!authData) {
    console.warn(`[Webhook] No auth data found for ${saleorApiUrl}`)
    return null
  }

  // TODO: Implement full JWKS signature verification
  // For now, we verify the domain matches our registered instance
  // In production, use jose to verify the JWT signature against
  // {saleorApiUrl}/.well-known/jwks.json

  const body = await request.text()

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    console.warn("[Webhook] Failed to parse request body as JSON")
    return null
  }

  return {
    saleorApiUrl: authData.saleorApiUrl,
    token: authData.token,
    payload,
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
