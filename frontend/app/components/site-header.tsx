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

  // Close popout on outside click
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

  // Close on route change
  useEffect(() => { setOpen(false) }, [pathname])

  const shortWallet = evmAddress
    ? `${evmAddress.slice(0, 6)}…${evmAddress.slice(-4)}`
    : null

  return (
    <header className="border-b border-gray-800/60 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2">
        {/* Brand */}
        <Link href="/" className="font-display text-lg font-bold tracking-tight text-amber-300 hover:text-amber-200 transition-colors">
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
                className={`rounded px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-amber-500/10 text-amber-300 font-semibold"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Account popout */}
        {isAuthenticated && shortWallet ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-2 rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100"
            >
              <span className="font-semibold text-amber-400">{account?.handle || shortWallet}</span>
              <svg className={`h-3 w-3 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5l3 3 3-3" /></svg>
            </button>

            {open ? (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-gray-700 bg-gray-900 p-4 shadow-xl shadow-black/40 space-y-3 text-xs">
                {/* Handle */}
                {account?.handle ? (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-amber-400">{account.handle}</span>
                    {isTestnet ? (
                      <span className="rounded border border-amber-700/60 bg-amber-950/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                        Testnet
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* Wallet */}
                <div className="space-y-1">
                  <div className="text-gray-500 text-[10px] uppercase tracking-wide">Wallet</div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!evmAddress) return
                      navigator.clipboard.writeText(evmAddress).then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      }).catch(() => {})
                    }}
                    className="text-gray-300 hover:text-amber-300 transition-colors cursor-pointer"
                    title="Copy wallet address"
                  >
                    {copied ? "Copied!" : shortWallet}
                  </button>
                </div>

                {/* Balance */}
                <div className="space-y-1">
                  <div className="text-gray-500 text-[10px] uppercase tracking-wide">Balance</div>
                  <div className="text-gray-200">{balanceLabel}</div>
                </div>

                {/* Logout */}
                <div className="border-t border-gray-800 pt-3">
                  <button
                    type="button"
                    onClick={() => { logout(); setOpen(false) }}
                    className="w-full rounded border border-gray-700 px-3 py-1.5 text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200"
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
