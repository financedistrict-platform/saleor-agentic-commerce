/**
 * Caller-token validation for App endpoints exposed to the storefront.
 *
 * Used by `/api/config-public` and `/api/handlers/register` (and any future
 * cross-App endpoint). Both validate the caller by probing Saleor with the
 * supplied token: if Saleor returns a real installed App identity, the
 * token is valid.
 *
 * Trust model: any token belonging to an installed App on the same Saleor
 * instance passes. We don't have a finer-grained allow-list mechanism
 * today; that's an explicit non-goal for v1.
 */

import type { NextRequest } from "next/server"
import type { AuthData } from "@saleor/app-sdk/APL"
import { saleorApp } from "@/lib/saleor-app"

export type CallerCredentials = {
  token: string
  saleorApiUrl: string
}

type CallerRejection = { ok: false; status: number; message: string }

type CallerValidation = { ok: true; appId: string } | CallerRejection

export type CallerAuthorization =
  | { ok: true; appId: string; ownAuth: AuthData }
  | CallerRejection

/**
 * Pull `Authorization: Bearer <token>` and `saleor-api-url` from the
 * request. The url can also come via `?saleorApiUrl=` for clients that
 * find headers awkward.
 */
export function readCallerCredentials(
  request: NextRequest,
): CallerCredentials | null {
  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : ""
  const saleorApiUrl =
    request.headers.get("saleor-api-url") ??
    request.nextUrl.searchParams.get("saleorApiUrl") ??
    ""
  if (!token || !saleorApiUrl) return null
  return { token, saleorApiUrl }
}

/**
 * Probe Saleor with the caller's token. If it resolves to a real
 * installed App, the token is valid.
 */
async function validateCallerToken(
  creds: CallerCredentials,
): Promise<CallerValidation> {
  let res: Response
  try {
    res = await fetch(creds.saleorApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({ query: "{ app { id name } }" }),
    })
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: `Saleor unreachable: ${err instanceof Error ? err.message : "unknown"}`,
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      status: 401,
      message: `Saleor returned ${res.status}`,
    }
  }

  const json = (await res.json()) as {
    data?: { app: { id: string; name: string } | null }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    return {
      ok: false,
      status: 401,
      message: json.errors.map((e) => e.message).join(", "),
    }
  }
  if (!json.data?.app) {
    return {
      ok: false,
      status: 401,
      message: "Token does not resolve to an App",
    }
  }

  return { ok: true, appId: json.data.app.id }
}

async function lookupOwnAuth(saleorApiUrl: string): Promise<AuthData | undefined> {
  try {
    return await saleorApp.apl.get(saleorApiUrl)
  } catch (err) {
    console.error("[caller-auth] APL lookup failed:", err)
    return undefined
  }
}

export async function authorizeCaller(
  creds: CallerCredentials,
): Promise<CallerAuthorization> {
  const ownAuth = await lookupOwnAuth(creds.saleorApiUrl)
  if (!ownAuth) {
    return {
      ok: false,
      status: 401,
      message: "Agentic Commerce App is not installed for this saleor-api-url",
    }
  }

  const validation = await validateCallerToken({
    token: creds.token,
    saleorApiUrl: ownAuth.saleorApiUrl,
  })
  if (!validation.ok) return validation

  return { ok: true, appId: validation.appId, ownAuth }
}
