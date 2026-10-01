/**
 * Protocol-specific error response formatters.
 * Each protocol has a different error response schema.
 */

// --- ACP Errors ---

import type { AcpErrorType, AcpErrorResponse } from "../types/acp.js"

export type { AcpErrorType, AcpErrorResponse }

export function formatAcpError(params: {
  type?: AcpErrorType
  code: string
  message: string
  param?: string
  httpStatus?: number
}): AcpErrorResponse {
  const type = params.type || httpStatusToAcpType(params.httpStatus || 500)
  return {
    type,
    code: params.code,
    message: params.message,
    ...(params.param ? { param: params.param } : {}),
  }
}

export function httpStatusToAcpType(status: number): AcpErrorType {
  if (status >= 400 && status < 500) return "invalid_request"
  if (status === 503) return "service_unavailable"
  return "processing_error"
}

// --- UCP Errors ---

export type UcpErrorSeverity =
  | "recoverable"
  | "requires_buyer_input"
  | "requires_buyer_review"
  | "unrecoverable"

/** One error message the caller wants surfaced (message_error.json). */
export type UcpErrorMessageInput = {
  code: string
  content: string
  severity?: UcpErrorSeverity
  /** RFC 9535 JSONPath to the offending component, e.g. "$.buyer.email". */
  path?: string
  content_type?: "plain" | "markdown"
}

export type UcpErrorResponse = {
  ucp: {
    version: string
    status: "error"
  }
  messages: {
    type: "error"
    code: string
    content: string
    severity: UcpErrorSeverity
    path?: string
    content_type?: "plain" | "markdown"
  }[]
  continue_url?: string
}

/**
 * Build a UCP error response. Accepts either a single message (code/content/
 * severity/path) or a `messages` array — message_error.json allows many, and
 * emitting one per underlying error avoids the old errors[0]-only truncation
 * that hid secondary failures (SAC-5). `path` carries the JSONPath slot the
 * spec defines for field-scoped errors; severity is no longer forced to
 * "unrecoverable" — callers pass the right one.
 */
export function formatUcpError(params: {
  ucpVersion: string
  code?: string
  content?: string
  severity?: UcpErrorSeverity
  path?: string
  messages?: UcpErrorMessageInput[]
}): UcpErrorResponse {
  const inputs: UcpErrorMessageInput[] =
    params.messages && params.messages.length > 0
      ? params.messages
      : [
          {
            code: params.code ?? "error",
            content: params.content ?? "",
            severity: params.severity,
            path: params.path,
          },
        ]

  return {
    ucp: {
      version: params.ucpVersion,
      status: "error",
    },
    messages: inputs.map((m) => ({
      type: "error" as const,
      code: m.code,
      content: m.content,
      severity: m.severity ?? "unrecoverable",
      ...(m.path ? { path: m.path } : {}),
      ...(m.content_type ? { content_type: m.content_type } : {}),
    })),
  }
}

type SaleorFieldError = {
  field?: string | null
  message?: string | null
  code?: string | null
}

/**
 * Map Saleor's structured mutation errors into UCP error messages, one per
 * error (not just the first), preserving the offending `field` so an agent can
 * fix the input. Saleor fields are flat camelCase, so the field name is kept in
 * the content ("postalCode: This field is required.") rather than fabricated
 * into a JSONPath that may not resolve against the response document.
 */
export function saleorErrorsToUcpMessages(
  errors: unknown,
  opts: { code: string; severity?: UcpErrorSeverity; fallbackContent?: string },
): UcpErrorMessageInput[] {
  const arr = Array.isArray(errors) ? (errors as SaleorFieldError[]) : []
  if (arr.length === 0) {
    return opts.fallbackContent
      ? [{ code: opts.code, content: opts.fallbackContent, severity: opts.severity }]
      : []
  }
  return arr.map((e) => {
    const message = e.message ?? "Unknown error"
    return {
      code: opts.code,
      content: e.field ? `${e.field}: ${message}` : message,
      severity: opts.severity ?? "recoverable",
    }
  })
}
