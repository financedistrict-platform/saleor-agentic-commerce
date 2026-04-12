import { NextRequest, NextResponse } from "next/server"
import {
  verifyWebhook,
  isAgentOrder,
  appendOrderEvent,
  webhookError,
} from "@/lib/webhook-utils"
import type { OrderEvent } from "@/lib/metadata-keys"

type FulfillmentCreatedPayload = {
  fulfillment?: {
    id: string
    status: string
    trackingNumber: string | null
    order: {
      id: string
      privateMetadata: Array<{ key: string; value: string }>
    }
    lines: Array<{
      id: string
      quantity: number
      orderLine: { id: string }
    }>
  }
}

/**
 * POST /api/webhooks/fulfillment-created
 *
 * Receives FULFILLMENT_CREATED events from Saleor.
 * For agent orders, appends a fulfillment event to the order's
 * metadata so the SDK can include it in UCP order responses.
 */
export async function POST(request: NextRequest) {
  const context = await verifyWebhook(request)

  if (!context) {
    return webhookError("Webhook verification failed")
  }

  const payload = context.payload as FulfillmentCreatedPayload
  const fulfillment = payload.fulfillment

  if (!fulfillment) {
    return NextResponse.json({ received: true, agent: false })
  }

  const order = fulfillment.order

  if (!isAgentOrder(order.privateMetadata)) {
    return NextResponse.json({ received: true, agent: false })
  }

  // Build the UCP-format fulfillment event
  const event: OrderEvent = {
    id: `evt_fulfillment_${fulfillment.id}`,
    type: "fulfillment_created",
    timestamp: new Date().toISOString(),
    fulfillmentId: fulfillment.id,
    trackingNumber: fulfillment.trackingNumber ?? undefined,
    status: fulfillment.status.toLowerCase(),
    lineItems: fulfillment.lines.map((line) => ({
      id: line.orderLine.id,
      quantity: line.quantity,
    })),
  }

  try {
    await appendOrderEvent(
      context.saleorApiUrl,
      context.token,
      order.id,
      event,
      order.privateMetadata
    )

    console.log(
      `[Agentic Commerce] Fulfillment event written for order ${order.id}: ${fulfillment.id}`
    )
  } catch (error) {
    console.error(
      `[Agentic Commerce] Failed to write fulfillment event for order ${order.id}:`,
      error
    )
  }

  return NextResponse.json({ received: true, agent: true })
}
