"use client"

import { useIsSignedIn, useIsInitialized } from "@coinbase/cdp-hooks"
import { AuthButton } from "@coinbase/cdp-react/components/AuthButton"
import { useAdventureAuth } from "../hooks/use-adventure-auth"
import { useEffect } from "react"

export default function PlayPage() {
  console.log("[PLAY] page rendered")
  const { isInitialized } = useIsInitialized()
  const { isSignedIn } = useIsSignedIn()
  console.log("[PLAY] isInitialized:", isInitialized, "isSignedIn:", isSignedIn)
  const {
    evmAddress,
    isAuthenticated,
    isConnecting,
    error,
    account,
    connect,
    logout,
  } = useAdventureAuth()

  // Auto-connect to backend once CDP sign-in gives us a wallet
  useEffect(() => {
    console.log("[PLAY] useEffect fired — isSignedIn:", isSignedIn, "evmAddress:", evmAddress, "isAuthenticated:", isAuthenticated, "isConnecting:", isConnecting)
    if (isSignedIn && evmAddress && !isAuthenticated && !isConnecting) {
      connect()
    }
  }, [isSignedIn, evmAddress, isAuthenticated, isConnecting, connect])

  // SDK still loading
  if (!isInitialized) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
          <p className="text-gray-400">Loading CDP SDK...</p>
          <p className="text-xs text-gray-600">
            Project: {process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? "NOT SET"}
          </p>
        </div>
      </main>
    )
  }

  // Step 1: Not signed in to CDP — show sign-in options
  if (!isSignedIn) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
          <p className="text-gray-400">Sign in to play</p>
          <div className="flex justify-center">
            <AuthButton />
          </div>
          <p className="text-xs text-gray-600">
            Creates a wallet automatically. No extension needed.
          </p>
        </div>
      </main>
    )
  }

  // Step 2: Signed in to CDP, connecting to backend
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
          {isConnecting ? (
            <p className="text-gray-400">Connecting to adventure server...</p>
          ) : error ? (
            <div className="space-y-4">
              <p className="text-red-400">{error}</p>
              <button
                onClick={connect}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
              >
                Retry
              </button>
            </div>
          ) : (
            <p className="text-gray-400">Preparing wallet...</p>
          )}
        </div>
      </main>
    )
  }

  // Step 3: Fully authenticated — ready for character/realm flow
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
        <div className="text-left space-y-2 bg-gray-900 border border-gray-800 rounded p-4 text-sm">
          <p>
            <span className="text-gray-500">Wallet:</span>{" "}
            <span className="text-gray-300">
              {evmAddress?.slice(0, 6)}...{evmAddress?.slice(-4)}
            </span>
          </p>
          <p>
            <span className="text-gray-500">Account:</span>{" "}
            <span className="text-gray-300">{account?.id.slice(0, 8)}...</span>
          </p>
          <p>
            <span className="text-gray-500">Type:</span>{" "}
            <span className="text-gray-300">{account?.player_type}</span>
          </p>
        </div>

        {/* TODO: Character creation / realm selection / game entry */}
        <p className="text-gray-500 text-sm">
          Character creation coming next...
        </p>

        <button
          onClick={logout}
          className="text-sm text-gray-600 hover:text-gray-400 transition-colors"
        >
          Disconnect
        </button>
      </div>
    </main>
  )
}
