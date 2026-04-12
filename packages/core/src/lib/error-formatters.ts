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

export type UcpErrorResponse = {
  ucp: {
    version: string
    status: "error"
  }
  messages: {
    type: "error"
    code: string
    content: string
    severity: "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable"
  }[]
  continue_url?: string
}

export function formatUcpError(params: {
  ucpVersion: string
  code: string
  content: string
  severity?: "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable"
}): UcpErrorResponse {
  return {
    ucp: {
      version: params.ucpVersion,
      status: "error",
    },
    messages: [
      {
        type: "error",
        code: params.code,
        content: params.content,
        severity: params.severity || "unrecoverable",
      },
    ],
  }
}
