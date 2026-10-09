import { NextRequest } from "next/server"
import { verifyJWT } from "@saleor/app-sdk/auth"
import {
  SALEOR_API_URL_HEADER,
  SALEOR_AUTHORIZATION_BEARER_HEADER,
} from "@saleor/app-sdk/headers"
import { saleorApp } from "./saleor-app"

export type AuthContext = {
  saleorApiUrl: string
  token: string
}

const DASHBOARD_REQUIRED_PERMISSIONS = ["MANAGE_APPS" as const]

export async function getAuthContext(
  request: NextRequest
): Promise<AuthContext | null> {
  const saleorApiUrl = request.headers.get(SALEOR_API_URL_HEADER)
  const dashboardToken = request.headers.get(SALEOR_AUTHORIZATION_BEARER_HEADER)

  if (!saleorApiUrl || !dashboardToken) {
    return null
  }

  const authData = await saleorApp.apl.get(saleorApiUrl)

  if (!authData) {
    return null
  }

  try {
    await verifyJWT({
      token: dashboardToken,
      appId: authData.appId,
      saleorApiUrl: authData.saleorApiUrl,
      requiredPermissions: DASHBOARD_REQUIRED_PERMISSIONS,
    })
  } catch {
    return null
  }

  return {
    saleorApiUrl: authData.saleorApiUrl,
    token: authData.token,
  }
}
