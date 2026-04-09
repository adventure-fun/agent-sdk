"use client"

import { useState, useCallback } from "react"
import { useAdventureAuth } from "./use-adventure-auth"
import { useX402Payment } from "./use-x402-payment"
import type { RealmInstance } from "@adventure-fun/schemas"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

export function useRealm() {
  const { token } = useAdventureAuth()
  const { fetchWithPayment } = useX402Payment()
  const [realms, setRealms] = useState<RealmInstance[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRealms = useCallback(async () => {
    if (!token) return []
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/realms/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setError("Failed to fetch realms")
        return []
      }
      const data = await res.json()
      const list = (data.realms ?? []) as RealmInstance[]
      setRealms(list)
      return list
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch realms")
      return []
    } finally {
      setIsLoading(false)
    }
  }, [token])

  const generateRealm = useCallback(
    async (templateId: string): Promise<{ realm?: RealmInstance; paymentRequired?: boolean; error?: string }> => {
      if (!token) return { error: "Not authenticated" }
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetchWithPayment(`${API_URL}/realms/generate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ template_id: templateId }),
        })

        if (res.status === 201) {
          const realm = (await res.json()) as RealmInstance
          setRealms((prev) => [realm, ...prev])
          return { realm }
        }

        if (res.status === 402) {
          return { paymentRequired: true }
        }

        if (res.status === 409) {
          const data = await res.json()
          return { error: "Realm already exists", realm: data.realm }
        }

        const data = await res.json()
        const msg = data.error ?? "Failed to generate realm"
        setError(msg)
        return { error: msg }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to generate realm"
        setError(msg)
        return { error: msg }
      } finally {
        setIsLoading(false)
      }
    },
    [token],
  )

  const regenerateRealm = useCallback(
    async (realmId: string): Promise<{ realm?: RealmInstance; paymentRequired?: boolean; error?: string }> => {
      if (!token) return { error: "Not authenticated" }
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetchWithPayment(`${API_URL}/realms/${realmId}/regenerate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (res.ok) {
          const realm = (await res.json()) as RealmInstance
          setRealms((prev) =>
            prev.map((entry) => (entry.id === realm.id ? realm : entry)),
          )
          return { realm }
        }

        if (res.status === 402) {
          return { paymentRequired: true }
        }

        const data = await res.json()
        const msg = data.error ?? "Failed to regenerate realm"
        setError(msg)
        return { error: msg }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to regenerate realm"
        setError(msg)
        return { error: msg }
      } finally {
        setIsLoading(false)
      }
    },
    [fetchWithPayment, token],
  )

  return { realms, isLoading, error, fetchRealms, generateRealm, regenerateRealm }
}
