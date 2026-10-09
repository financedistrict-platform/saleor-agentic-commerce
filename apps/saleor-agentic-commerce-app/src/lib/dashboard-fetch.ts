"use client"

import { useCallback, useRef } from "react"
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
  const credentials = useRef({ saleorApiUrl: "", token: "" })
  credentials.current = {
    saleorApiUrl: appBridgeState?.saleorApiUrl ?? "",
    token: appBridgeState?.token ?? "",
  }

  return useCallback(
    (path: string, init: DashboardRequestInit = {}) =>
      fetch(path, {
        ...init,
        headers: {
          ...init.headers,
          [SALEOR_API_URL_HEADER]: credentials.current.saleorApiUrl,
          [SALEOR_AUTHORIZATION_BEARER_HEADER]: credentials.current.token,
        },
      }),
    []
  )
}
