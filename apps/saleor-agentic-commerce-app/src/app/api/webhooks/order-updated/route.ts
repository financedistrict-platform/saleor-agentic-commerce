import { NextRequest, NextResponse } from "next/server"
import { verifyWebhook, isAgentOrder } from "@/lib/webhook-utils"

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
  const verified = await verifyWebhook(request)

  if (!verified.ok) {
    return verified.response
  }

  const context = verified.context

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
