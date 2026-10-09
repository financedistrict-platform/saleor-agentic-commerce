import { NextRequest, NextResponse } from "next/server"
import { verifyWebhook, isAgentOrder } from "@/lib/webhook-utils"

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
  const verified = await verifyWebhook(request)

  if (!verified.ok) {
    return verified.response
  }

  const context = verified.context

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
