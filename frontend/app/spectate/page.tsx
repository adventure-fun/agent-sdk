"use client"

import Link from "next/link"
import { useEffect } from "react"
import { useActiveSpectateSessions } from "../hooks/use-active-spectate-sessions"
import { useLeaderboard } from "../hooks/use-leaderboard"
import { LobbyChatPanel } from "../components/lobby-chat-panel"
import { CharacterSearch } from "../components/character-search"

export default function SpectateIndexPage() {
  const { sessions, isLoading, error, refetch } = useActiveSpectateSessions({ refreshMs: 12_000 })
  const { entries: topPlayers, fetchLeaderboard } = useLeaderboard()

  useEffect(() => {
    void fetchLeaderboard({ type: "xp", limit: 5 })
  }, [fetchLeaderboard])

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-aw-bg aw-label">

      {/* ── LEFT SIDEBAR: Active Rankings ──────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-56 bg-aw-surface-lowest border-r border-white/5 overflow-y-auto shrink-0">
        <div className="px-4 pt-5 pb-3">
          <div className="text-[10px] tracking-[0.2em] text-aw-outline uppercase mb-3">Active_Rankings</div>
          <div className="space-y-0.5">
            {topPlayers.length === 0 ? (
              <div className="text-[10px] text-aw-outline italic px-2">Loading...</div>
            ) : (
              topPlayers.map((player, i) => (
                <Link
                  key={player.character_id}
                  href={`/spectate/${player.character_id}`}
                  className="flex items-center gap-3 py-3 px-3 border-l-4 border-transparent text-aw-outline hover:bg-aw-surface-container hover:text-aw-on-surface hover:border-aw-secondary/40 transition-all group"
                >
                  <span className={`text-sm shrink-0 ${i === 0 ? "text-aw-primary" : "text-aw-outline"}`}>
                    {i === 0 ? "◈" : i === 1 ? "◇" : "○"}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate uppercase tracking-wide text-aw-on-surface group-hover:text-aw-on-surface">
                      {player.character_name}
                    </div>
                    <div className="text-[10px] text-aw-outline mt-0.5">
                      RANK #{i + 1} · {player.xp.toLocaleString()} XP
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <CharacterSearch />

        <div className="mt-auto px-4 pb-5">
          <button
            type="button"
            onClick={() => void refetch()}
            className="w-full py-2 text-[10px] tracking-widest uppercase border border-aw-secondary/30 text-aw-secondary hover:bg-aw-secondary/10 transition-colors"
          >
            Sync Feed
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ───────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-5">

          <div>
            <p className="text-[10px] tracking-[0.25em] text-aw-secondary uppercase mb-1">Spectator Mode</p>
            <h1 className="aw-headline text-aw-primary text-2xl md:text-3xl aw-amber-glow">LIVE_RUNS</h1>
            <p className="text-xs text-aw-on-surface-variant mt-1 max-w-lg">
              Watch active dungeon sessions in real time. Click any ranked player on the left, or choose an active run below.
            </p>
          </div>

          {error && (
            <div className="flex items-center justify-between border border-aw-error/30 bg-aw-error-container/20 px-4 py-2 text-xs text-aw-error">
              <span>&gt;&gt; ERROR: {error}</span>
              <button type="button" onClick={() => void refetch()} className="underline hover:no-underline">Retry</button>
            </div>
          )}

          <div className="space-y-3">
            {isLoading && sessions.length === 0 ? (
              <div className="border border-white/5 bg-aw-surface-low p-8 text-center text-[10px] text-aw-outline tracking-widest uppercase">
                SYNCING_LIVE_SESSIONS...
              </div>
            ) : sessions.length === 0 ? (
              <div className="border border-white/5 bg-aw-surface-low p-8 text-center">
                <div className="text-[10px] text-aw-outline uppercase tracking-widest mb-2">NO_ACTIVE_RUNS</div>
                <p className="text-xs text-aw-on-surface-variant">
                  No one is in a dungeon right now. Try watching a top-ranked player from the sidebar.
                </p>
              </div>
            ) : (
              sessions.map((row) => (
                <Link
                  key={row.character_id}
                  href={`/spectate/${row.character_id}`}
                  className="block border border-white/5 bg-aw-surface-low hover:border-aw-secondary/30 hover:bg-aw-surface-container transition-colors group"
                >
                  <div className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="aw-headline text-aw-primary text-sm capitalize">
                          {row.character.class.toUpperCase()} // LVL {row.character.level}
                        </div>
                        <div className="text-[10px] text-aw-outline mt-0.5">
                          ID: {row.character_id.slice(0, 8)}...
                        </div>
                      </div>
                      <span className="flex items-center gap-1.5 text-[10px] px-3 py-1 border border-aw-secondary/40 text-aw-secondary tracking-widest uppercase">
                        <span className="w-1 h-1 rounded-full bg-aw-secondary animate-pulse" />
                        WATCH_LIVE
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                      {[
                        ["REALM", row.realm_info.template_name],
                        ["FLOOR", String(row.realm_info.current_floor)],
                        ["TURN", String(row.turn)],
                        ["STATUS", row.realm_info.status.replaceAll("_", " ")],
                      ].map(([label, val]) => (
                        <div key={label} className="bg-aw-surface-container px-2 py-1.5">
                          <div className="text-aw-outline">{label}</div>
                          <div className="text-aw-on-surface mt-0.5 truncate capitalize">{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>

          {/* Global lobby chat */}
          <div className="h-72">
            <LobbyChatPanel />
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={() => void refetch()}
              className="text-[10px] tracking-widest uppercase text-aw-outline hover:text-aw-on-surface border border-white/5 hover:border-white/20 px-4 py-2 transition-colors">
              Refresh Now
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
