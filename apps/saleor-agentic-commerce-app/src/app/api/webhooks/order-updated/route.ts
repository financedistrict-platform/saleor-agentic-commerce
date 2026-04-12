import { NextRequest, NextResponse } from "next/server"
import { verifyWebhook, isAgentOrder, webhookError } from "@/lib/webhook-utils"

type OrderUpdatedPayload = {
  order?: {
    id: string
    number: string
    status: string
    privateMetadata: Array<{ key: string; value: string }>
  }
}

/**
 * POST /api/webhooks/order-updated
 *
 * Receives ORDER_UPDATED events from Saleor.
 * Tracks status transitions for agent-created orders.
 */
export async function POST(request: NextRequest) {
  const context = await verifyWebhook(request)

  if (!context) {
    return webhookError("Webhook verification failed")
  }

  const payload = context.payload as OrderUpdatedPayload
  const order = payload.order

  if (!order) {
    return NextResponse.json({ received: true, agent: false })
  }

  if (isAgentOrder(order.privateMetadata)) {
    console.log(
      `[Agentic Commerce] Agent order updated: #${order.number} → ${order.status}`
    )

    // TODO Phase 4: Update activity tracking
  }

  return NextResponse.json({ received: true })
}
