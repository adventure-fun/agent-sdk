"use client"

import { CDPReactProvider } from "@coinbase/cdp-react"

const cdpProjectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? ""

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CDPReactProvider
      config={{
        projectId: cdpProjectId,
        ethereum: { createOnLogin: "eoa" },
        appName: "Adventure.fun",
      }}
    >
      {children}
    </CDPReactProvider>
  )
}
