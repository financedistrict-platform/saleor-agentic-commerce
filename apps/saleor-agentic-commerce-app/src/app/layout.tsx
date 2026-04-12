import type { Metadata } from "next"
import { AppProvider } from "@/components/AppProvider"

export const metadata: Metadata = {
  title: "Agentic Commerce — Saleor App",
  description: "Make your store shoppable by AI agents",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  )
}
