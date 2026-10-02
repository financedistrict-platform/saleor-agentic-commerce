import type { UcpErrorMessageInput, UcpErrorSeverity } from "../error-formatters.js"
import type { UcpProfile } from "../../types/ucp.js"

export type UcpWireCapability = "catalog" | "checkout" | "order"

export type UcpProfileInput = {
  endpoint: string
  handlers: Record<string, unknown[]>
  supportedVersions: Record<string, string>
}

export type UcpWireErrorInput = {
  code?: string
  content?: string
  severity?: UcpErrorSeverity
  path?: string
  messages?: UcpErrorMessageInput[]
}

export interface UcpWire {
  readonly version: string
  profile(input: UcpProfileInput): UcpProfile
  envelopeCapabilities(): Record<string, { version: string }[]>
  checkoutHandlers(handlers: Record<string, unknown[]>): Record<string, unknown[]>
  error(input: UcpWireErrorInput): Record<string, unknown>
  supports(capability: UcpWireCapability): boolean
}

export function withSupportedVersions<T extends Record<string, unknown>>(
  ucp: T,
  supportedVersions: Record<string, string>,
): T {
  if (Object.keys(supportedVersions).length === 0) return ucp
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(ucp)) {
    result[key] = value
    if (key === "version") result.supported_versions = supportedVersions
  }
  return result as T
}

export function withoutHandlerFields(
  handlers: Record<string, unknown[]>,
  fields: readonly string[],
): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {}
  for (const [namespace, entries] of Object.entries(handlers)) {
    result[namespace] = entries.map((entry) => {
      if (typeof entry !== "object" || entry === null) return entry
      const copy = { ...(entry as Record<string, unknown>) }
      for (const field of fields) delete copy[field]
      return copy
    })
  }
  return result
}

export function checkoutAndOrderCapabilities(version: string): Record<string, { version: string }[]> {
  return {
    "dev.ucp.shopping.checkout": [{ version }],
    "dev.ucp.shopping.order": [{ version }],
  }
}

export function shoppingService(version: string, endpoint: string, schemaFile = "rest.openapi.json") {
  return {
    "dev.ucp.shopping": [
      {
        version,
        spec: `https://ucp.dev/${version}/specification/overview`,
        schema: `https://ucp.dev/${version}/services/shopping/${schemaFile}`,
        transport: "rest" as const,
        endpoint,
      },
    ],
  }
}

export function capability(version: string, spec: string, schema: string) {
  return [{ version, spec: `https://ucp.dev/${version}/specification/${spec}`, schema: `https://ucp.dev/${version}/schemas/shopping/${schema}` }]
}
