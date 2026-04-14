"use client"

// Welcome / first-sign-in handle modal.
//
// Shown automatically whenever the signed-in viewer has an unconfirmed
// handle (i.e. `handle_confirmed === false`, which is the state every
// brand-new account starts in — see backend/src/routes/auth.ts
// `/auth/connect`). The goal is a single friendly interrupt on first
// sign-in where the user either:
//
//   1. Accepts the auto-assigned anon handle ("Keep"),
//   2. Opens the full edit modal to pick a custom one ("Change"), or
//   3. Dismisses it for good via "Don't show again".
//
// Either of the first two mutations flips `handle_confirmed` to true
// on the server, after which this modal naturally stops rendering for
// them on every device. Option 3 is a localStorage-only escape hatch
// for users who refuse to engage on THIS device — per-device by
// design, since it's a UX preference, not auth state.
//
// The passive nudge indicators (pulsing dot on header icon, dropdown
// card, profile-page banner) remain regardless of this modal's state,
// so the user always has a path back if they dismiss.

import { useEffect, useRef, useState } from "react"
import { ProfileEditModal } from "./profile-edit-modal"
import { useAdventureAuth } from "../hooks/use-adventure-auth"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"
const DISMISS_KEY = "adventure_welcome_dismissed"

export function WelcomeHandleModal() {
  const { account, token, refreshAccount, isAuthenticated } = useAdventureAuth()
  const [dismissed, setDismissed] = useState(true) // start true → never flash on SSR
  const [editOpen, setEditOpen] = useState(false)
  const [keeping, setKeeping] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Hydrate the dismiss flag from localStorage on mount. Kept separate
  // from the render gate so SSR and the first client paint never show
  // a stale modal.
  useEffect(() => {
    if (typeof window === "undefined") return
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "true")
  }, [])

  const needsWelcome =
    isAuthenticated && account?.handle_confirmed === false && !dismissed && !editOpen

  // Close on Escape — same ergonomic as other modals on the site.
  useEffect(() => {
    if (!needsWelcome) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeForNow()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsWelcome])

  function closeForNow() {
    // Per-session close only — does NOT set the localStorage flag, so
    // the modal will come back on next page load. This is the "X"
    // button's behavior; the explicit "Don't show again" button is
    // what persists dismissal.
    setDismissed(true)
  }

  function dontShowAgain() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "true")
    }
    setDismissed(true)
  }

  async function keepHandle() {
    if (!token) return
    setKeeping(true)
    try {
      const res = await fetch(`${API_URL}/auth/profile/confirm-handle`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) await refreshAccount()
      // refreshAccount flips handle_confirmed in-memory → needsWelcome
      // becomes false → modal unmounts. No explicit close needed.
    } finally {
      setKeeping(false)
    }
  }

  // When the edit modal finishes successfully, refresh auth state so
  // handle_confirmed reflects the PATCH side effect and this modal
  // closes automatically.
  const onEditSaved = () => {
    setEditOpen(false)
    void refreshAccount()
  }

  if (editOpen) {
    return (
      <ProfileEditModal
        initial={{
          handle: account?.handle ?? null,
          x_handle: account?.x_handle ?? null,
          github_handle: account?.github_handle ?? null,
        }}
        onClose={() => setEditOpen(false)}
        onSaved={onEditSaved}
      />
    )
  }

  if (!needsWelcome) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        className="w-full max-w-md bg-ob-surface-container border border-ob-primary/30 rounded-xl p-6 shadow-2xl space-y-5 ob-relic-glow"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="ob-label text-[10px] tracking-[0.25em] text-ob-secondary uppercase mb-1">
              WELCOME, ADVENTURER
            </div>
            <h2 className="ob-headline not-italic text-2xl text-ob-primary font-bold uppercase ob-amber-glow">
              Choose Your Name
            </h2>
          </div>
          <button
            type="button"
            onClick={closeForNow}
            className="material-symbols-outlined text-ob-on-surface-variant hover:text-ob-primary transition-colors text-xl"
            aria-label="Close"
          >
            close
          </button>
        </div>

        <div className="bg-ob-surface-container-lowest border border-ob-outline-variant/15 rounded-lg p-4">
          <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">
            WE PICKED THIS FOR YOU
          </div>
          <div className="ob-headline not-italic text-lg text-ob-primary font-bold truncate">
            {account?.handle}
          </div>
        </div>

        <p className="text-sm text-ob-on-surface-variant leading-relaxed">
          Your runs won&apos;t appear on the leaderboard until you keep this name or pick your own.
          You can always change it later from your profile.
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={keepHandle}
            disabled={keeping}
            className="ob-label text-[11px] uppercase tracking-widest bg-ob-primary text-ob-on-primary font-bold py-3 rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
          >
            {keeping ? "Saving…" : `Keep "${account?.handle}"`}
          </button>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="ob-label text-[11px] uppercase tracking-widest border border-ob-primary/40 text-ob-primary hover:bg-ob-primary/10 py-3 rounded-lg transition-colors"
          >
            Pick My Own
          </button>
          <button
            type="button"
            onClick={dontShowAgain}
            className="ob-label text-[10px] uppercase tracking-widest text-ob-outline hover:text-ob-on-surface-variant py-2 transition-colors"
          >
            Don&apos;t show again
          </button>
        </div>
      </div>
    </div>
  )
}
