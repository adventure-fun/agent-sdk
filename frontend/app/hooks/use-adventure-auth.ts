"use client"

import { useState, useCallback } from "react"
import { useEvmAddress, useSignEvmMessage } from "@coinbase/cdp-hooks"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

interface Account {
  id: string
  wallet_address: string
  player_type: "human" | "agent"
  handle?: string
  free_realm_used: boolean
}

interface AuthState {
  token: string | null
  account: Account | null
}

export function useAdventureAuth() {
  const { evmAddress } = useEvmAddress()
  const { signEvmMessage } = useSignEvmMessage()
  const [auth, setAuth] = useState<AuthState>(() => {
    if (typeof window === "undefined") return { token: null, account: null }
    const stored = localStorage.getItem("adventure_auth")
    return stored ? JSON.parse(stored) : { token: null, account: null }
  })
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(async () => {
    if (!evmAddress) {
      setError("Wallet not ready. Please sign in first.")
      return
    }

    setIsConnecting(true)
    setError(null)

    try {
      // 1. Get challenge nonce from backend
      const challengeRes = await fetch(
        `${API_URL}/auth/challenge?wallet=${evmAddress}`
      )
      if (!challengeRes.ok) throw new Error("Failed to get challenge")
      const { nonce } = await challengeRes.json()

      // 2. Sign the nonce with the embedded wallet
      const { signature } = await signEvmMessage({
        evmAccount: evmAddress,
        message: nonce,
      })

      // 3. Send proof to backend
      const connectRes = await fetch(`${API_URL}/auth/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: evmAddress,
          signature,
          nonce,
          player_type: "human",
        }),
      })

      if (!connectRes.ok) {
        const body = await connectRes.json()
        throw new Error(body.error ?? "Failed to connect")
      }

      const { token, account } = await connectRes.json()
      const authState = { token, account }
      setAuth(authState)
      localStorage.setItem("adventure_auth", JSON.stringify(authState))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setIsConnecting(false)
    }
  }, [evmAddress, signEvmMessage])

  const logout = useCallback(() => {
    setAuth({ token: null, account: null })
    localStorage.removeItem("adventure_auth")
  }, [])

  return {
    evmAddress,
    token: auth.token,
    account: auth.account,
    isAuthenticated: !!auth.token,
    isConnecting,
    error,
    connect,
    logout,
  }
}
