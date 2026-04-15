"use client"

import { useState } from "react"
import { CHAIN_FULL, CHAIN_NAME, IS_TESTNET } from "../../lib/chain"

export function AccountPanel({
  walletAddress,
  handle,
  balanceLabel,
  onLogout,
}: {
  walletAddress: string | null | undefined
  handle: string | undefined
  balanceLabel: string
  onLogout: () => void
}) {
  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : "Wallet unavailable"
  const [copied, setCopied] = useState(false)

  return (
    <div className="rounded border border-ob-outline-variant/15 bg-ob-surface-container-low/80 p-3 text-left text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ob-primary">{handle || "Adventurer"}</span>
            {IS_TESTNET ? (
              <span className="rounded border border-ob-primary/30 bg-ob-primary/10 px-2 py-1 text-[10px] uppercase tracking-wide text-ob-primary">
                {CHAIN_FULL}
              </span>
            ) : null}
          </div>
          <div className="text-ob-on-surface-variant">
            Wallet:{" "}
            {walletAddress ? (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(walletAddress).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }).catch(() => {})
                }}
                className="cursor-pointer text-ob-on-surface-variant underline decoration-dotted underline-offset-2 hover:text-ob-primary"
                title="Click to copy full address"
              >
                {copied ? "Copied!" : shortWallet}
              </button>
            ) : (
              shortWallet
            )}
          </div>
          <div>
            <div className="text-ob-on-surface-variant">USDC: {balanceLabel}</div>
            <div className="ob-label text-[9px] uppercase tracking-[0.2em] text-ob-outline">
              on {CHAIN_NAME}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {walletAddress ? (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(walletAddress).catch(() => {})}
              className="rounded border border-ob-outline-variant/30 px-2 py-1 text-ob-on-surface transition-colors hover:border-ob-primary/40"
            >
              Copy Address
            </button>
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            className="rounded border border-ob-outline-variant/30 px-2 py-1 text-ob-on-surface transition-colors hover:border-ob-primary/40"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}
