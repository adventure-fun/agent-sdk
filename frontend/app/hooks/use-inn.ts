"use client"

import { useCallback, useState } from "react"
import { useX402Payment } from "./use-x402-payment"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

interface InnRestResponse {
  hp_current: number
  hp_max: number
  resource_current: number
  resource_max: number
  message: string
}

export function useInn() {
  const { fetchWithPayment, fetchUnpaid } = useX402Payment()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const restAtInn = useCallback(async (opts?: { skipPayment?: boolean }) => {
    setIsLoading(true)
    setError(null)
    try {
      const doFetch = opts?.skipPayment ? fetchUnpaid : fetchWithPayment
      const response = await doFetch(`${API_URL}/lobby/inn/rest`, {
        method: "POST",
      })
      const body = await response.json()
      if (!response.ok) {
        const message = body.error ?? "Failed to rest at the inn"
        setError(message)
        return { ok: false as const, error: message }
      }
      return { ok: true as const, data: body as InnRestResponse }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rest at the inn"
      setError(message)
      return { ok: false as const, error: message }
    } finally {
      setIsLoading(false)
    }
  }, [fetchWithPayment, fetchUnpaid])

  return {
    isLoading,
    error,
    restAtInn,
  }
}
