"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

// Paths where the global footer must not render. The /play shell uses a
// full-viewport (min-h-screen, centered) layout — appending a footer beneath
// it would push total document height past one viewport and create a
// scroll jump the game screen shouldn't have.
const HIDDEN_ON: readonly string[] = ["/play"]

export function FooterGate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  if (pathname && HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null
  }
  return <>{children}</>
}
