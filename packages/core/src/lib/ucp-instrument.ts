function hasString(value: unknown, key: string): boolean {
  if (typeof value !== "object" || value === null) return false
  const v = (value as Record<string, unknown>)[key]
  return typeof v === "string" && v.length > 0
}

export function isWellFormedInstrument(instrument: unknown): boolean {
  if (!hasString(instrument, "handler_id")) return false
  const credential = (instrument as Record<string, unknown>).credential
  return credential === undefined || (typeof credential === "object" && credential !== null)
}
