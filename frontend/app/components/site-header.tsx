"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useAdventureAuth } from "../hooks/use-adventure-auth"
import { useUsdcBalance } from "../hooks/use-usdc-balance"

const NAV_LINKS = [
  { href: "/play", label: "Play" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/spectate", label: "Spectate" },
] as const

export function SiteHeader() {
  const pathname = usePathname()
  const { account, evmAddress, isAuthenticated, logout } = useAdventureAuth()
  const { balanceLabel, isTestnet } = useUsdcBalance()
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  useEffect(() => { setOpen(false) }, [pathname])

  const shortWallet = evmAddress
    ? `${evmAddress.slice(0, 6)}…${evmAddress.slice(-4)}`
    : null

  return (
    <header className="border-b border-white/5 bg-aw-surface-lowest/95 backdrop-blur-sm sticky top-0 z-50 aw-label">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">

        {/* Brand */}
        <Link
          href="/"
          className="aw-headline text-lg font-bold tracking-widest text-aw-primary aw-amber-glow hover:opacity-90 transition-opacity"
        >
          ADVENTURE.FUN
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link
                key={href}
                href={href}
                className={`px-4 py-1.5 text-xs tracking-widest uppercase transition-colors ${
                  isActive
                    ? "text-aw-secondary border-b-2 border-aw-secondary"
                    : "text-aw-outline hover:text-aw-on-surface"
                }`}
              >
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Account */}
        {isAuthenticated && shortWallet ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-2 border border-white/10 px-3 py-1.5 text-xs text-aw-on-surface-variant hover:border-aw-secondary/30 hover:text-aw-on-surface transition-colors"
            >
              <span className="font-semibold text-aw-primary">{account?.handle || shortWallet}</span>
              <svg
                className={`h-3 w-3 text-aw-outline transition-transform ${open ? "rotate-180" : ""}`}
                viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <path d="M3 5l3 3 3-3" />
              </svg>
            </button>

            {open ? (
              <div className="absolute right-0 top-full mt-2 w-64 border border-white/10 bg-aw-surface-lowest shadow-xl shadow-black/60 p-4 space-y-3 text-xs z-50">
                {account?.handle ? (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-aw-primary">{account.handle}</span>
                    {isTestnet ? (
                      <span className="border border-aw-primary/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-aw-primary">
                        Testnet
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-aw-outline">Wallet</div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!evmAddress) return
                      navigator.clipboard.writeText(evmAddress).then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      }).catch(() => {})
                    }}
                    className="text-aw-on-surface-variant hover:text-aw-secondary transition-colors cursor-pointer"
                    title="Copy wallet address"
                  >
                    {copied ? "Copied!" : shortWallet}
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-aw-outline">Balance</div>
                  <div className="text-aw-on-surface">{balanceLabel}</div>
                </div>

                <div className="border-t border-white/5 pt-3">
                  <button
                    type="button"
                    onClick={() => { logout(); setOpen(false) }}
                    className="w-full border border-white/10 px-3 py-1.5 text-aw-outline hover:border-white/20 hover:text-aw-on-surface transition-colors uppercase tracking-widest text-[10px]"
                  >
                    Logout
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="w-[100px]" />
        )}
      </div>
    </header>
  )
}
