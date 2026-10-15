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

type DashboardPermission = "MANAGE_APPS" | "MANAGE_ORDERS"

const DASHBOARD_REQUIRED_PERMISSIONS: DashboardPermission[] = ["MANAGE_APPS"]

export async function getAuthContext(
  request: NextRequest
): Promise<AuthContext | null> {
  return verifyDashboardRequest(request, DASHBOARD_REQUIRED_PERMISSIONS)
}

export async function hasDashboardPermission(
  request: NextRequest,
  permission: DashboardPermission
): Promise<boolean> {
  return (await verifyDashboardRequest(request, [permission])) !== null
}

async function verifyDashboardRequest(
  request: NextRequest,
  requiredPermissions: DashboardPermission[]
): Promise<AuthContext | null> {
  const saleorApiUrl = request.headers.get(SALEOR_API_URL_HEADER)
  const dashboardToken = request.headers.get(SALEOR_AUTHORIZATION_BEARER_HEADER)

  if (!saleorApiUrl || !dashboardToken) {
    return null
  }

  try {
    const authData = await saleorApp.apl.get(saleorApiUrl)

    if (!authData) {
      return null
    }

    await verifyJWT({
      token: dashboardToken,
      appId: authData.appId,
      saleorApiUrl: authData.saleorApiUrl,
      requiredPermissions,
    })

    return {
      saleorApiUrl: authData.saleorApiUrl,
      token: authData.token,
    }
  } catch {
    return null
  }
}
