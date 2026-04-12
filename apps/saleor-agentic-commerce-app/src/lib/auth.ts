/**
 * Authentication utilities for the Saleor App.
 *
 * Verifies that requests to the App's internal APIs come from
 * a valid Saleor Dashboard session.
 */

import { NextRequest } from "next/server"
import { saleorApp } from "./saleor-app"

export type AuthContext = {
  saleorApiUrl: string
  token: string
}

/**
 * Extract Saleor auth context from a Dashboard request.
 *
 * The App's frontend (loaded in the Dashboard iframe) passes
 * the `saleorApiUrl` as a query parameter or header. We look up
 * the stored auth data for that instance.
 */
export async function getAuthContext(
  request: NextRequest
): Promise<AuthContext | null> {
  const saleorApiUrl =
    request.headers.get("saleor-api-url") ??
    request.nextUrl.searchParams.get("saleorApiUrl")

  if (!saleorApiUrl) {
    return null
  }

  const authData = await saleorApp.apl.get(saleorApiUrl)

  if (!authData) {
    return null
  }

  return {
    saleorApiUrl: authData.saleorApiUrl,
    token: authData.token,
  }
}
