"use client"

import Link from "next/link"
import { useEffect } from "react"
import { useActiveSpectateSessions } from "../hooks/use-active-spectate-sessions"
import { useLeaderboard } from "../hooks/use-leaderboard"
import { LobbyChatPanel } from "../components/lobby-chat-panel"
import { CharacterSearch } from "../components/character-search"

// Material Symbol per class — same mapping the leaderboard uses for visual
// consistency. If you change one, change the other.
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
  const { entries: topPlayers, fetchLeaderboard } = useLeaderboard()

  useEffect(() => {
    void fetchLeaderboard({ type: "xp", limit: 5 })
  }, [fetchLeaderboard])

  return (
    <div className="flex h-[calc(100vh-5rem)] overflow-hidden bg-ob-bg ob-body">

      {/* ── LEFT SIDEBAR: Active Rankings + Search ─────────────────────────── */}
      <aside className="hidden md:flex flex-col w-72 bg-ob-surface-container-low border-r border-ob-outline-variant/15 overflow-y-auto shrink-0">
        <div className="p-6 space-y-6">
          <div>
            <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-primary uppercase mb-4">
              ACTIVE RANKINGS
            </h3>
            <div className="space-y-2">
              {topPlayers.length === 0 ? (
                <div className="ob-label text-[10px] text-ob-on-surface-variant italic px-2">Loading...</div>
              ) : (
                topPlayers.map((player, i) => (
                  <Link
                    key={player.character_id}
                    href={`/spectate/${player.character_id}`}
                    className={`flex items-center justify-between p-3 rounded-lg transition-all ${
                      i === 0
                        ? "bg-white/5 border-l-2 border-ob-primary hover:bg-white/10"
                        : "hover:bg-white/5 border-l-2 border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`ob-label text-xs ${i === 0 ? "text-ob-primary" : "text-ob-on-surface-variant"}`}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className={`text-xs font-bold truncate ${
                          i === 0 ? "text-ob-on-surface" : "text-ob-on-surface-variant"
                        }`}>
                          {player.character_name.toUpperCase()}
                        </span>
                        <span className="text-[9px] ob-label text-ob-on-surface-variant uppercase tracking-tighter">
                          LVL {player.level} {player.class.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <span className="ob-label text-[10px] text-ob-on-surface-variant whitespace-nowrap ml-2">
                      {player.xp >= 1000 ? `${(player.xp / 1000).toFixed(1)}k` : player.xp}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        <CharacterSearch />

        <div className="mt-auto p-6">
          <button
            type="button"
            onClick={() => void refetch()}
            className="w-full ob-label text-[10px] tracking-widest uppercase border border-ob-primary/30 text-ob-primary hover:bg-ob-primary/10 py-3 rounded-xl transition-colors"
          >
            Sync Feed
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6 md:p-12 relative">
        {/* Ambient background blobs */}
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
              <span className="h-px w-24 bg-gradient-to-r from-ob-primary to-transparent" />
              <p className="text-xs text-ob-on-surface-variant max-w-lg">
                Watch active dungeon sessions in real time. Click any ranked player on the left, or choose an active run below.
              </p>
            </div>
          </section>

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
                  No one is in a dungeon right now. Try watching a top-ranked player from the sidebar.
                </p>
              </div>
            ) : (
              sessions.map((row) => {
                const cls = row.character.class
                return (
                  <Link
                    key={row.character_id}
                    href={`/spectate/${row.character_id}`}
                    className="block border border-ob-outline-variant/10 bg-ob-surface-container-low hover:border-ob-primary/30 hover:bg-ob-surface-container rounded-xl p-5 transition-colors group"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-12 h-12 rounded-lg bg-ob-surface-container-highest border border-ob-outline-variant/15 flex items-center justify-center group-hover:border-ob-primary/30 transition-colors`}>
                          <span className={`material-symbols-outlined text-xl ${CLASS_COLOR[cls] ?? "text-ob-primary"}`}>
                            {CLASS_ICON[cls] ?? "person"}
                          </span>
                        </div>
                        <div>
                          <div className="ob-headline not-italic text-ob-primary text-base font-bold uppercase">
                            {cls.toUpperCase()} — LVL {row.character.level}
                          </div>
                          <div className="ob-label text-[10px] text-ob-on-surface-variant tracking-tighter uppercase mt-0.5">
                            ID: {row.character_id.slice(0, 8)}…
                          </div>
                        </div>
                      </div>
                      <span className="flex items-center gap-2 ob-label text-[10px] px-3 py-1.5 border border-ob-secondary/40 text-ob-secondary tracking-widest uppercase rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary animate-pulse" />
                        WATCH LIVE
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

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void refetch()}
              className="ob-label text-[10px] tracking-widest uppercase text-ob-on-surface-variant border border-ob-outline-variant/15 hover:border-ob-primary/30 hover:text-ob-primary px-4 py-2 rounded-lg transition-colors"
            >
              Refresh Now
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
