"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useEffect, useState } from "react"
import { CHAIN_NAME, IS_TESTNET, TESTNET_FAUCET_URL } from "../lib/chain"
import { UiToast } from "./ui-toast"

// Explainer modal that opens when a user clicks "How do I get USDC on Base?"
// from the payment-modal tooltip, the insufficient-balance error, or the
// site-header account menu. Built on the same framer-motion backdrop +
// portal pattern as PaymentModal and ShareMomentModal — no new primitive.
//
// On mainnet the modal is text-only (no outbound links) with the wallet
// address + copy button as the single actionable affordance. On testnet
// we link to the Circle faucet since that's the only free path.
//
// Stacks on top of PaymentModal when triggered from the payment flow:
// z-[90] > PaymentModal's z-50 — dismissing returns the user to the still
// mounted payment modal.

interface GetUsdcModalProps {
  open: boolean
  onClose: () => void
  walletAddress: string | null | undefined
}

export function GetUsdcModal({ open, onClose, walletAddress }: GetUsdcModalProps) {
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  const handleCopy = async () => {
    if (!walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      setToast({ tone: "success", message: "Wallet address copied to your clipboard." })
    } catch {
      setToast({ tone: "error", message: "Unable to copy on this device." })
    }
  }

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            key="get-usdc-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
            aria-label={`Get USDC on ${CHAIN_NAME}`}
          >
            <motion.div
              key="get-usdc-card"
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-lg rounded-2xl border border-ob-primary/30 bg-ob-surface-container-low p-6 shadow-[0_0_80px_rgba(255,209,108,0.12)]"
            >
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-ob-outline-variant/30 text-ob-on-surface-variant transition-colors hover:border-ob-primary/50 hover:text-ob-primary"
                aria-label="Dismiss"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>

              <div className="space-y-1">
                <div className="ob-label text-[10px] uppercase tracking-[0.3em] text-ob-primary">
                  Payment Requirement
                </div>
                <h2 className="ob-headline text-2xl text-ob-primary ob-amber-glow">
                  Get USDC on {CHAIN_NAME}
                </h2>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-ob-on-surface-variant">
                Adventure.fun settles payments in <span className="font-semibold text-ob-primary">USDC on {CHAIN_NAME}</span>. USDC on Ethereum, Polygon, or any other chain <span className="font-semibold text-ob-error">will not work</span> — you need USDC specifically on {CHAIN_NAME}.
              </p>

              {/* Wallet address card — the one actionable affordance */}
              <div className="mt-5 rounded-xl border border-ob-outline-variant/20 bg-ob-surface-container-lowest p-4">
                <div className="ob-label text-[10px] uppercase tracking-[0.25em] text-ob-outline">
                  Your Adventure.fun wallet
                </div>
                {walletAddress ? (
                  <>
                    <div className="mt-2 break-all font-mono text-xs text-ob-on-surface">
                      {walletAddress}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      className="mt-3 ob-label inline-flex items-center gap-2 rounded-lg border border-ob-primary/50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-ob-primary transition-colors hover:bg-ob-primary/10"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3 w-3"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      <span>Copy address</span>
                    </button>
                    <p className="mt-3 text-[11px] italic text-ob-on-surface-variant">
                      Send USDC on {CHAIN_NAME} to this address. Nothing else.
                    </p>
                  </>
                ) : (
                  <div className="mt-2 text-xs text-ob-on-surface-variant">
                    Wallet unavailable — sign in to see your address.
                  </div>
                )}
              </div>

              {/* Options list — branches on testnet vs mainnet */}
              <div className="mt-5 space-y-3">
                <div className="ob-label text-[10px] uppercase tracking-[0.25em] text-ob-outline">
                  How to get USDC on {CHAIN_NAME}
                </div>
                {IS_TESTNET ? (
                  <div className="text-xs leading-relaxed text-ob-on-surface-variant">
                    Grab test USDC from the Circle faucet and send it to the address above.
                    <div className="mt-2">
                      <a
                        href={TESTNET_FAUCET_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ob-label inline-flex items-center gap-1.5 rounded-lg border border-ob-primary/50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-ob-primary transition-colors hover:bg-ob-primary/10"
                      >
                        <span>Circle faucet</span>
                        <span aria-hidden="true">→</span>
                      </a>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-3 text-xs leading-relaxed text-ob-on-surface-variant">
                    <li>
                      <span className="font-semibold text-ob-on-surface">Already have USDC on Coinbase?</span>{" "}
                      Withdraw directly to Base. Coinbase's withdraw flow has a network dropdown — pick <span className="font-semibold text-ob-primary">Base</span>. Send the USDC to your wallet address above.
                    </li>
                    <li>
                      <span className="font-semibold text-ob-on-surface">Already have USDC on another chain (Ethereum, Polygon, Arbitrum)?</span>{" "}
                      Bridge it to Base using any Base-compatible bridge, then send it to the wallet address above.
                    </li>
                    <li>
                      <span className="font-semibold text-ob-on-surface">Already have ETH on Base?</span>{" "}
                      Swap it for USDC on any Base DEX, then send it to the wallet address above.
                    </li>
                    <li>
                      <span className="font-semibold text-ob-on-surface">Don't have any crypto yet?</span>{" "}
                      You'll need to buy USDC from a centralized exchange first (Coinbase, Kraken, Binance, or similar). Make sure you withdraw on the <span className="font-semibold text-ob-primary">Base</span> network — not Ethereum, not any other chain.
                    </li>
                  </ul>
                )}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-ob-primary px-5 py-2 ob-label text-[11px] font-bold uppercase tracking-widest text-ob-on-primary transition-all hover:brightness-110"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <UiToast
        open={!!toast}
        tone={toast?.tone ?? "success"}
        title={toast?.tone === "error" ? "Copy Failed" : "Copied"}
        message={toast?.message ?? ""}
        onClose={() => setToast(null)}
      />
    </>
  )
}
