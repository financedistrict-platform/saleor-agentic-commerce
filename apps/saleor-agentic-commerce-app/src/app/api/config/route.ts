import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { ConfigManager } from "@/lib/config-manager"
import {
  redactGlobalConfig,
  redactPaymentHandlers,
  restoreGlobalSecrets,
  restoreHandlerSecrets,
} from "@/lib/config-secrets"

/**
 * GET /api/config
 *
 * Returns the full Agentic Commerce configuration:
 * global settings, channel configs, and available channels.
 *
 * Called by the Dashboard configuration page.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request)

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const manager = new ConfigManager(auth.saleorApiUrl, auth.token)

    const [globalConfig, channelConfigs, channels, paymentHandlers] =
      await Promise.all([
        manager.getGlobalConfig(),
        manager.getAllChannelConfigs(),
        manager.getChannels(),
        manager.getAllPaymentHandlers(),
      ])

    return NextResponse.json({
      global: redactGlobalConfig(globalConfig),
      channels: channels.map((ch) => ({
        ...ch,
        agenticConfig: channelConfigs[ch.slug] ?? null,
      })),
      paymentHandlers: redactPaymentHandlers(paymentHandlers),
    })
  } catch (error) {
    console.error("[Config API] Failed to load config:", error)
    return NextResponse.json(
      { error: "Failed to load configuration" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/config
 *
 * Updates Agentic Commerce configuration.
 *
 * Body: { global?: Partial<GlobalConfig>, channels?: Record<slug, ChannelConfig> }
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request)

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const manager = new ConfigManager(auth.saleorApiUrl, auth.token)

    // Save global config
    if (body.global) {
      await manager.saveGlobalConfig(
        restoreGlobalSecrets(body.global, await manager.getGlobalConfig())
      )
    }

    // Save per-channel configs
    if (body.channels) {
      for (const [slug, config] of Object.entries(body.channels)) {
        await manager.saveChannelConfig(slug, config as any)
      }
    }

    // Save per-handler entries — body.paymentHandlers maps handlerId →
    // PaymentHandlerEntry (full replace per handler).
    if (body.paymentHandlers) {
      for (const [handlerId, entry] of Object.entries(body.paymentHandlers)) {
        await manager.savePaymentHandler(
          handlerId,
          restoreHandlerSecrets(
            entry as any,
            await manager.getPaymentHandler(handlerId)
          )
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Config API] Failed to save config:", error)
    return NextResponse.json(
      { error: "Failed to save configuration" },
      { status: 500 }
    )
  }
}
