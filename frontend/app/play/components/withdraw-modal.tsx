"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useEffect, useMemo, useState } from "react"
import { isAddress, getAddress } from "viem"
import { CHAIN_NAME, IS_TESTNET, USDC_CHAIN_LABEL } from "../../lib/chain"
import { useX402Payment } from "../../hooks/use-x402-payment"
import { friendlyPaymentError } from "../utils"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"
const WITHDRAW_MIN_USD = 0.25
const WITHDRAW_MAX_USD = 50

const EXPLORER_BASE = IS_TESTNET
  ? "https://sepolia.basescan.org/tx/"
  : "https://basescan.org/tx/"

interface WithdrawModalProps {
  open: boolean
  onClose: () => void
  balanceLabel: string
  rawBalance: bigint | null
  onSuccess?: () => void
}

interface SuccessState {
  txHash: string
  amount: string
  destination: string
}

export function WithdrawModal({ open, onClose, balanceLabel, rawBalance, onSuccess }: WithdrawModalProps) {
  const { fetchWithPayment } = useX402Payment()
  const [amount, setAmount] = useState("")
  const [destination, setDestination] = useState("")
  const [destinationError, setDestinationError] = useState<string | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState<SuccessState | null>(null)

  // Reset state every time the modal opens so the previous result doesn't
  // bleed into a fresh withdraw attempt.
  useEffect(() => {
    if (!open) return
    setAmount("")
    setDestination("")
    setDestinationError(null)
    setAmountError(null)
    setSubmitError(null)
    setSuccess(null)
    setIsSubmitting(false)
  }, [open])

  const validatedDestination = useMemo(() => {
    const trimmed = destination.trim()
    if (!trimmed) return null
    if (!isAddress(trimmed)) return null
    return getAddress(trimmed)
  }, [destination])

  const validatedAmount = useMemo(() => {
    const trimmed = amount.trim()
    if (!trimmed) return null
    const n = Number.parseFloat(trimmed)
    if (!Number.isFinite(n) || n <= 0) return null
    if (n < WITHDRAW_MIN_USD) return null
    if (n > WITHDRAW_MAX_USD) return null
    return trimmed
  }, [amount])

  const balanceSufficient = useMemo(() => {
    if (rawBalance === null) return true
    if (validatedAmount === null) return true
    const needed = BigInt(Math.round(Number.parseFloat(validatedAmount) * 1_000_000))
    return rawBalance >= needed
  }, [rawBalance, validatedAmount])

  const canSubmit =
    !isSubmitting && validatedDestination !== null && validatedAmount !== null && balanceSufficient

  const handleAmountBlur = () => {
    const trimmed = amount.trim()
    if (!trimmed) {
      setAmountError(null)
      return
    }
    const n = Number.parseFloat(trimmed)
    if (!Number.isFinite(n) || n <= 0) {
      setAmountError("Enter a positive number.")
      return
    }
    if (n < WITHDRAW_MIN_USD) {
      setAmountError(`Minimum withdraw is $${WITHDRAW_MIN_USD.toFixed(2)} USDC.`)
      return
    }
    if (n > WITHDRAW_MAX_USD) {
      setAmountError(`Maximum single withdraw is $${WITHDRAW_MAX_USD.toFixed(2)} USDC.`)
      return
    }
    setAmountError(null)
  }

  const handleDestinationBlur = () => {
    const trimmed = destination.trim()
    if (!trimmed) {
      setDestinationError(null)
      return
    }
    if (!isAddress(trimmed)) {
      setDestinationError("Not a valid EVM address.")
      return
    }
    setDestinationError(null)
  }

  const handleSubmit = async () => {
    if (!canSubmit || !validatedAmount || !validatedDestination) return
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetchWithPayment(`${API_URL}/wallet/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_usd: validatedAmount, destination: validatedDestination }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
        setSubmitError(friendlyPaymentError(data.error ?? null))
        return
      }

      const data = (await res.json()) as { txHash: string; amount_usd: string; destination: string }
      setSuccess({ txHash: data.txHash, amount: data.amount_usd, destination: data.destination })
      onSuccess?.()
    } catch (err) {
      setSubmitError(friendlyPaymentError(err instanceof Error ? err.message : String(err)))
    } finally {
      setIsSubmitting(false)
    }
  }

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
                <h2 className="font-display text-xl font-bold text-amber-300">Withdraw USDC</h2>
                <p className="mt-2 text-sm text-gray-300">
                  Send {USDC_CHAIN_LABEL} from your embedded wallet to any address. Gas is paid by the x402 facilitator.
                </p>
              </div>
              <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-amber-200">
                x402
              </span>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Your balance</span>
                <div className="text-right">
                  <div className="text-gray-100">{balanceLabel}</div>
                  <div className="text-[9px] uppercase tracking-[0.2em] text-ob-outline">on {CHAIN_NAME}</div>
                </div>
              </div>
            </div>

            {success ? (
              <div className="mt-4 space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <div className="font-semibold">Withdraw confirmed.</div>
                <div className="text-xs text-emerald-200/90">
                  Sent {success.amount} USDC to{" "}
                  <span className="font-mono">{`${success.destination.slice(0, 6)}…${success.destination.slice(-4)}`}</span>
                </div>
                <a
                  href={`${EXPLORER_BASE}${success.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-emerald-300/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-200 transition-colors hover:bg-emerald-300/10"
                >
                  View on Basescan →
                </a>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-xs text-gray-400">
                  Amount (USDC)
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={`${WITHDRAW_MIN_USD.toFixed(2)}–${WITHDRAW_MAX_USD.toFixed(2)}`}
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value)
                      setAmountError(null)
                      setSubmitError(null)
                    }}
                    onBlur={handleAmountBlur}
                    disabled={isSubmitting}
                    className="mt-1 w-full rounded border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-400/60 disabled:opacity-50"
                  />
                  {amountError ? <span className="mt-1 block text-[11px] text-ob-error">{amountError}</span> : null}
                </label>

                <label className="block text-xs text-gray-400">
                  Destination address
                  <input
                    type="text"
                    placeholder="0x…"
                    value={destination}
                    onChange={(e) => {
                      setDestination(e.target.value)
                      setDestinationError(null)
                      setSubmitError(null)
                    }}
                    onBlur={handleDestinationBlur}
                    disabled={isSubmitting}
                    spellCheck={false}
                    className="mt-1 w-full rounded border border-gray-800 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 outline-none focus:border-amber-400/60 disabled:opacity-50"
                  />
                  {destinationError ? (
                    <span className="mt-1 block text-[11px] text-ob-error">{destinationError}</span>
                  ) : validatedDestination ? (
                    <span className="mt-1 block text-[11px] text-emerald-300">
                      ✓ {`${validatedDestination.slice(0, 6)}…${validatedDestination.slice(-4)}`}
                    </span>
                  ) : null}
                </label>

                {!balanceSufficient && validatedAmount && (
                  <p className="text-xs text-ob-error">
                    Your wallet doesn't have enough USDC for this withdraw.
                  </p>
                )}

                <p className="text-[11px] text-ob-outline">
                  Send only to addresses on {CHAIN_NAME}. Funds sent to addresses on other chains will be lost.
                </p>
              </div>
            )}

            {submitError ? <p className="mt-3 text-sm text-red-400">{submitError}</p> : null}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-full border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 disabled:opacity-40"
              >
                {success ? "Close" : "Cancel"}
              </button>
              {!success && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
                >
                  {isSubmitting ? "Processing..." : "Withdraw"}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
