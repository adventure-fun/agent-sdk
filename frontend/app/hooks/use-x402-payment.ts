"use client"

import { useCallback } from "react"
import { useX402 } from "@coinbase/cdp-hooks"
import { useAdventureAuth } from "./use-adventure-auth"

export function useX402Payment() {
  const { token } = useAdventureAuth()
  const { fetchWithPayment } = useX402()

  const paidFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`)
      }
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json")
      }

      return fetchWithPayment(input as RequestInfo, {
        ...init,
        headers,
      })
    },
    [fetchWithPayment, token],
  )

  return { fetchWithPayment: paidFetch }
}
