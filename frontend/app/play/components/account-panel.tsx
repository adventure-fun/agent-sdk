"use client"

import { useState } from "react"

export function AccountPanel({
  walletAddress,
  handle,
  balanceLabel,
  isTestnet,
  onLogout,
}: {
  walletAddress: string | null | undefined
  handle: string | undefined
  balanceLabel: string
  isTestnet: boolean
  onLogout: () => void
}) {
  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : "Wallet unavailable"
  const [copied, setCopied] = useState(false)

  return (
    <div className="rounded border border-gray-800 bg-gray-900/80 p-3 text-left text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-amber-400">{handle || "Adventurer"}</span>
            {isTestnet ? (
              <span className="rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-300">
                Testnet
              </span>
            ) : null}
          </div>
          <div className="text-gray-400">
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
                className="cursor-pointer text-gray-400 underline decoration-dotted underline-offset-2 hover:text-amber-300"
                title="Click to copy full address"
              >
                {copied ? "Copied!" : shortWallet}
              </button>
            ) : (
              shortWallet
            )}
          </div>
          <div className="text-gray-400">USDC: {balanceLabel}</div>
        </div>
        <div className="flex items-center gap-2">
          {walletAddress ? (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(walletAddress).catch(() => {})}
              className="rounded border border-gray-700 px-2 py-1 text-gray-300 transition-colors hover:border-gray-500"
            >
              Copy Address
            </button>
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            className="rounded border border-gray-700 px-2 py-1 text-gray-300 transition-colors hover:border-gray-500"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}
