"use client"

import { AnimatePresence, motion } from "framer-motion"

interface PaymentModalProps {
  open: boolean
  title: string
  description: string
  priceUsd: string
  balanceLabel: string
  isProcessing?: boolean
  successMessage?: string | null
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function PaymentModal({
  open,
  title,
  description,
  priceUsd,
  balanceLabel,
  isProcessing = false,
  successMessage,
  error,
  onConfirm,
  onCancel,
}: PaymentModalProps) {
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
              <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-amber-200">
                x402
              </span>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Price</span>
                <span className="font-semibold text-gray-100">{priceUsd} USDC</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-gray-500">Your balance</span>
                <span className="text-gray-100">{balanceLabel}</span>
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

            {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

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
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
