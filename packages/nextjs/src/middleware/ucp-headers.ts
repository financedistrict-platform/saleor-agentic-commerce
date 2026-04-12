/**
 * UCP Header Middleware
 *
 * Parses and validates UCP-specific headers from incoming requests.
 * Used by route handlers to extract agent profile, request IDs,
 * and idempotency keys.
 */

/**
 * Parsed UCP request headers.
 */
export type UcpRequestHeaders = {
  /** Agent profile URL from UCP-Agent header */
  agentProfile: string | null
  /** Request ID for tracing */
  requestId: string | null
  /** Idempotency key for state-modifying operations */
  idempotencyKey: string | null
  /** Content digest for body verification */
  contentDigest: string | null
}

/**
 * Extract UCP-specific headers from a request.
 *
 * UCP-Agent header format: profile="https://agent.example/.well-known/ucp"
 */
export function parseUcpHeaders(request: Request): UcpRequestHeaders {
  const agentHeader = request.headers.get("UCP-Agent")
  let agentProfile: string | null = null

  if (agentHeader) {
    // Parse RFC 8941 Dictionary format: profile="url"
    const match = agentHeader.match(/profile="([^"]+)"/)
    agentProfile = match ? match[1] : agentHeader
  }

  return {
    agentProfile,
    requestId: request.headers.get("Request-Id") || request.headers.get("X-Request-Id"),
    idempotencyKey: request.headers.get("Idempotency-Key"),
    contentDigest: request.headers.get("Content-Digest"),
  }
}

/**
 * Validate that required UCP headers are present for state-modifying operations.
 * Returns an error message if validation fails, null if OK.
 */
export function validateUcpHeaders(
  headers: UcpRequestHeaders,
  options: { requireAgent?: boolean; requireIdempotency?: boolean } = {},
): string | null {
  if (options.requireAgent && !headers.agentProfile) {
    return "UCP-Agent header is required"
  }
  if (options.requireIdempotency && !headers.idempotencyKey) {
    return "Idempotency-Key header is required"
  }
  return null
}

/**
 * Create standard UCP response headers.
 */
export function ucpResponseHeaders(requestId?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (requestId) {
    headers["Request-Id"] = requestId
  }
  return headers
}
