"use client"

import { AnimatePresence, motion } from "framer-motion"

const TOAST_TONES = {
  success: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  error: "border-red-400/40 bg-red-500/10 text-red-100",
  info: "border-amber-400/40 bg-amber-500/10 text-amber-100",
} as const

interface UiToastProps {
  open: boolean
  title?: string
  message: string
  tone?: keyof typeof TOAST_TONES
  onClose?: () => void
}

export function UiToast({
  open,
  title,
  message,
  tone = "info",
  onClose,
}: UiToastProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="pointer-events-none fixed right-4 top-4 z-[60] w-full max-w-sm"
        >
          <div className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${TOAST_TONES[tone]}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                {title ? <p className="text-sm font-semibold">{title}</p> : null}
                <p className="text-sm/6">{message}</p>
              </div>
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/70 transition-colors hover:text-white"
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
