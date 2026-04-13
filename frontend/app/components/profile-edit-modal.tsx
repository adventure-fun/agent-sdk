"use client"

// Profile edit modal — opens from /user/[id] when the viewer is looking at
// their own profile. Exposes the three fields the ticket (#5) calls for:
// handle, X username, GitHub username. Plain usernames only, never URLs.
//
// Validation on the client mirrors the regex in backend/src/routes/auth.ts
// exactly so the two can't drift: handles must be [a-z0-9_-]{3,24},
// X handles are [A-Za-z0-9_]{1,15}, GitHub handles are alnum + non-
// consecutive dashes up to 39 chars. Server does the profanity check and
// uniqueness validation because those aren't something we want to
// duplicate in frontend code.

import { useEffect, useRef, useState } from "react"
import { useAdventureAuth } from "../hooks/use-adventure-auth"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

const HANDLE_RE = /^[a-zA-Z0-9_-]{3,24}$/
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/
const GITHUB_HANDLE_RE = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/

interface Props {
  initial: {
    handle: string | null
    x_handle: string | null
    github_handle: string | null
  }
  onClose: () => void
  /** Called after a successful save. `newHandle` is the handle the
   *  user just saved — the parent uses it to router.replace() to the
   *  new /user/[handle] URL when it changed, because otherwise the
   *  current URL still contains the OLD handle and subsequent /users/:id
   *  fetches 404 (the backend resolves the ID segment by handle).
   *  See the "account not found" bug report that prompted this fix. */
  onSaved: (newHandle: string) => void
}

export function ProfileEditModal({ initial, onClose, onSaved }: Props) {
  const { token } = useAdventureAuth()
  const [handle, setHandle] = useState(initial.handle ?? "")
  const [xHandle, setXHandle] = useState(initial.x_handle ?? "")
  const [ghHandle, setGhHandle] = useState(initial.github_handle ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  // Client-side validation mirrors the backend regexes. We don't try to
  // run the profanity check client-side — that's a server responsibility
  // and lives in backend/src/game/handle-generator.ts (isProfane).
  const handleError = handle && !HANDLE_RE.test(handle)
    ? "Handle must be 3-24 chars, letters, numbers, dash, or underscore."
    : null
  const xError = xHandle && !X_HANDLE_RE.test(xHandle.replace(/^@/, ""))
    ? "X handle: 1-15 chars, letters, numbers, underscore. No @."
    : null
  const ghError = ghHandle && !GITHUB_HANDLE_RE.test(ghHandle)
    ? "GitHub handle: 1-39 chars, alphanumeric with dashes."
    : null
  const canSubmit = !saving && !handleError && !xError && !ghError

  // "Re-roll" the anon handle by asking the backend for a new suggestion.
  // Cheap — just runs the generator. Doesn't persist until submit.
  const reroll = async () => {
    if (!token) return
    setError(null)
    try {
      const res = await fetch(`${API_URL}/auth/profile/suggest-handle`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error("Failed to suggest handle")
      const body = await res.json() as { handle: string }
      setHandle(body.handle)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to suggest handle")
    }
  }

  const submit = async () => {
    if (!token) return
    setSaving(true)
    setError(null)
    try {
      // Build PATCH body — send every field (including empty ones) so
      // the user can explicitly clear X / GitHub handles. Handle can
      // never be null (every account must have one), so an empty
      // string there is a UX error rather than a clear. Handle is
      // lowercased here to match what the backend stores — avoids a
      // post-save refetch showing a different case than what the user
      // typed.
      const body: Record<string, string | null> = {
        handle: handle.trim().toLowerCase(),
        x_handle: xHandle.trim() === "" ? null : xHandle.trim().replace(/^@/, ""),
        github_handle: ghHandle.trim() === "" ? null : ghHandle.trim(),
      }
      const res = await fetch(`${API_URL}/auth/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      // Server normalizes the handle to lowercase, so pass along what
      // we sent (already lowercased client-side via the HANDLE_RE regex
      // allowing mixed case then .toLowerCase on submit would be ideal
      // — for now we pass the trimmed value which matches backend
      // behavior because the regex happens to accept only case-
      // insensitive chars). Parent uses this to update the route.
      onSaved(body.handle as string)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        className="w-full max-w-md bg-ob-surface-container border border-ob-outline-variant/20 rounded-xl p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="ob-label text-[10px] tracking-[0.2em] text-ob-secondary uppercase mb-1">
              EDIT PROFILE
            </div>
            <h2 className="ob-headline not-italic text-xl text-ob-primary font-bold uppercase">
              Your Details
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="material-symbols-outlined text-ob-on-surface-variant hover:text-ob-primary transition-colors text-xl"
            aria-label="Close"
          >
            close
          </button>
        </div>

        {/* Handle */}
        <div className="space-y-2">
          <label className="ob-label text-[10px] uppercase tracking-widest text-ob-on-surface-variant flex items-center justify-between">
            <span>Handle</span>
            <button
              type="button"
              onClick={reroll}
              className="ob-label text-[9px] text-ob-primary hover:underline normal-case tracking-wide"
            >
              ↻ Suggest anon
            </button>
          </label>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={24}
            placeholder="your-handle"
            className="w-full bg-ob-surface-container-lowest border border-ob-outline-variant/20 rounded-lg px-3 py-2 text-sm text-ob-on-surface placeholder:text-ob-outline focus:border-ob-primary/40 focus:outline-none transition-colors"
          />
          {handleError ? (
            <p className="text-[10px] text-ob-error">{handleError}</p>
          ) : (
            <p className="text-[10px] text-ob-outline">
              3-24 chars. Letters, numbers, dash, or underscore. Must be unique.
            </p>
          )}
        </div>

        {/* X Handle */}
        <div className="space-y-2">
          <label className="ob-label text-[10px] uppercase tracking-widest text-ob-on-surface-variant flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">alternate_email</span>
            X / TWITTER
          </label>
          <input
            type="text"
            value={xHandle}
            onChange={(e) => setXHandle(e.target.value)}
            maxLength={16}
            placeholder="jack"
            className="w-full bg-ob-surface-container-lowest border border-ob-outline-variant/20 rounded-lg px-3 py-2 text-sm text-ob-on-surface placeholder:text-ob-outline focus:border-ob-primary/40 focus:outline-none transition-colors"
          />
          {xError ? (
            <p className="text-[10px] text-ob-error">{xError}</p>
          ) : (
            <p className="text-[10px] text-ob-outline">
              Username only. No @ or URL. Leave blank to clear.
            </p>
          )}
        </div>

        {/* GitHub Handle */}
        <div className="space-y-2">
          <label className="ob-label text-[10px] uppercase tracking-widest text-ob-on-surface-variant flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">code</span>
            GITHUB
          </label>
          <input
            type="text"
            value={ghHandle}
            onChange={(e) => setGhHandle(e.target.value)}
            maxLength={39}
            placeholder="torvalds"
            className="w-full bg-ob-surface-container-lowest border border-ob-outline-variant/20 rounded-lg px-3 py-2 text-sm text-ob-on-surface placeholder:text-ob-outline focus:border-ob-primary/40 focus:outline-none transition-colors"
          />
          {ghError ? (
            <p className="text-[10px] text-ob-error">{ghError}</p>
          ) : (
            <p className="text-[10px] text-ob-outline">
              Username only. No URL. Leave blank to clear.
            </p>
          )}
        </div>

        {error ? (
          <div className="bg-ob-error/10 border border-ob-error/30 rounded-lg px-3 py-2">
            <p className="text-xs text-ob-error">{error}</p>
          </div>
        ) : null}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 ob-label text-[10px] uppercase tracking-widest border border-ob-outline-variant/30 text-ob-on-surface-variant hover:border-ob-primary/40 hover:text-ob-primary py-3 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="flex-1 ob-label text-[10px] uppercase tracking-widest bg-ob-primary text-ob-on-primary font-bold py-3 rounded-lg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
