import type { UcpVersionRegistry, UcpWire } from "@financedistrict/saleor-agentic-commerce-core"
import type { AgentProfileFetcher } from "@financedistrict/saleor-agentic-commerce-core/agent-profile-fetcher"
import { parseUcpHeaders } from "./ucp-headers.js"

export const UCP_VERSION_METADATA_KEY = "ucp_version"

export type UcpProfileOutcome = "none" | "matched" | "undeclared" | "unknown" | "unreachable" | "disabled"

export type UcpResolutionRejection = {
  status: 422 | 424
  code: string
  content: string
}

export type UcpResolution = {
  version: string
  wire: UcpWire
  outcome: UcpProfileOutcome
  declared?: string
  host?: string
  rejection?: UcpResolutionRejection
}

const FALLBACK_OUTCOMES: readonly UcpProfileOutcome[] = ["undeclared", "unknown", "unreachable"]

export function isFallbackOutcome(outcome: UcpProfileOutcome): boolean {
  return FALLBACK_OUTCOMES.includes(outcome)
}

export function unsupportedVersionMessage(registry: UcpVersionRegistry, requested: string): string {
  return `Version ${requested} is not supported. This business implements versions ${registry.enabled().join(", ")}.`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

function served(
  registry: UcpVersionRegistry,
  version: string,
  outcome: UcpProfileOutcome,
  declared?: string,
  host?: string,
): UcpResolution {
  return { version, wire: registry.wire(version), outcome, declared, host }
}

function rejected(
  registry: UcpVersionRegistry,
  outcome: UcpProfileOutcome,
  rejection: UcpResolutionRejection,
  declared?: string,
  host?: string,
): UcpResolution {
  return { ...served(registry, registry.current, outcome, declared, host), rejection }
}

export async function resolveUcpVersion(
  registry: UcpVersionRegistry,
  request: Request,
  fetcher: AgentProfileFetcher,
): Promise<UcpResolution> {
  const url = parseUcpHeaders(request).agentProfile
  if (!url) return served(registry, registry.current, "none")

  const host = hostOf(url)
  const profile = await fetcher.lookup(url)
  const declared = profile.status === "ok" && profile.version ? profile.version : undefined

  let outcome: UcpProfileOutcome
  if (profile.status !== "ok") outcome = "unreachable"
  else if (!declared) outcome = "undeclared"
  else if (!registry.isKnown(declared)) outcome = "unknown"
  else if (!registry.isEnabled(declared)) outcome = "disabled"
  else outcome = "matched"

  if (outcome === "matched") return served(registry, declared!, outcome, declared, host)

  if (outcome === "disabled") {
    return rejected(registry, outcome, {
      status: 422,
      code: "version_unsupported",
      content: unsupportedVersionMessage(registry, declared!),
    }, declared, host)
  }

  if (registry.negotiation === "strict") {
    return rejected(registry, outcome, outcome === "unreachable"
      ? { status: 424, code: "agent_profile_unavailable", content: "Agent profile could not be retrieved." }
      : { status: 422, code: "version_unsupported", content: unsupportedVersionMessage(registry, declared ?? "undeclared") },
    declared, host)
  }

  return served(registry, registry.current, outcome, declared, host)
}

export function applyUcpSessionPin(
  registry: UcpVersionRegistry,
  resolution: UcpResolution,
  pinned: unknown,
): UcpResolution {
  if (resolution.rejection) return resolution
  if (typeof pinned !== "string" || !registry.isKnown(pinned)) return resolution

  if (resolution.outcome === "matched") {
    if (resolution.declared === pinned) return resolution
    return rejected(registry, resolution.outcome, {
      status: 422,
      code: "version_unsupported",
      content: unsupportedVersionMessage(registry, resolution.declared!),
    }, resolution.declared, resolution.host)
  }

  return { ...resolution, version: pinned, wire: registry.wire(pinned) }
}

export function sessionPinFor(resolution: UcpResolution): string | undefined {
  return resolution.outcome === "matched" ? resolution.version : undefined
}

export function logUcpResolution(resolution: UcpResolution): void {
  if (resolution.outcome === "none" || resolution.outcome === "matched") return
  console.warn(JSON.stringify({
    ucp_profile_resolution: resolution.outcome,
    served: resolution.version,
    host: resolution.host ?? "",
  }))
}
