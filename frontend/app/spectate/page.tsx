"use client"

import Link from "next/link"
import { useActiveSpectateSessions } from "../hooks/use-active-spectate-sessions"

// All data-fetching logic is UNCHANGED — only the render is restyled.

export default function SpectateIndexPage() {
  const { sessions, isLoading, error, refetch } = useActiveSpectateSessions({ refreshMs: 12_000 })

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-aw-bg aw-label text-aw-on-surface">
      <div className="flex h-full">

        {/* ── Left sidebar ──────────────────────────────────────────────── */}
        <aside className="hidden md:flex flex-col w-60 bg-aw-surface-lowest border-r border-white/5 py-6 shrink-0">
          <div className="px-5 mb-6">
            <div className="text-[10px] tracking-[0.2em] text-aw-outline uppercase mb-2">Mode</div>
            <div className="aw-headline text-aw-primary text-lg aw-amber-glow">ARCANE_WATCH</div>
            <div className="text-[10px] text-aw-outline mt-1">SPECTATOR_INDEX</div>
          </div>

          <div className="px-5">
            <div className="text-[10px] tracking-[0.2em] text-aw-outline uppercase mb-3">Quick Nav</div>
            <div className="space-y-1">
              <Link href="/spectate" className="block py-2 px-3 text-xs text-aw-secondary border-l-2 border-aw-secondary bg-aw-surface-high">
                Live Runs
              </Link>
              <Link href="/leaderboard" className="block py-2 px-3 text-xs text-aw-outline border-l-2 border-transparent hover:border-aw-outline hover:text-aw-on-surface transition-colors">
                Leaderboard
              </Link>
              <Link href="/play" className="block py-2 px-3 text-xs text-aw-outline border-l-2 border-transparent hover:border-aw-outline hover:text-aw-on-surface transition-colors">
                Play
              </Link>
            </div>
          </div>

          <div className="mt-auto px-5">
            <button
              type="button"
              onClick={() => void refetch()}
              className="w-full py-2 text-[10px] tracking-widest uppercase border border-aw-secondary/30 text-aw-secondary hover:bg-aw-secondary/10 transition-colors"
            >
              Sync Feed
            </button>
          </div>
        </aside>

        {/* ── Main content ──────────────────────────────────────────────── */}
        <main className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-3xl mx-auto space-y-5">

            {/* Header */}
            <div>
              <p className="text-[10px] tracking-[0.25em] text-aw-secondary uppercase mb-1">Spectator Mode</p>
              <h1 className="aw-headline text-aw-primary text-2xl md:text-3xl aw-amber-glow">
                LIVE_RUNS
              </h1>
              <p className="text-xs text-aw-on-surface-variant mt-1 max-w-lg">
                Watch active dungeon sessions in real time. Feed refreshes every 12 seconds.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center justify-between gap-3 border border-aw-error/30 bg-aw-error-container/20 px-4 py-2 text-xs text-aw-error">
                <span>&gt;&gt; ERROR: {error}</span>
                <button type="button" onClick={() => void refetch()} className="underline hover:no-underline">
                  Retry
                </button>
              </div>
            )}

            {/* Session list */}
            <div className="space-y-3">
              {isLoading && sessions.length === 0 ? (
                <div className="border border-white/5 bg-aw-surface-low p-8 text-center text-xs text-aw-outline tracking-widest">
                  SYNCING_LIVE_SESSIONS...
                </div>
              ) : sessions.length === 0 ? (
                <div className="border border-white/5 bg-aw-surface-low p-8 text-center text-xs text-aw-outline">
                  No active runs detected. Delvers may be in the hub.
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
                          <div className="aw-headline text-aw-primary text-sm group-hover:aw-amber-glow transition-all capitalize">
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
                        <div className="bg-aw-surface-container px-2 py-1.5">
                          <div className="text-aw-outline">REALM</div>
                          <div className="text-aw-on-surface mt-0.5 truncate">{row.realm_info.template_name}</div>
                        </div>
                        <div className="bg-aw-surface-container px-2 py-1.5">
                          <div className="text-aw-outline">FLOOR</div>
                          <div className="text-aw-on-surface mt-0.5">{row.realm_info.current_floor}</div>
                        </div>
                        <div className="bg-aw-surface-container px-2 py-1.5">
                          <div className="text-aw-outline">TURN</div>
                          <div className="text-aw-on-surface mt-0.5">{row.turn}</div>
                        </div>
                        <div className="bg-aw-surface-container px-2 py-1.5">
                          <div className="text-aw-outline">STATUS</div>
                          <div className="text-aw-on-surface mt-0.5 capitalize">
                            {row.realm_info.status.replaceAll("_", " ")}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void refetch()}
                className="text-[10px] tracking-widest uppercase text-aw-outline hover:text-aw-on-surface border border-white/5 hover:border-white/20 px-4 py-2 transition-colors"
              >
                Refresh Now
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
