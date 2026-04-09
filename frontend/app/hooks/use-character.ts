"use client"

import { useState, useCallback } from "react"
import { useAdventureAuth } from "./use-adventure-auth"
import { useX402Payment } from "./use-x402-payment"
import type { Character, CharacterClass } from "@adventure-fun/schemas"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

interface RerollError {
  error: string
  action?: string
  price_usd?: string
}

export function useCharacter() {
  const { token } = useAdventureAuth()
  const { fetchWithPayment } = useX402Payment()
  const [character, setCharacter] = useState<Character | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const headers = useCallback(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" }
    if (token) h["Authorization"] = `Bearer ${token}`
    return h
  }, [token])

  /** Fetch the current living character. Returns the character or null if none. */
  const fetchCharacter = useCallback(async (): Promise<Character | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/characters/me`, { headers: headers() })
      if (res.status === 404) {
        setCharacter(null)
        return null
      }
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? "Failed to fetch character")
      }
      const data: Character = await res.json()
      setCharacter(data)
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch character"
      setError(msg)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [headers])

  /** Create a new character with the given name and class. Rolls stats server-side. */
  const rollCharacter = useCallback(async (name: string, cls: CharacterClass): Promise<Character | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/characters/roll`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name, class: cls }),
      })
      if (res.status === 409) {
        const body = await res.json()
        throw new Error(body.error ?? "Character already exists")
      }
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? "Failed to create character")
      }
      const data: Character = await res.json()
      setCharacter(data)
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create character"
      setError(msg)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [headers])

  /** Attempt to re-roll stats. Returns the updated character, or an error message for 402/409. */
  const rerollStats = useCallback(async (): Promise<{ character: Character | null; paymentRequired: boolean; message: string | null }> => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetchWithPayment(`${API_URL}/characters/reroll-stats`, {
        method: "POST",
        headers: headers(),
      })
      if (res.status === 402) {
        const body: RerollError = await res.json()
        const msg = `${body.error}${body.price_usd ? ` ($${body.price_usd})` : ""}`
        return { character: null, paymentRequired: true, message: msg }
      }
      if (res.status === 409) {
        const body = await res.json()
        return { character: null, paymentRequired: false, message: body.error ?? "Already rerolled" }
      }
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? "Failed to reroll stats")
      }
      const data: Character = await res.json()
      setCharacter(data)
      return { character: data, paymentRequired: false, message: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reroll stats"
      setError(msg)
      return { character: null, paymentRequired: false, message: msg }
    } finally {
      setIsLoading(false)
    }
  }, [headers])

  return {
    character,
    isLoading,
    error,
    fetchCharacter,
    rollCharacter,
    rerollStats,
  }
}
