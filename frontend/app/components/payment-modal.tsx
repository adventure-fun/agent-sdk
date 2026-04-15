"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useState } from "react"
import { CHAIN_NAME, USDC_CHAIN_LABEL } from "../lib/chain"
import { GetUsdcModal } from "./get-usdc-modal"
import { InfoTooltip } from "./info-tooltip"

interface PaymentModalProps {
  open: boolean
  title: string
  description: string
  priceUsd: string
  balanceLabel: string
  /** The wallet address for the GetUsdcModal — surfaced via the tooltip link
   *  and the insufficient-balance CTA so a user stuck on the wrong chain has
   *  a path forward without leaving the payment flow. */
  walletAddress: string | null | undefined
  isProcessing?: boolean
  successMessage?: string | null
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

function isInsufficientBalanceError(error: string | null | undefined): boolean {
  if (!error) return false
  return /not enough|insufficient/i.test(error)
}

export function PaymentModal({
  open,
  title,
  description,
  priceUsd,
  balanceLabel,
  walletAddress,
  isProcessing = false,
  successMessage,
  error,
  onConfirm,
  onCancel,
}: PaymentModalProps) {
  const [getUsdcOpen, setGetUsdcOpen] = useState(false)

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-full max-w-md rounded-2xl border border-amber-400/40 bg-gray-950 p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold text-amber-300">{title}</h2>
                <p className="mt-2 text-sm text-gray-300">{description}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-amber-200">
                  x402
                </span>
                <span className="rounded-full border border-ob-tertiary/30 bg-ob-tertiary/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-ob-tertiary">
                  {CHAIN_NAME}
                </span>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-gray-500">
                  Price
                  <InfoTooltip label={`USDC on ${CHAIN_NAME} only`}>
                    <div className="space-y-2">
                      <p>
                        Adventure.fun settles payments in <b>{USDC_CHAIN_LABEL}</b> via x402. USDC on Ethereum, Polygon, or any other chain <b className="text-ob-error">will not work</b>.
                      </p>
                      <button
                        type="button"
                        onClick={() => setGetUsdcOpen(true)}
                        className="ob-label inline-flex items-center gap-1 rounded border border-ob-primary/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-ob-primary transition-colors hover:bg-ob-primary/10"
                      >
                        How do I get USDC on {CHAIN_NAME}? →
                      </button>
                    </div>
                  </InfoTooltip>
                </span>
                <span className="font-semibold text-gray-100">{priceUsd} USDC</span>
              </div>
              <div className="mt-2 flex items-start justify-between">
                <span className="text-gray-500">Your balance</span>
                <div className="text-right">
                  <div className="text-gray-100">{balanceLabel}</div>
                  <div className="ob-label text-[9px] uppercase tracking-[0.2em] text-ob-outline">
                    on {CHAIN_NAME}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/80 p-3 text-sm text-gray-400">
              {isProcessing ? (
                <div className="flex items-center gap-3 text-amber-200">
                  <span className="processing-spinner h-4 w-4 rounded-full border-2 border-amber-300/30 border-t-amber-300" />
                  <div>
                    <div className="font-medium text-amber-100">Processing payment...</div>
                    <div className="text-xs text-amber-100/70">Confirming the x402 settlement and preparing the next scene.</div>
                  </div>
                </div>
              ) : successMessage ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-100">
                  {successMessage}
                </div>
              ) : (
                <div>
                  Approve the prompt in your wallet to settle the payment. The realm will resume automatically once settlement completes.
                </div>
              )}
            </div>

            {error ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-red-400">{error}</p>
                {isInsufficientBalanceError(error) ? (
                  <button
                    type="button"
                    onClick={() => setGetUsdcOpen(true)}
                    className="ob-label inline-flex items-center gap-1 rounded border border-ob-primary/50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-ob-primary transition-colors hover:bg-ob-primary/10"
                  >
                    How do I get USDC on {CHAIN_NAME}? →
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={isProcessing || !!successMessage}
                className="rounded-full border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isProcessing || !!successMessage}
                className="rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
              >
                {isProcessing ? "Processing..." : successMessage ? "Payment Settled" : "Approve Payment"}
              </button>
            </div>
          </motion.div>
          <GetUsdcModal
            open={getUsdcOpen}
            onClose={() => setGetUsdcOpen(false)}
            walletAddress={walletAddress}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
