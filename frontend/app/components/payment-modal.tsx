"use client"

interface PaymentModalProps {
  open: boolean
  title: string
  description: string
  priceUsd: string
  balanceLabel: string
  isProcessing?: boolean
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
  error,
  onConfirm,
  onCancel,
}: PaymentModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded border border-amber-400/40 bg-gray-950 p-5 shadow-2xl">
        <h2 className="text-lg font-bold text-amber-400">{title}</h2>
        <p className="mt-2 text-sm text-gray-300">{description}</p>

        <div className="mt-4 rounded border border-gray-800 bg-gray-900 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Price</span>
            <span className="font-semibold text-gray-100">{priceUsd} USDC</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-gray-500">Your balance</span>
            <span className="text-gray-100">{balanceLabel}</span>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="rounded border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isProcessing}
            className="rounded bg-amber-500 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
          >
            {isProcessing ? "Processing..." : "Approve Payment"}
          </button>
        </div>
      </div>
    </div>
  )
}
