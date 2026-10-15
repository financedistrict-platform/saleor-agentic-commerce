import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { ConfigManager } from "@/lib/config-manager"
import { PRISM_HANDLER_ID } from "@/lib/metadata-keys"
import { QUERIES, SaleorApiClient } from "@/lib/saleor-api"
import { fromPrism } from "@/lib/settlement-summary"

const PRISM_TRANSACTION_NAME = "Finance District Prism"
const PRISM_TIMEOUT_MS = 5000

type OrderSettlementData = {
  order: {
    channel: { slug: string }
    transactions: { name: string; pspReference: string | null }[]
  } | null
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orderId = request.nextUrl.searchParams.get("orderId")
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 })
  }

  try {
    const data = await new SaleorApiClient(auth.saleorApiUrl, auth.token).query<OrderSettlementData>(
      QUERIES.GET_ORDER_SETTLEMENT,
      { id: orderId }
    )
    const tx = data.order?.transactions.find(
      (t) => (t.name === PRISM_TRANSACTION_NAME || t.name === PRISM_HANDLER_ID) && !!t.pspReference
    )
    if (!data.order || !tx?.pspReference) {
      return NextResponse.json({ state: "none" })
    }

    const entry = await new ConfigManager(auth.saleorApiUrl, auth.token).getPaymentHandler(
      PRISM_HANDLER_ID
    )
    const apiKey = entry?.config?.apiKey
    const apiUrl = entry?.config?.apiUrl
    if (
      !entry ||
      typeof apiKey !== "string" ||
      !apiKey ||
      typeof apiUrl !== "string" ||
      !apiUrl ||
      (Array.isArray(entry.channels) && !entry.channels.includes(data.order.channel.slug))
    ) {
      return NextResponse.json({ state: "unavailable" })
    }

    const res = await fetch(
      `${apiUrl.replace(/\/$/, "")}/api/v2/merchant/payments/${encodeURIComponent(tx.pspReference)}/settlement`,
      { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(PRISM_TIMEOUT_MS) }
    )
    if (!res.ok) {
      return NextResponse.json({ state: "unavailable" })
    }
    return NextResponse.json(fromPrism(await res.json()))
  } catch {
    return NextResponse.json({ state: "unavailable" })
  }
}
