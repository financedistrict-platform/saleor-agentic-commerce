import type { UcpVersionRegistry, UcpWire } from "@financedistrict/saleor-agentic-commerce-core"
import type { AgentProfileFetcher } from "@financedistrict/saleor-agentic-commerce-core/agent-profile-fetcher"
import { parseUcpHeaders } from "./ucp-headers.js"

export const UCP_VERSION_METADATA_KEY = "ucp_version"

export type UcpProfileOutcome = "none" | "matched" | "undeclared" | "unknown" | "unreachable" | "redirected" | "disabled"

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
  location?: string
  rejection?: UcpResolutionRejection
}

const FALLBACK_OUTCOMES: readonly UcpProfileOutcome[] = ["undeclared", "unreachable"]

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
  location?: string,
): UcpResolution {
  const resolution: UcpResolution = { version, wire: registry.wire(version), outcome, declared, host }
  if (location !== undefined) resolution.location = location
  return resolution
}

function rejected(
  registry: UcpVersionRegistry,
  outcome: UcpProfileOutcome,
  rejection: UcpResolutionRejection,
  declared?: string,
  host?: string,
  location?: string,
): UcpResolution {
  return { ...served(registry, registry.current, outcome, declared, host, location), rejection }
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
  let location: string | undefined
  switch (profile.status) {
    case "ok":
      if (!declared) outcome = "undeclared"
      else if (!registry.isKnown(declared)) outcome = "unknown"
      else if (!registry.isEnabled(declared)) outcome = "disabled"
      else outcome = "matched"
      break
    case "redirected":
      outcome = "redirected"
      location = profile.location ?? undefined
      break
    case "failed":
    case "busy":
      outcome = "unreachable"
      break
    default: {
      const unhandled: never = profile
      void unhandled
      outcome = "unreachable"
    }
  }

  if (outcome === "matched") return served(registry, declared!, outcome, declared, host)

  if (outcome === "disabled" || outcome === "unknown") {
    return rejected(registry, outcome, {
      status: 422,
      code: "version_unsupported",
      content: unsupportedVersionMessage(registry, declared!),
    }, declared, host)
  }

  if (outcome === "redirected") {
    return rejected(registry, outcome, {
      status: 424,
      code: "profile_redirected",
      content: location
        ? `Agent profile URL redirects to ${location}; use the final URL.`
        : "Agent profile URL redirects; use the final URL.",
    }, declared, host, location)
  }

  if (registry.negotiation === "strict") {
    return rejected(registry, outcome, outcome === "unreachable"
      ? { status: 424, code: "profile_unreachable", content: "Agent profile could not be retrieved." }
      : { status: 422, code: "profile_malformed", content: "Agent profile does not declare a UCP version." },
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
      content: `This session is bound to UCP version ${pinned}; the agent profile now declares ${resolution.declared}.`,
    }, resolution.declared, resolution.host)
  }

  return { ...resolution, version: pinned, wire: registry.wire(pinned) }
}

export function sessionPinFor(resolution: UcpResolution): string | undefined {
  return resolution.outcome === "matched" ? resolution.version : undefined
}

export function logUcpResolution(resolution: UcpResolution): void {
  if (resolution.outcome === "none" || resolution.outcome === "matched") return
  const entry: Record<string, string | null> = {
    ucp_profile_resolution: resolution.outcome,
    served: resolution.version,
    host: resolution.host ?? "",
  }
  if (resolution.outcome === "redirected") entry.location = resolution.location ?? null
  console.warn(JSON.stringify(entry))
}
