"use client"

import { ReactNode } from "react"
import { AppBridgeProvider } from "@saleor/app-sdk/app-bridge"
import { ThemeProvider } from "@saleor/macaw-ui"

/**
 * AppProvider wraps the App in the Saleor Dashboard context.
 *
 * - AppBridgeProvider: Establishes communication with the Dashboard iframe host.
 *   Provides locale, theme, token, and permissions from the Dashboard.
 * - ThemeProvider: Applies the Saleor macaw-ui design system tokens
 *   so UI components match the Dashboard look and feel.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <AppBridgeProvider>
      <ThemeProvider>
        <div
          style={{
            padding: "24px",
            maxWidth: "960px",
            margin: "0 auto",
          }}
        >
          {children}
        </div>
      </ThemeProvider>
    </AppBridgeProvider>
  )
}
