const PRISM_HANDLER_ID = "xyz.fd.prism_payment"
const CHECKED_SCHEME = "exact"

export type SignedPaymentSummary = {
  network: string
  asset: string
  scheme?: string
  value: string
  to: string
  from: string
  nonce: string
  payload: Record<string, unknown>
}

export type StoredAcceptEntry = {
  scheme?: string
  network: string
  asset: string
  amount?: string | null
  payTo: string
}

export type ValidationResult<T extends StoredAcceptEntry = StoredAcceptEntry> =
  | { ok: true; entry: T }
  | { ok: false; code: ValidationErrorCode; message: string }

export type ValidationErrorCode =
  | "no_payment_quote"
  | "no_matching_accepts_entry"
  | "unsupported_payment_scheme"
  | "amount_mismatch"
  | "wrong_recipient"

export function extractSignedSummary(input: unknown): SignedPaymentSummary | null {
  if (typeof input === "string") return extractFromBase64(input)
  if (typeof input !== "object" || input === null) return null
  const obj = input as Record<string, unknown>

  if (!obj.paymentPayload && !obj.payload) {
    const legacy = nonEmptyString(obj.authorization) ?? nonEmptyString(obj.token)
    return legacy ? extractFromBase64(legacy) : null
  }

  const pp = isRecord(obj.paymentPayload) ? obj.paymentPayload : obj
  const accepted = isRecord(pp.accepted) ? pp.accepted : undefined
  const payload = isRecord(pp.payload) ? pp.payload : undefined
  const authz = payload && isRecord(payload.authorization) ? payload.authorization : undefined

  const network = nonEmptyString(accepted?.network)
  const asset = nonEmptyString(accepted?.asset)
  const value = nonEmptyString(authz?.value)
  const to = nonEmptyString(authz?.to)
  const from = nonEmptyString(authz?.from)
  const nonce = nonEmptyString(authz?.nonce)

  if (!network || !asset || !value || !to || !from || !nonce) return null
  return { network, asset, scheme: nonEmptyString(accepted?.scheme), value, to, from, nonce, payload: pp }
}

function extractFromBase64(b64: string): SignedPaymentSummary | null {
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8").decode(bytes))
    return isRecord(parsed) ? extractSignedSummary(parsed) : null
  } catch {
    return null
  }
}

export function readStoredPrismAccepts(
  checkoutMetadata: Record<string, unknown> | undefined,
  _protocol?: "ucp" | "acp",
): StoredAcceptEntry[] | null {
  const data = checkoutMetadata?.[PRISM_HANDLER_ID]
  if (!isRecord(data)) return null
  const ucpEntry = isRecord(data.ucp) ? Object.values(data.ucp)[0] : undefined
  const ucpConfig = Array.isArray(ucpEntry) && isRecord(ucpEntry[0]) ? ucpEntry[0].config : undefined
  const acpConfig = isRecord(data.acp) ? data.acp.config : undefined
  const config = isRecord(ucpConfig) ? ucpConfig : acpConfig
  if (!isRecord(config) || !Array.isArray(config.accepts)) return null
  const accepts = config.accepts.filter(
    (a): a is StoredAcceptEntry =>
      isRecord(a) &&
      typeof a.network === "string" &&
      typeof a.asset === "string" &&
      typeof a.amount === "string" &&
      typeof a.payTo === "string",
  )
  return accepts.length > 0 ? accepts : null
}

export function validateSignedAgainstStored<T extends StoredAcceptEntry>(
  summary: SignedPaymentSummary,
  storedAccepts: readonly T[] | null | undefined,
): ValidationResult<T> {
  if (!storedAccepts || storedAccepts.length === 0) {
    return {
      ok: false,
      code: "no_payment_quote",
      message: "No payment quote found on the checkout. Prepare payment before completing.",
    }
  }

  const matches = storedAccepts.filter(
    (a) =>
      a.network === summary.network &&
      sameAddress(summary.network, a.asset, summary.asset) &&
      (summary.scheme === undefined || a.scheme === summary.scheme),
  )

  if (matches.length > 1) {
    return {
      ok: false,
      code: "no_matching_accepts_entry",
      message: `The checkout quote has more than one entry for (${summary.network}, ${summary.asset}), so the signed payment cannot be bound to one.`,
    }
  }

  if (matches.length === 0) {
    const quoted = storedAccepts.map((a) => `(${a.network}, ${a.asset})`).join(", ")
    return {
      ok: false,
      code: "no_matching_accepts_entry",
      message: `Signed payment uses (${summary.network}, ${summary.asset}) but the checkout was quoted for: ${quoted}.`,
    }
  }
  const match = matches[0]

  if (match.scheme !== CHECKED_SCHEME) {
    return {
      ok: false,
      code: "unsupported_payment_scheme",
      message: `The checkout was quoted in scheme "${match.scheme}", which cannot be checked against a signed amount.`,
    }
  }

  if (typeof match.amount !== "string" || !sameAtomicValue(match.amount, summary.value)) {
    return {
      ok: false,
      code: "amount_mismatch",
      message: `Signed value (${summary.value}) does not match the checkout's quoted amount (${match.amount ?? "none"}) for asset ${summary.asset} on ${summary.network}.`,
    }
  }

  if (!sameAddress(summary.network, match.payTo, summary.to)) {
    return {
      ok: false,
      code: "wrong_recipient",
      message: "Signed payment recipient does not match the merchant's settlement address. Re-sign with the correct recipient.",
    }
  }

  return { ok: true, entry: match }
}

function sameAddress(network: string, a: string, b: string): boolean {
  return canonicalOnNetwork(network, a) === canonicalOnNetwork(network, b)
}

export function canonicalOnNetwork(network: string, value: string): string {
  return network.startsWith("eip155:") || /^0x[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : value
}

export function signedAuthorizationReplayKey(summary: SignedPaymentSummary): string {
  const { network } = summary
  const parts = [summary.asset, summary.from, summary.nonce].map((part) => canonicalOnNetwork(network, part))
  return JSON.stringify(["x402-authorization", network, ...parts])
}

function sameAtomicValue(quoted: string, signed: string): boolean {
  if (!/^\d+$/.test(quoted) || !/^\d+$/.test(signed)) return false
  return BigInt(quoted) === BigInt(signed)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
