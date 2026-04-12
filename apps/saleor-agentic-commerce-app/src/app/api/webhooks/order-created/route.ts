import { NextRequest, NextResponse } from "next/server"
import {
  verifyWebhook,
  isAgentOrder,
  webhookError,
} from "@/lib/webhook-utils"

type OrderCreatedPayload = {
  order?: {
    id: string
    number: string
    status: string
    channel: { slug: string }
    total: { gross: { amount: number; currency: string } }
    privateMetadata: Array<{ key: string; value: string }>
    fulfillments: Array<{
      id: string
      status: string
      trackingNumber: string | null
      lines: Array<{ id: string; quantity: number; orderLine: { id: string } }>
    }>
  }
}

/**
 * POST /api/webhooks/order-created
 *
 * Receives ORDER_CREATED events from Saleor.
 * If the order was created by an AI agent (has agent_session metadata),
 * logs it for the activity dashboard.
 */
export async function POST(request: NextRequest) {
  const context = await verifyWebhook(request)

  if (!context) {
    return webhookError("Webhook verification failed")
  }

  const payload = context.payload as OrderCreatedPayload
  const order = payload.order

  if (!order) {
    return NextResponse.json({ received: true, agent: false })
  }

  const isAgent = isAgentOrder(order.privateMetadata)

  if (isAgent) {
    console.log(
      `[Agentic Commerce] Agent order created: #${order.number} ` +
        `(${order.total.gross.amount} ${order.total.gross.currency}) ` +
        `channel=${order.channel.slug}`
    )

    // TODO Phase 4: Write to activity tracking storage
  }

  return NextResponse.json({
    received: true,
    agent: isAgent,
    orderId: order.id,
    orderNumber: order.number,
  })
}
