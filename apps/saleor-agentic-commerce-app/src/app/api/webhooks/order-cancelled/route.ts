import { NextRequest, NextResponse } from "next/server"
import { verifyWebhook, isAgentOrder, webhookError } from "@/lib/webhook-utils"

type OrderCancelledPayload = {
  order?: {
    id: string
    number: string
    status: string
    privateMetadata: Array<{ key: string; value: string }>
  }
}

/**
 * POST /api/webhooks/order-cancelled
 *
 * Receives ORDER_CANCELLED events from Saleor.
 * Updates status for agent-created orders.
 */
export async function POST(request: NextRequest) {
  const context = await verifyWebhook(request)

  if (!context) {
    return webhookError("Webhook verification failed")
  }

  const payload = context.payload as OrderCancelledPayload
  const order = payload.order

  if (!order) {
    return NextResponse.json({ received: true, agent: false })
  }

  if (isAgentOrder(order.privateMetadata)) {
    console.log(
      `[Agentic Commerce] Agent order cancelled: #${order.number}`
    )

    // TODO Phase 4: Update activity tracking
  }

  return NextResponse.json({ received: true })
}
