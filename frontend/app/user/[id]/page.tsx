"use client"

// Public user profile page — /user/[id].
//
// Accepts a handle, wallet address, or account UUID and renders the account's
// public info plus the full character roster (alive + graveyard) served by
// GET /users/:id. Viewer-aware:
//
//   - When the signed-in account matches the profile being viewed, extra
//     self-only affordances light up: a "Continue playing" shortcut to /play,
//     a direct logout button, and a small "you're viewing your own profile"
//     chip in the header.
//
//   - Otherwise the page is pure read-only. No mutations, no payments.

import Link from "next/link"
import { useRouter } from "next/navigation"
import { use, useEffect, useState } from "react"
import type { CharacterClass } from "@adventure-fun/schemas"
import { useAdventureAuth } from "../../hooks/use-adventure-auth"
import { useUsdcBalance } from "../../hooks/use-usdc-balance"
import { ProfileEditModal } from "../../components/profile-edit-modal"
import {
  characterHref,
  ownerLabel,
  shortenWallet,
} from "../../lib/character-display"

// Class glyph mapping shared with the rest of the OBSIDIAN surface.
const CLASS_ICON: Record<string, string> = {
  knight: "shield",
  mage:   "auto_awesome",
  rogue:  "bolt",
  archer: "my_location",
}

const CLASS_COLOR: Record<string, string> = {
  knight: "text-ob-tertiary",
  mage:   "text-ob-primary",
  rogue:  "text-ob-secondary",
  archer: "text-ob-tertiary",
}

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

interface UserCharacter {
  id: string
  name: string
  class: CharacterClass
  level: number
  xp: number
  status: "alive" | "dead"
  hp_current: number
  hp_max: number
  resource_current: number
  resource_max: number
  created_at: string
  died_at: string | null
  deepest_floor: number | null
  realms_completed: number | null
  cause_of_death: string | null
}

interface UserProfile {
  user: {
    id: string
    handle: string | null
    wallet: string
    player_type: "human" | "agent"
    x_handle: string | null
    github_handle: string | null
    created_at: string
  }
  characters: UserCharacter[]
  stats: {
    total_characters: number
    alive_count: number
    dead_count: number
    total_xp: number
    deepest_floor: number
    total_completions: number
  }
}

export default function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [data, setData] = useState<UserProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmingHandle, setConfirmingHandle] = useState(false)

  const { account, evmAddress, isAuthenticated, logout, token, refreshAccount } = useAdventureAuth()
  const { balanceLabel, isTestnet } = useUsdcBalance()

  // Reload the profile after a successful edit so the header and the
  // socials row pick up the new values. Cheap — just re-fires the same
  // GET /users/:id request on the id we want (which may be a NEW handle
  // after an edit). We deliberately accept an optional override here
  // because after a handle change, `id` from the URL is stale — React
  // hasn't re-rendered yet, and /users/<old-handle> would 404.
  const reload = (nextId?: string) => {
    const target = nextId ?? id
    fetch(`${API_URL}/users/${encodeURIComponent(target)}`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((body) => setData(body as UserProfile))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to reload"))
  }

  const confirmHandle = async () => {
    if (!token) return
    setConfirmingHandle(true)
    try {
      const res = await fetch(`${API_URL}/auth/profile/confirm-handle`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await refreshAccount()
    } catch {
      // Non-fatal; leave the card visible so the user can retry.
    } finally {
      setConfirmingHandle(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${API_URL}/users/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<UserProfile>
      })
      .then((body) => {
        if (!cancelled) setData(body)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load profile")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-ob-bg ob-body flex items-center justify-center">
        <div className="ob-label text-xs tracking-widest uppercase text-ob-on-surface-variant animate-pulse">
          Loading profile...
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-ob-bg ob-body flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-4 bg-ob-surface-container-low p-8 rounded-xl border border-ob-outline-variant/15">
          <span className="material-symbols-outlined text-4xl text-ob-error">person_off</span>
          <div className="ob-headline not-italic text-xl text-ob-on-surface">Profile not found</div>
          <p className="text-sm text-ob-on-surface-variant">{error ?? "We couldn't find that user."}</p>
          <Link href="/leaderboard" className="inline-block ob-label text-xs uppercase tracking-widest text-ob-primary border border-ob-primary/40 hover:bg-ob-primary/10 px-4 py-2 rounded-lg transition-colors">
            Back to leaderboard
          </Link>
        </div>
      </main>
    )
  }

  // Viewer-aware: is the signed-in account looking at their own profile?
  const signedInWallet = (account?.wallet_address ?? evmAddress ?? "").toLowerCase()
  const profileWallet = data.user.wallet.toLowerCase()
  const isOwnProfile = isAuthenticated && signedInWallet === profileWallet
  const displayName = data.user.handle ?? shortenWallet(data.user.wallet)

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-ob-bg ob-body relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 right-1/4 w-[500px] h-[500px] bg-ob-primary/5 rounded-full blur-[180px] -z-0" />
      <div className="pointer-events-none absolute bottom-0 left-1/4 w-[600px] h-[600px] bg-ob-tertiary/5 rounded-full blur-[200px] -z-0 opacity-50" />

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-12 md:py-16 space-y-8">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <section className="flex items-start gap-6">
          <div className="w-20 h-20 rounded-2xl bg-ob-surface-container-low border-2 border-ob-primary/30 flex items-center justify-center shrink-0 ob-relic-glow">
            <span className="material-symbols-outlined text-4xl text-ob-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
              person
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="ob-label text-[10px] tracking-[0.25em] text-ob-secondary uppercase mb-1 flex items-center gap-2">
              USER PROFILE
              {isOwnProfile ? (
                <span className="ob-label text-[9px] text-ob-primary border border-ob-primary/30 bg-ob-primary/10 px-2 py-0.5 rounded tracking-widest">
                  YOU
                </span>
              ) : null}
            </div>
            <h1 className="ob-headline text-3xl md:text-4xl text-ob-primary mb-2 tracking-tight ob-amber-glow truncate">
              {displayName.toUpperCase()}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="ob-label text-[10px] uppercase tracking-widest text-ob-on-surface-variant">
                {shortenWallet(data.user.wallet)}
              </span>
              <span className={`ob-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${
                data.user.player_type === "human"
                  ? "text-ob-primary border-ob-primary/30 bg-ob-primary/5"
                  : "text-ob-tertiary border-ob-tertiary/30 bg-ob-tertiary/5"
              }`}>
                {data.user.player_type}
              </span>
              <span className="ob-label text-[10px] uppercase tracking-widest text-ob-outline">
                JOINED {new Date(data.user.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Self-only actions */}
          {isOwnProfile ? (
            <div className="flex flex-col gap-2 shrink-0">
              <Link
                href="/play"
                className="ob-label text-[10px] uppercase tracking-widest bg-ob-primary text-ob-on-primary px-4 py-2 rounded-lg hover:brightness-110 transition-all font-bold text-center"
              >
                ▶ Play
              </Link>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="ob-label text-[10px] uppercase tracking-widest border border-ob-primary/40 text-ob-primary hover:bg-ob-primary/10 px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                Edit Profile
              </button>
              <button
                type="button"
                onClick={() => logout()}
                className="ob-label text-[10px] uppercase tracking-widest border border-ob-outline-variant/30 text-ob-on-surface-variant hover:border-ob-error/40 hover:text-ob-error px-4 py-2 rounded-lg transition-colors"
              >
                Logout
              </button>
            </div>
          ) : null}
        </section>

        {/* Handle confirmation nudge — visible ONLY to the signed-in
            owner when their handle hasn't been confirmed yet. Public
            viewers never see this card (the /users/:id response doesn't
            expose handle_confirmed; we gate on account from auth state).

            Two paths to dismiss:
              - "Keep this handle" → POST /auth/profile/confirm-handle,
                which just flips the flag, no field change.
              - "Change handle" → opens the edit modal; a successful
                save via PATCH /auth/profile flips the flag as a side
                effect. */}
        {isOwnProfile && account?.handle_confirmed === false ? (
          <section className="bg-ob-primary/5 border border-ob-primary/30 rounded-xl p-5 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span className="material-symbols-outlined text-2xl text-ob-primary shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>
                shield_person
              </span>
              <div className="min-w-0">
                <div className="ob-label text-[10px] uppercase tracking-widest text-ob-primary mb-1">
                  CONFIRM YOUR HANDLE
                </div>
                <p className="text-xs text-ob-on-surface-variant leading-relaxed">
                  We picked <span className="text-ob-on-surface font-semibold">{account.handle}</span> for you
                  automatically. Your runs won&apos;t show on the leaderboard until you keep this name or choose your own.
                  Only you can see this notice.
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={confirmHandle}
                disabled={confirmingHandle}
                className="ob-label text-[10px] uppercase tracking-widest bg-ob-primary text-ob-on-primary px-4 py-2 rounded-lg hover:brightness-110 transition-all font-bold disabled:opacity-50"
              >
                {confirmingHandle ? "Saving…" : "Keep This"}
              </button>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="ob-label text-[10px] uppercase tracking-widest border border-ob-primary/40 text-ob-primary hover:bg-ob-primary/10 px-4 py-2 rounded-lg transition-colors"
              >
                Change
              </button>
            </div>
          </section>
        ) : null}

        {/* Socials — show X and GitHub links prominently when set. These
            come from the PATCH /auth/profile endpoint (issue #5) and are
            stored as bare usernames, so we construct the URLs here. */}
        {(data.user.x_handle || data.user.github_handle) && (
          <section className="flex flex-wrap gap-3">
            {data.user.x_handle ? (
              <a
                href={`https://x.com/${data.user.x_handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-ob-surface-container-low border border-ob-outline-variant/15 hover:border-ob-primary/30 px-4 py-2 rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-sm text-ob-primary">alternate_email</span>
                <span className="text-xs text-ob-on-surface">@{data.user.x_handle}</span>
              </a>
            ) : null}
            {data.user.github_handle ? (
              <a
                href={`https://github.com/${data.user.github_handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-ob-surface-container-low border border-ob-outline-variant/15 hover:border-ob-primary/30 px-4 py-2 rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-sm text-ob-primary">code</span>
                <span className="text-xs text-ob-on-surface">{data.user.github_handle}</span>
              </a>
            ) : null}
          </section>
        )}

        {/* ── Aggregate stats ─────────────────────────────────────────── */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-4">
            <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">CHARACTERS</div>
            <div className="ob-headline not-italic text-2xl text-ob-on-surface">{data.stats.total_characters}</div>
            <div className="text-[10px] text-ob-on-surface-variant mt-1">
              {data.stats.alive_count} alive · {data.stats.dead_count} fallen
            </div>
          </div>
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-4">
            <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">LIFETIME XP</div>
            <div className="ob-headline not-italic text-2xl text-ob-tertiary">{data.stats.total_xp.toLocaleString()}</div>
          </div>
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-4">
            <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">DEEPEST FLOOR</div>
            <div className="ob-headline not-italic text-2xl text-ob-primary">{data.stats.deepest_floor}</div>
          </div>
          <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-4">
            <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">REALMS CLEARED</div>
            <div className="ob-headline not-italic text-2xl text-ob-secondary">{data.stats.total_completions}</div>
          </div>
        </section>

        {/* ── Self-only wallet info ───────────────────────────────────── */}
        {isOwnProfile ? (
          <section className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-6">
            <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-on-surface-variant uppercase mb-4">WALLET</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1">FULL ADDRESS</div>
                <div className="font-mono text-xs text-ob-on-surface break-all">{data.user.wallet}</div>
              </div>
              <div>
                <div className="ob-label text-[9px] uppercase tracking-widest text-ob-on-surface-variant mb-1 flex items-center gap-2">
                  USDC BALANCE
                  {isTestnet ? (
                    <span className="border border-ob-primary/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-ob-primary rounded">
                      Testnet
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-ob-on-surface">{balanceLabel}</div>
              </div>
            </div>
          </section>
        ) : null}

        {/* ── Characters roster ───────────────────────────────────────── */}
        <section>
          <h2 className="ob-label text-[10px] tracking-[0.2em] text-ob-on-surface-variant uppercase mb-4">
            CHARACTERS ({data.stats.total_characters})
          </h2>

          {data.characters.length === 0 ? (
            <div className="bg-ob-surface-container-low border border-ob-outline-variant/10 rounded-xl p-12 text-center">
              <span className="material-symbols-outlined text-4xl text-ob-on-surface-variant/40 mb-3 block">
                hourglass_empty
              </span>
              <div className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest">
                No characters yet
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.characters.map((char) => {
                const isAlive = char.status === "alive"
                const hpPct = char.hp_max > 0 ? (char.hp_current / char.hp_max) * 100 : 0
                return (
                  <Link
                    key={char.id}
                    href={characterHref(char.id)}
                    className={`bg-ob-surface-container-low border rounded-xl p-5 hover:border-ob-primary/30 transition-colors group ${
                      isAlive ? "border-ob-outline-variant/15" : "border-ob-outline-variant/10 opacity-70 hover:opacity-100"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-12 h-12 rounded-lg border flex items-center justify-center shrink-0 ${
                          isAlive ? "bg-ob-surface-container-highest border-ob-outline-variant/15" : "bg-ob-surface-container-high border-ob-outline-variant/10"
                        }`}>
                          <span className={`material-symbols-outlined text-xl ${CLASS_COLOR[char.class] ?? "text-ob-primary"}`}>
                            {CLASS_ICON[char.class] ?? "person"}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className={`ob-headline not-italic text-base font-bold uppercase truncate ${
                            isAlive ? "text-ob-primary" : "text-ob-on-surface-variant line-through"
                          }`}>
                            {char.name}
                          </div>
                          <div className="ob-label text-[9px] text-ob-on-surface-variant uppercase tracking-tighter mt-0.5">
                            LVL {char.level} {char.class}
                          </div>
                        </div>
                      </div>
                      {isAlive ? (
                        <span className="flex items-center gap-1.5 ob-label text-[9px] uppercase tracking-widest text-ob-secondary">
                          <span className="w-1 h-1 rounded-full bg-ob-secondary shadow-[0_0_8px_#6bfe9c]" />
                          ALIVE
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 ob-label text-[9px] uppercase tracking-widest text-ob-error">
                          <span className="w-1 h-1 rounded-full bg-ob-error" />
                          DEAD
                        </span>
                      )}
                    </div>

                    {/* Quick stats */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-ob-surface-container-high px-2 py-1.5 rounded">
                        <div className="ob-label text-[8px] uppercase text-ob-on-surface-variant">XP</div>
                        <div className="text-xs text-ob-tertiary mt-0.5">{char.xp.toLocaleString()}</div>
                      </div>
                      <div className="bg-ob-surface-container-high px-2 py-1.5 rounded">
                        <div className="ob-label text-[8px] uppercase text-ob-on-surface-variant">FLOOR</div>
                        <div className="text-xs text-ob-primary mt-0.5">{char.deepest_floor ?? "—"}</div>
                      </div>
                      <div className="bg-ob-surface-container-high px-2 py-1.5 rounded">
                        <div className="ob-label text-[8px] uppercase text-ob-on-surface-variant">CLEARS</div>
                        <div className="text-xs text-ob-secondary mt-0.5">{char.realms_completed ?? 0}</div>
                      </div>
                    </div>

                    {/* HP bar for alive characters */}
                    {isAlive ? (
                      <div className="mt-3 space-y-1">
                        <div className="flex justify-between ob-label text-[9px]">
                          <span className="text-ob-on-surface-variant">HP</span>
                          <span className="text-ob-on-surface">{char.hp_current}/{char.hp_max}</span>
                        </div>
                        <div className="h-1 w-full bg-ob-surface-container-lowest rounded-full overflow-hidden">
                          <div
                            className={`h-full ${hpPct < 25 ? "bg-ob-error" : "bg-ob-secondary"}`}
                            style={{ width: `${hpPct}%` }}
                          />
                        </div>
                      </div>
                    ) : char.cause_of_death ? (
                      <div className="mt-3 pt-2 border-t border-ob-outline-variant/10">
                        <div className="text-[10px] text-ob-error truncate" title={char.cause_of_death}>
                          {char.cause_of_death}
                        </div>
                      </div>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Profile edit modal — rendered via portal-less conditional at
          the end so it sits above the ambient background blobs. Only
          mounted when you're editing your own profile (the button that
          opens it is gated on isOwnProfile). */}
      {editOpen && isOwnProfile ? (
        <ProfileEditModal
          initial={{
            handle: data.user.handle,
            x_handle: data.user.x_handle,
            github_handle: data.user.github_handle,
          }}
          onClose={() => setEditOpen(false)}
          onSaved={(newHandle) => {
            setEditOpen(false)
            // Refresh the cached auth/account row so the header pill
            // picks up the new handle without a page reload, and drop
            // the unconfirmed-handle nudge state.
            void refreshAccount()
            // If the handle changed, the current URL still contains the
            // OLD segment — /users/<old> 404s because the backend resolves
            // by handle. Replace the URL and reload against the new id.
            const oldSeg = decodeURIComponent(id).toLowerCase()
            if (newHandle && newHandle !== oldSeg) {
              router.replace(`/user/${encodeURIComponent(newHandle)}`)
              reload(newHandle)
            } else {
              reload()
            }
          }}
        />
      ) : null}
    </main>
  )
}
