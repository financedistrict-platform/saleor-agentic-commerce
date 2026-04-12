"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Root page — redirects to the configuration page.
 *
 * The App's main entry point when loaded in the Dashboard iframe.
 */
export default function Home() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/configuration")
  }, [router])

  return null
}
