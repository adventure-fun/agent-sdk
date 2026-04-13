"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useAdventureAuth } from "../hooks/use-adventure-auth"
import { useUsdcBalance } from "../hooks/use-usdc-balance"

const NAV_LINKS = [
  { href: "/play",        label: "PLAY" },
  { href: "/leaderboard", label: "LEADERBOARD" },
  { href: "/spectate",    label: "SPECTATE" },
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
    <header className="sticky top-0 z-50 flex h-20 w-full items-center justify-between px-8 bg-ob-bg/80 backdrop-blur-xl shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
      {/* ── Brand + nav ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-12">
        <Link
          href="/"
          className="ob-headline text-2xl text-ob-primary tracking-tighter hover:opacity-90 transition-opacity"
        >
          ADVENTURE.FUN
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link
                key={href}
                href={href}
                className={`ob-label text-sm uppercase transition-colors ${
                  isActive
                    ? "text-ob-primary border-b-2 border-ob-primary pb-1"
                    : "text-ob-on-surface-variant hover:text-ob-primary"
                }`}
              >
                {label}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* ── Wallet pill + account menu ──────────────────────────────────────── */}
      <div className="flex items-center gap-6">
        {isAuthenticated && shortWallet ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="hidden lg:flex items-center gap-3 px-4 py-2 bg-ob-surface-container rounded-xl border border-ob-outline-variant/15 hover:border-ob-primary/40 transition-colors"
            >
              <span className="material-symbols-outlined text-ob-primary text-sm">
                account_balance_wallet
              </span>
              <span className="ob-label text-xs tracking-tight text-ob-on-surface">
                {account?.handle || shortWallet}
              </span>
              <svg
                className={`h-3 w-3 text-ob-outline transition-transform ${open ? "rotate-180" : ""}`}
                viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <path d="M3 5l3 3 3-3" />
              </svg>
            </button>

            {/* Compact wallet button for narrow viewports */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="lg:hidden flex items-center gap-2 px-3 py-2 bg-ob-surface-container rounded-xl border border-ob-outline-variant/15 hover:border-ob-primary/40 transition-colors"
            >
              <span className="material-symbols-outlined text-ob-primary text-sm">
                account_balance_wallet
              </span>
            </button>

            {open ? (
              <div className="absolute right-0 top-full mt-2 w-64 bg-ob-surface-container border border-ob-outline-variant/15 shadow-xl shadow-black/60 rounded-xl p-4 space-y-3 z-50">
                {account?.handle ? (
                  <div className="flex items-center gap-2">
                    <span className="ob-headline text-base text-ob-primary not-italic font-bold">
                      {account.handle}
                    </span>
                    {isTestnet ? (
                      <span className="border border-ob-primary/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-ob-primary rounded">
                        Testnet
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-1">
                  <div className="ob-label text-[10px] uppercase tracking-[0.2em] text-ob-outline">
                    Wallet
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!evmAddress) return
                      navigator.clipboard.writeText(evmAddress).then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      }).catch(() => {})
                    }}
                    className="text-xs text-ob-on-surface-variant hover:text-ob-primary transition-colors"
                    title="Copy wallet address"
                  >
                    {copied ? "Copied!" : shortWallet}
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="ob-label text-[10px] uppercase tracking-[0.2em] text-ob-outline">
                    Balance
                  </div>
                  <div className="text-xs text-ob-on-surface">{balanceLabel}</div>
                </div>

                <div className="border-t border-ob-outline-variant/15 pt-3">
                  <button
                    type="button"
                    onClick={() => { logout(); setOpen(false) }}
                    className="w-full ob-label uppercase tracking-widest text-[10px] text-ob-on-surface-variant border border-ob-outline-variant/30 hover:border-ob-primary/40 hover:text-ob-primary py-2 rounded-lg transition-colors"
                  >
                    Logout
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="hidden lg:block w-[140px]" />
        )}
      </div>
    </header>
  )
}
