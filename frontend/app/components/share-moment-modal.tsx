"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useEffect, useState } from "react"
import { ShareCard } from "./share-card"
import { titleCase } from "../lib/format"

const SITE_URL = process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://app.adventure.fun"

// Full-screen overlay shown on the "YOU HAVE FALLEN" death screen. Displays
// a live preview of the dynamic OG legend card so the user sees exactly what
// will ship when they tweet. The modal is deduped per-death by the parent
// via sessionStorage so returning to the death screen after dismissing
// doesn't re-pop.

interface ShareMomentModalProps {
  open: boolean
  onClose: () => void
  characterId: string
  characterName: string
  characterClass: string
  floor: number
  cause: string
}

export function ShareMomentModal({
  open,
  onClose,
  characterId,
  characterName,
  characterClass,
  floor,
  cause,
}: ShareMomentModalProps) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const legendUrl = `${SITE_URL}/legends/${characterId}`
  const ogImageUrl = `${SITE_URL}/api/og/legend/${characterId}`
  const classTitle = titleCase(characterClass)
  const shareText = `My ${classTitle} ${characterName} just fell on Floor ${floor} to ${cause} in Adventure.fun. One life. Real stakes.`

  // Reset image-loaded state when the modal opens for a new character so the
  // shimmer runs again and we don't flash a stale preview.
  useEffect(() => {
    if (open) setImgLoaded(false)
  }, [open, characterId])

  // Esc key dismiss.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="share-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-6 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Share your fallen hero"
        >
          <motion.div
            key="share-modal-card"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl rounded-2xl border border-ob-error/30 bg-ob-surface-container-low p-6 shadow-[0_0_80px_rgba(255,90,102,0.25)]"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-ob-outline-variant/30 text-ob-on-surface-variant transition-colors hover:border-ob-error/50 hover:text-ob-error"
              aria-label="Dismiss"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>

            <div className="space-y-1 text-center">
              <div className="ob-label text-[10px] uppercase tracking-[0.3em] text-ob-error">Memorial</div>
              <h2 className="ob-headline text-2xl text-ob-primary ob-amber-glow">Your legend has been written</h2>
              <p className="ob-label text-[11px] uppercase tracking-widest text-ob-on-surface-variant">
                {characterName} lives forever in the record
              </p>
            </div>

            {/* Live preview of the generated OG image */}
            <div className="relative mt-5 overflow-hidden rounded-xl border border-ob-outline-variant/20 bg-ob-surface-container-lowest">
              <div
                className="relative"
                style={{ aspectRatio: "2 / 1" }}
              >
                {!imgLoaded ? (
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-ob-surface-container to-ob-surface-container-low" />
                ) : null}
                <img
                  src={ogImageUrl}
                  alt={`Legend card for ${characterName}`}
                  width={1200}
                  height={600}
                  onLoad={() => setImgLoaded(true)}
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
                />
              </div>
            </div>

            <p className="mt-4 text-center text-xs italic text-ob-on-surface-variant">
              Share this moment. Let the world know what fell.
            </p>

            <div className="mt-4 flex justify-center">
              <ShareCard
                url={legendUrl}
                title={`${characterName} — Adventure.fun`}
                text={shareText}
                hashtags={["AdventureFun", "Permadeath"]}
                tone="error"
                size="md"
              />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
