import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { ConfigManager } from "@/lib/config-manager"

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

    const [globalConfig, channelConfigs, channels] = await Promise.all([
      manager.getGlobalConfig(),
      manager.getAllChannelConfigs(),
      manager.getChannels(),
    ])

    return NextResponse.json({
      global: globalConfig,
      channels: channels.map((ch) => ({
        ...ch,
        agenticConfig: channelConfigs[ch.slug] ?? null,
      })),
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
      await manager.saveGlobalConfig(body.global)
    }

    // Save per-channel configs
    if (body.channels) {
      for (const [slug, config] of Object.entries(body.channels)) {
        await manager.saveChannelConfig(slug, config as any)
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
