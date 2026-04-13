"use client"

import { createContext, useContext, useState, useCallback, useEffect } from "react"
import { useEvmAddress, useSignEvmMessage } from "@coinbase/cdp-hooks"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

interface Account {
  id: string
  wallet_address: string
  player_type: "human" | "agent"
  handle?: string | null
  x_handle?: string | null
  github_handle?: string | null
  free_realm_used: boolean
}

interface AuthState {
  token: string | null
  account: Account | null
}

interface AdventureAuthContextValue {
  evmAddress: `0x${string}` | string | null | undefined
  token: string | null
  account: Account | null
  isAuthenticated: boolean
  isConnecting: boolean
  error: string | null
  connect: () => Promise<void>
  logout: () => void
}

export const AdventureAuthContext = createContext<AdventureAuthContextValue | null>(null)

export function useAdventureAuthProvider() {
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

  // Refresh the cached account row from the server. Called on mount
  // whenever we have a token, so changes that happened server-side since
  // the last login (anon-handle backfill, a handle update from another
  // device, a free_realm_used flip from a payment) are picked up without
  // forcing the user to re-sign the wallet challenge.
  //
  // We re-use the existing token — /auth/me is `requireAuth` gated. If
  // the token has expired server-side we get a 401 back and we clear
  // the cache so the app falls back to the normal connect flow.
  useEffect(() => {
    if (!auth.token) return
    let cancelled = false
    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then(async (res) => {
        if (res.status === 401) {
          if (cancelled) return
          setAuth({ token: null, account: null })
          localStorage.removeItem("adventure_auth")
          return null
        }
        if (!res.ok) return null
        return res.json() as Promise<Account>
      })
      .then((fresh) => {
        if (cancelled || !fresh) return
        setAuth((prev) => {
          const next = { token: prev.token, account: fresh }
          localStorage.setItem("adventure_auth", JSON.stringify(next))
          return next
        })
      })
      .catch(() => {
        // Network error — keep the stale cached state, don't log out.
      })
    return () => { cancelled = true }
    // Intentionally depend only on the token. We don't want this effect
    // re-running every time the account object changes (it would loop
    // since we setAuth inside it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token])

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

export function useAdventureAuth(): AdventureAuthContextValue {
  const ctx = useContext(AdventureAuthContext)
  if (!ctx) {
    throw new Error("useAdventureAuth must be used within an AdventureAuthProvider")
  }
  return ctx
}
