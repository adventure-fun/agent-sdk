"use client"

// Spectate index — public landing for watching live runs.
//
// Mobile-first note: the first thing a visitor does on this page is
// SEARCH for a player or pick someone from the live list. The desktop
// layout uses a left sidebar with rankings + search; on mobile the
// sidebar is hidden and a compact version (search + horizontal
// rankings strip) sits inline above the main content so everything
// you need is on one scroll.
//
// Rankings-source note: the sidebar was previously sourced from the
// top-XP leaderboard (filtered alive-only) but that confused visitors
// because top-XP-alive characters aren't necessarily *spectatable* —
// they might be idling in the hub. The sidebar now sources directly
// from useActiveSpectateSessions so every row is a character you can
// actually click into and watch right now.

import Link from "next/link"
import { useActiveSpectateSessions } from "../hooks/use-active-spectate-sessions"
import { LobbyChatPanel } from "../components/lobby-chat-panel"
import { CharacterSearch } from "../components/character-search"
import { characterDisplayName } from "../lib/character-display"

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

export default function SpectateIndexPage() {
  const { sessions, isLoading, error, refetch } = useActiveSpectateSessions({ refreshMs: 12_000 })

  // Sort live sessions by deepest-floor then highest-turn — rough proxy
  // for "most interesting to watch right now". Same 10-row cap as the old
  // leaderboard-based sidebar so the shell height is roughly stable.
  const liveRows = [...sessions]
    .sort((a, b) => {
      const floorDiff = b.realm_info.current_floor - a.realm_info.current_floor
      if (floorDiff !== 0) return floorDiff
      return b.turn - a.turn
    })
    .slice(0, 10)

  // Render a single live-session row — shared between the desktop
  // sidebar and the mobile horizontal strip so the two stay in visual
  // sync. Previously sourced from the leaderboard top-5 XP; now sourced
  // from active spectate sessions so every row is definitely watchable.
  const renderLiveRow = (
    session: typeof liveRows[number],
    i: number,
    variant: "sidebar" | "strip",
  ) => {
    const cls = session.character.class
    const charName = session.character.name
    // Display as "{owner}'s {name}" when we have owner info, but the
    // SpectatableSessionSummary currently doesn't carry it, so we fall
    // back to the raw character name. Same as the active session cards
    // below.
    const displayName = characterDisplayName(charName, null)

    if (variant === "strip") {
      return (
        <Link
          key={session.character_id}
          href={`/spectate/${session.character_id}`}
          className="shrink-0 flex items-center gap-2 bg-ob-surface-container-high border border-ob-outline-variant/10 hover:border-ob-primary/30 rounded-xl px-3 py-2 min-w-[170px] transition-colors"
        >
          <div className={`w-8 h-8 rounded-lg bg-ob-surface-container-lowest border border-ob-outline-variant/15 flex items-center justify-center shrink-0`}>
            <span className={`material-symbols-outlined text-base ${CLASS_COLOR[cls] ?? "text-ob-primary"}`}>
              {CLASS_ICON[cls] ?? "person"}
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold truncate text-ob-on-surface">
              {displayName.toUpperCase()}
            </span>
            <span className="text-[9px] ob-label text-ob-on-surface-variant uppercase tracking-tighter">
              F{session.realm_info.current_floor} · T{session.turn}
            </span>
          </div>
        </Link>
      )
    }

    return (
      <Link
        key={session.character_id}
        href={`/spectate/${session.character_id}`}
        className={`flex items-center justify-between p-3 rounded-lg transition-all ${
          i === 0
            ? "bg-ob-secondary/5 border-l-2 border-ob-secondary hover:bg-ob-secondary/10"
            : "hover:bg-white/5 border-l-2 border-transparent"
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-8 h-8 rounded-lg bg-ob-surface-container-lowest border border-ob-outline-variant/15 flex items-center justify-center shrink-0`}>
            <span className={`material-symbols-outlined text-base ${CLASS_COLOR[cls] ?? "text-ob-primary"}`}>
              {CLASS_ICON[cls] ?? "person"}
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold truncate text-ob-on-surface">
              {displayName.toUpperCase()}
            </span>
            <span className="text-[9px] ob-label text-ob-on-surface-variant uppercase tracking-tighter">
              LVL {session.character.level} {cls.toUpperCase()} · F{session.realm_info.current_floor}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary animate-pulse shadow-[0_0_6px_#6bfe9c]" />
          <span className="ob-label text-[9px] text-ob-secondary uppercase tracking-widest">LIVE</span>
        </div>
      </Link>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-5rem)] bg-ob-bg ob-body">

      {/* ── DESKTOP SIDEBAR ────────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-72 bg-ob-surface-container-low border-r border-ob-outline-variant/15 overflow-y-auto shrink-0 sticky top-20 h-[calc(100vh-5rem)]">
        <div className="p-6 space-y-6">
          <div>
            <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-primary uppercase mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary animate-pulse" />
              LIVE RUNS
            </h3>
            <div className="space-y-2">
              {isLoading && liveRows.length === 0 ? (
                <div className="ob-label text-[10px] text-ob-on-surface-variant italic px-2">Loading...</div>
              ) : liveRows.length === 0 ? (
                <div className="px-2 py-3 space-y-2">
                  <div className="ob-label text-[10px] text-ob-on-surface-variant italic">
                    No one is in a dungeon right now.
                  </div>
                  <Link
                    href="/leaderboard"
                    className="ob-label text-[10px] tracking-widest uppercase text-ob-primary hover:underline inline-flex items-center gap-1"
                  >
                    Browse leaderboard →
                  </Link>
                </div>
              ) : (
                liveRows.map((session, i) => renderLiveRow(session, i, "sidebar"))
              )}
            </div>
          </div>
        </div>

        <CharacterSearch />

        {/* The old "Sync Feed" button used to sit here. Removed because
            useActiveSpectateSessions auto-refreshes every 12 seconds
            (see the refreshMs option at the top of this component),
            so a manual refresh is redundant. The error-banner retry
            button in main content covers the one case a user might
            want to force a retry — when the automatic fetch failed. */}
      </aside>

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-x-hidden p-4 md:p-12 relative">
        <div className="pointer-events-none absolute top-0 right-0 w-[400px] h-[400px] bg-ob-primary/5 rounded-full blur-[150px] -z-0" />
        <div className="pointer-events-none absolute bottom-0 left-0 w-[600px] h-[600px] bg-ob-tertiary/5 rounded-full blur-[200px] -z-0 opacity-30" />

        <div className="relative z-10 max-w-3xl mx-auto space-y-6">

          {/* Hero */}
          <section>
            <p className="ob-label text-[10px] tracking-[0.25em] text-ob-secondary uppercase mb-2">
              SPECTATOR MODE
            </p>
            <h1 className="ob-headline text-4xl md:text-5xl text-ob-primary mb-4 tracking-tight ob-amber-glow">
              LIVE_RUNS
            </h1>
            <div className="flex items-center gap-4">
              <span className="h-px w-16 md:w-24 bg-gradient-to-r from-ob-primary to-transparent" />
              <p className="text-xs text-ob-on-surface-variant">
                Watch active dungeon runs in real time.
              </p>
            </div>
          </section>

          {/* ── MOBILE SEARCH + RANKINGS STRIP ─────────────────────────────── */}
          {/* On mobile, the sidebar is hidden — surface search + rankings
              at the top of main content so they're the first thing a
              visitor sees. Desktop users get the same affordances in the
              left sidebar, so this block is hidden above md. */}
          <div className="md:hidden space-y-4">
            <div className="bg-ob-surface-container-low border border-ob-outline-variant/15 rounded-xl">
              <CharacterSearch />
            </div>

            <div>
              <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-primary uppercase mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary animate-pulse" />
                LIVE RUNS
              </h3>
              {isLoading && liveRows.length === 0 ? (
                <div className="ob-label text-[10px] text-ob-on-surface-variant italic px-2">Loading...</div>
              ) : liveRows.length === 0 ? (
                <div className="ob-label text-[10px] text-ob-on-surface-variant italic px-2">
                  No one is in a dungeon right now.
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">
                  {liveRows.map((session, i) => renderLiveRow(session, i, "strip"))}
                </div>
              )}
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="flex items-center justify-between border border-ob-error/30 bg-ob-error/10 px-4 py-3 rounded-lg">
              <span className="text-xs text-ob-error">{error}</span>
              <button
                type="button"
                onClick={() => void refetch()}
                className="ob-label text-[10px] uppercase tracking-widest text-ob-error border border-ob-error/40 hover:bg-ob-error/10 px-3 py-1.5 rounded transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Active sessions */}
          <div className="space-y-3">
            {isLoading && sessions.length === 0 ? (
              <div className="border border-ob-outline-variant/10 bg-ob-surface-container-low rounded-xl p-12 text-center">
                <span className="material-symbols-outlined text-3xl text-ob-on-surface-variant/40 mb-3 block animate-pulse">
                  sync
                </span>
                <div className="ob-label text-[10px] text-ob-on-surface-variant tracking-widest uppercase">
                  SYNCING LIVE SESSIONS...
                </div>
              </div>
            ) : sessions.length === 0 ? (
              <div className="border border-ob-outline-variant/10 bg-ob-surface-container-low rounded-xl p-12 text-center">
                <span className="material-symbols-outlined text-3xl text-ob-on-surface-variant/40 mb-3 block">
                  visibility_off
                </span>
                <div className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest mb-2">
                  NO ACTIVE RUNS
                </div>
                <p className="text-xs text-ob-on-surface-variant max-w-xs mx-auto">
                  No one is in a dungeon right now.
                </p>
              </div>
            ) : (
              sessions.map((row) => {
                const cls = row.character.class
                // SpectatableSessionSummary doesn't carry owner info today
                // so we fall back to the bare character name. The dedicated
                // character page has the full "{owner}'s {name}" form.
                const name = characterDisplayName(row.character.name, null)
                return (
                  <Link
                    key={row.character_id}
                    href={`/spectate/${row.character_id}`}
                    className="block border border-ob-outline-variant/10 bg-ob-surface-container-low hover:border-ob-primary/30 hover:bg-ob-surface-container rounded-xl p-4 md:p-5 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-12 h-12 rounded-lg bg-ob-surface-container-highest border border-ob-outline-variant/15 flex items-center justify-center group-hover:border-ob-primary/30 transition-colors shrink-0">
                          <span className={`material-symbols-outlined text-xl ${CLASS_COLOR[cls] ?? "text-ob-primary"}`}>
                            {CLASS_ICON[cls] ?? "person"}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="ob-headline not-italic text-ob-primary text-base font-bold uppercase truncate">
                            {name.toUpperCase()}
                          </div>
                          <div className="ob-label text-[10px] text-ob-on-surface-variant tracking-tighter uppercase mt-0.5">
                            LVL {row.character.level} {cls.toUpperCase()}
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 flex items-center gap-1.5 ob-label text-[10px] px-2.5 py-1 border border-ob-secondary/40 text-ob-secondary tracking-widest uppercase rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary animate-pulse" />
                        LIVE
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        ["REALM",  row.realm_info.template_name],
                        ["FLOOR",  String(row.realm_info.current_floor)],
                        ["TURN",   String(row.turn)],
                        ["STATUS", row.realm_info.status.replaceAll("_", " ")],
                      ].map(([label, val]) => (
                        <div key={label} className="bg-ob-surface-container-high px-3 py-2 rounded-lg border border-ob-outline-variant/5">
                          <div className="ob-label text-[9px] text-ob-on-surface-variant uppercase tracking-widest">{label}</div>
                          <div className="text-xs text-ob-on-surface mt-0.5 truncate capitalize">{val}</div>
                        </div>
                      ))}
                    </div>
                  </Link>
                )
              })
            )}
          </div>

          {/* Global lobby chat */}
          <div className="h-72">
            <LobbyChatPanel />
          </div>

          {/* The old "Sync Feed" / "Refresh now" buttons used to sit
              here. Removed along with the sidebar button — the hook
              auto-refreshes every 12 seconds and the error banner
              above already provides a manual retry path when the
              fetch has actually failed. */}
        </div>
      </main>
    </div>
  )
}
