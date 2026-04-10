"use client"

import { CDPReactProvider } from "@coinbase/cdp-react"
import { AdventureAuthContext, useAdventureAuthProvider } from "./hooks/use-adventure-auth"

const cdpProjectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? ""

function AdventureAuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAdventureAuthProvider()
  return (
    <AdventureAuthContext.Provider value={auth}>
      {children}
    </AdventureAuthContext.Provider>
  )
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CDPReactProvider
      config={{
        projectId: cdpProjectId,
        ethereum: { createOnLogin: "eoa" },
        appName: "Adventure.fun",
      }}
    >
      <AdventureAuthProvider>{children}</AdventureAuthProvider>
    </CDPReactProvider>
  )
}
