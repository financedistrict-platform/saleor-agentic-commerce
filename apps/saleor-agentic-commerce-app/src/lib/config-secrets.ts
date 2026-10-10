import type { GlobalConfig, PaymentHandlerEntry } from "./metadata-keys"

export const REDACTED_SECRET = "••••••••"

const SECRET_NAME = /(api_?key|secret|token|password)$/i

function isSecretField(entry: PaymentHandlerEntry | null | undefined, field: string): boolean {
  if (SECRET_NAME.test(field)) return true
  const properties = entry?.manifest?.configSchema?.properties as
    | Record<string, { format?: unknown; writeOnly?: unknown }>
    | undefined
  const property = properties?.[field]
  return property?.format === "password" || property?.writeOnly === true
}

function redact(value: unknown): unknown {
  return typeof value === "string" && value.length > 0 ? REDACTED_SECRET : value
}

export function redactGlobalConfig(config: GlobalConfig): GlobalConfig {
  return { ...config, acpApiKey: redact(config.acpApiKey) as string }
}

export function redactPaymentHandlers(
  handlers: Record<string, PaymentHandlerEntry>,
): Record<string, PaymentHandlerEntry> {
  return Object.fromEntries(
    Object.entries(handlers).map(([handlerId, entry]) => [
      handlerId,
      {
        ...entry,
        config: Object.fromEntries(
          Object.entries(entry.config ?? {}).map(([field, value]) => [
            field,
            isSecretField(entry, field) ? redact(value) : value,
          ]),
        ),
      },
    ]),
  )
}

export function publicHandlerConfig(entry: PaymentHandlerEntry): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entry.config ?? {}).filter(([field]) => !isSecretField(entry, field)),
  )
}

export function resolveSecret(submitted: unknown, stored: unknown): unknown {
  return submitted === REDACTED_SECRET ? stored : submitted
}

export function restoreGlobalSecrets(
  submitted: Partial<GlobalConfig>,
  stored: GlobalConfig,
): Partial<GlobalConfig> {
  if (submitted.acpApiKey !== REDACTED_SECRET) return submitted
  return { ...submitted, acpApiKey: stored.acpApiKey }
}

export function restoreHandlerSecrets(
  submitted: PaymentHandlerEntry,
  stored: PaymentHandlerEntry | null,
): PaymentHandlerEntry {
  const config = Object.fromEntries(
    Object.entries(submitted.config ?? {})
      .map(([field, value]) => [field, resolveSecret(value, stored?.config?.[field])] as const)
      .filter(([, value]) => value !== undefined),
  )
  return { ...submitted, config }
}
