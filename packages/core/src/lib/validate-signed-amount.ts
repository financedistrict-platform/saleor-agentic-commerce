/**
 * Validate the agent's signed x402 payment payload against the checkout's
 * stored Prism quote on (network, asset, amount, recipient). Strict
 * equality on amount — FX and buffer are baked in at prepare time.
 */

const PRISM_HANDLER_ID = "xyz.fd.prism_payment"

// =====================================================
// Public types
// =====================================================

export type SignedPaymentSummary = {
  network: string
  asset: string
  /** EIP-3009 signed `value` as an atomic-unit string */
  value: string
  /** EIP-3009 signed recipient (`authorization.to`) */
  to: string
}

export type StoredAcceptEntry = {
  network: string
  asset: string
  amount: string
  payTo: string
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: ValidationErrorCode; message: string }

export type ValidationErrorCode =
  | "no_payment_quote"
  | "no_matching_accepts_entry"
  | "amount_mismatch"
  | "wrong_recipient"

// =====================================================
// Extraction — handles every credential shape we've seen on the wire
// =====================================================

/**
 * Extract (network, asset, value, to) from a UCP/ACP credential.
 * Handles base64-string, legacy single-field, wrapper, and flat shapes.
 * Returns null if the input is unrecognised or missing required fields.
 */
export function extractSignedSummary(input: unknown): SignedPaymentSummary | null {
  if (typeof input === "string") {
    return extractFromBase64(input)
  }
  if (typeof input !== "object" || input === null) {
    return null
  }
  const obj = input as Record<string, unknown>

  // Legacy single-field shape: { authorization: "<b64>" } or { token: "<b64>" }
  if (
    typeof obj.authorization === "string" &&
    obj.authorization.length > 0 &&
    !obj.paymentPayload &&
    !obj.payload
  ) {
    return extractFromBase64(obj.authorization)
  }
  if (
    typeof obj.token === "string" &&
    obj.token.length > 0 &&
    !obj.paymentPayload &&
    !obj.payload
  ) {
    return extractFromBase64(obj.token)
  }

  // Wrapper { paymentPayload, ... } or flat (obj IS the paymentPayload).
  const pp =
    obj.paymentPayload && typeof obj.paymentPayload === "object"
      ? (obj.paymentPayload as Record<string, unknown>)
      : obj

  const accepted = pp.accepted as Record<string, unknown> | undefined
  const payload = pp.payload as Record<string, unknown> | undefined
  const authz = payload?.authorization as Record<string, unknown> | undefined

  const network = readNonEmptyString(accepted, "network")
  const asset = readNonEmptyString(accepted, "asset")
  const value = readNonEmptyString(authz, "value")
  const to = readNonEmptyString(authz, "to")

  if (!network || !asset || !value || !to) return null
  return { network, asset, value, to }
}

function extractFromBase64(b64: string): SignedPaymentSummary | null {
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const decoded = new TextDecoder("utf-8").decode(bytes)
    const parsed = JSON.parse(decoded)
    return extractSignedSummary(parsed)
  } catch {
    return null
  }
}

// =====================================================
// Stored-accepts reader
// =====================================================

/**
 * Read the checkout's stored Prism accepts[] for the given protocol.
 * Returns null if the checkout wasn't prepared for Prism. The handler
 * config is set on Saleor's private metadata at prepare time under
 * the Prism handler id.
 */
export function readStoredPrismAccepts(
  checkoutMetadata: Record<string, unknown> | undefined,
  protocol: "ucp" | "acp",
): StoredAcceptEntry[] | null {
  if (!checkoutMetadata) return null
  const data = checkoutMetadata[PRISM_HANDLER_ID]
  if (typeof data !== "object" || data === null) return null
  const d = data as Record<string, unknown>

  if (protocol === "ucp") {
    const ucp = d.ucp
    if (typeof ucp !== "object" || ucp === null) return null
    const firstNs = Object.values(ucp as Record<string, unknown>)[0]
    if (!Array.isArray(firstNs) || firstNs.length === 0) return null
    const firstEntry = firstNs[0] as Record<string, unknown>
    const config = firstEntry?.config as Record<string, unknown> | undefined
    return readAcceptsFromConfig(config)
  }

  // ACP
  const acp = d.acp
  if (typeof acp !== "object" || acp === null) return null
  const config = (acp as Record<string, unknown>).config as
    | Record<string, unknown>
    | undefined
  return readAcceptsFromConfig(config)
}

function readAcceptsFromConfig(
  config: Record<string, unknown> | undefined,
): StoredAcceptEntry[] | null {
  if (!config) return null
  const accepts = config.accepts
  if (!Array.isArray(accepts)) return null
  const filtered = accepts.filter(
    (a): a is StoredAcceptEntry =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as Record<string, unknown>).network === "string" &&
      typeof (a as Record<string, unknown>).asset === "string" &&
      typeof (a as Record<string, unknown>).amount === "string" &&
      typeof (a as Record<string, unknown>).payTo === "string",
  )
  return filtered.length > 0 ? filtered : null
}

// =====================================================
// Validation
// =====================================================

/**
 * Validate the signed summary against the checkout's stored accepts.
 * Strict equality on network (exact), asset & recipient (case-insensitive
 * for address checksum tolerance), and amount (BigInt comparison).
 */
export function validateSignedAgainstStored(
  summary: SignedPaymentSummary,
  storedAccepts: StoredAcceptEntry[] | null,
): ValidationResult {
  if (!storedAccepts || storedAccepts.length === 0) {
    return {
      ok: false,
      code: "no_payment_quote",
      message:
        "No payment quote found on the checkout. Prepare payment before completing.",
    }
  }

  const match = storedAccepts.find(
    (a) => a.network === summary.network && sameAddress(a.asset, summary.asset),
  )

  if (!match) {
    const quoted = storedAccepts
      .map((a) => `(${a.network}, ${a.asset})`)
      .join(", ")
    return {
      ok: false,
      code: "no_matching_accepts_entry",
      message: `Signed payment uses (${summary.network}, ${summary.asset}) but the checkout was quoted for: ${quoted}.`,
    }
  }

  if (!sameAtomicValue(match.amount, summary.value)) {
    return {
      ok: false,
      code: "amount_mismatch",
      message: `Signed value (${summary.value}) does not match the checkout's quoted amount (${match.amount}) for asset ${summary.asset} on ${summary.network}.`,
    }
  }

  if (!sameAddress(match.payTo, summary.to)) {
    return {
      ok: false,
      code: "wrong_recipient",
      message: `Signed payment recipient does not match the merchant's settlement address. Re-sign with the correct recipient.`,
    }
  }

  return { ok: true }
}

// =====================================================
// Internal helpers
// =====================================================

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function sameAtomicValue(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

function readNonEmptyString(
  obj: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!obj) return undefined
  const v = obj[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}
