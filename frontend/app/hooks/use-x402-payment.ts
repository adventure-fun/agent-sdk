"use client"

import { useCallback } from "react"
import { useX402 } from "@coinbase/cdp-hooks"
import { useAdventureAuth } from "./use-adventure-auth"

export function useX402Payment() {
  const { token } = useAdventureAuth()
  const { fetchWithPayment } = useX402({
    maxValue: BigInt(Number.MAX_SAFE_INTEGER),
  })

  const buildHeaders = (init: RequestInit): Record<string, string> => {
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
    return headers
  }

  const paidFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      return fetchWithPayment(input as RequestInfo, {
        ...init,
        headers: buildHeaders(init),
      })
    },
    [fetchWithPayment, token],
  )

  // Plain authed fetch — same auth/content-type behavior, no x402 wrapper.
  // Use this for actions that are priced at 0 so the CDP x402 client doesn't
  // spawn unhandled rejections on responses that never return 402.
  const unpaidFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      return fetch(input as RequestInfo, {
        ...init,
        headers: buildHeaders(init),
      })
    },
    [token],
  )

  return { fetchWithPayment: paidFetch, fetchUnpaid: unpaidFetch }
}
