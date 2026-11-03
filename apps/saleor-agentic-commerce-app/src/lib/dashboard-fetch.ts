"use client"

import { useCallback, useLayoutEffect, useRef } from "react"
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
  const credentials = useRef({ saleorApiUrl: "", token: "" })
  // Layout effects run before every passive effect, so callers' effects
  // always send the current credentials.
  useLayoutEffect(() => {
    credentials.current = { saleorApiUrl, token }
  }, [saleorApiUrl, token])

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
