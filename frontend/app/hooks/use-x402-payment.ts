"use client"

import { useCallback } from "react"
import { useX402 } from "@coinbase/cdp-hooks"
import { useAdventureAuth } from "./use-adventure-auth"

export function useX402Payment() {
  const { token } = useAdventureAuth()
  const { fetchWithPayment } = useX402({
    maxValue: BigInt(Number.MAX_SAFE_INTEGER),
  })

  const paidFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      // Use a plain object — x402-fetch spreads headers with {...init.headers}
      // which doesn't work with Headers instances
      const headers: Record<string, string> = {}
      if (init.headers) {
        new Headers(init.headers).forEach((v, k) => { headers[k] = v })
      }
      if (token && !headers["authorization"]) {
        headers["Authorization"] = `Bearer ${token}`
      }
      if (init.body && !headers["content-type"]) {
        headers["Content-Type"] = "application/json"
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
