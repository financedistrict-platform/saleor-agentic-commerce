"use client"

import { useCallback } from "react"
import { useAppBridge } from "@saleor/app-sdk/app-bridge"
import {
  SALEOR_API_URL_HEADER,
  SALEOR_AUTHORIZATION_BEARER_HEADER,
} from "@saleor/app-sdk/headers"

type DashboardRequestInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>
}

export function useDashboardFetch() {
  const { appBridgeState } = useAppBridge()
  const saleorApiUrl = appBridgeState?.saleorApiUrl ?? ""
  const token = appBridgeState?.token ?? ""

  return useCallback(
    (path: string, init: DashboardRequestInit = {}) =>
      fetch(path, {
        ...init,
        headers: {
          ...init.headers,
          [SALEOR_API_URL_HEADER]: saleorApiUrl,
          [SALEOR_AUTHORIZATION_BEARER_HEADER]: token,
        },
      }),
    [saleorApiUrl, token]
  )
}
