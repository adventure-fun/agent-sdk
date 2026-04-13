"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import type { SpectatorObservation, CharacterClass } from "@adventure-fun/schemas"
import { GameMap } from "../../components/game-map"
import { useLeaderboard } from "../../hooks/use-leaderboard"
import { useActiveSpectateSessions } from "../../hooks/use-active-spectate-sessions"
import { ChatTabs } from "../../components/chat-tabs"
import { CharacterSearch } from "../../components/character-search"

interface Props {
  params: Promise<{ characterId: string }>
}

// Class glyph mapping shared with leaderboard + spectate index for consistency.
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

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: every state/ref/effect/handler in this component is functionally
// identical to the previous ARCANE_WATCH version. Only the JSX is new. The WS
// connect/reconnect lifecycle, the character-name lookup chain, the spectator
// observation handling, and the chat tabs all behave exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

export default function SpectatePage({ params }: Props) {
  const [observation, setObservation] = useState<SpectatorObservation | null>(null)
  const [characterId, setCharacterId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [statusMessage, setStatusMessage] = useState("Connecting...")
  const [error, setError] = useState<string | null>(null)
  const [endedReason, setEndedReason] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const retryCountRef = useRef(0)
  const endedReasonRef = useRef<string | null>(null)

  // Active live runs for the left sidebar. Was previously sourced from
  // the top-5 XP leaderboard (filtered alive-only) but that was still
  // showing characters you couldn't actually click to spectate. Now
  // sourced from /spectate/active so every row in the sidebar is a
  // watchable live run.
  const { sessions: liveSessions } = useActiveSpectateSessions({ refreshMs: 12_000 })
  // Kept around for the character-name fallback below — if the character
  // being watched isn't currently live but we have their leaderboard row,
  // we can still show their name. Not used for the sidebar anymore.
  const { entries: topPlayers, fetchLeaderboard } = useLeaderboard()
  const [charEntry, setCharEntry] = useState<{ character_name: string; class: string } | null>(null)

  useEffect(() => {
    void fetchLeaderboard({ type: "xp", limit: 5, aliveOnly: true })
  }, [fetchLeaderboard])

  // Sort live sessions by deepest floor then highest turn — same rule
  // as the spectate index sidebar.
  const liveRows = [...liveSessions]
    .sort((a, b) => {
      const floorDiff = b.realm_info.current_floor - a.realm_info.current_floor
      if (floorDiff !== 0) return floorDiff
      return b.turn - a.turn
    })
    .slice(0, 10)

  // Fetch character info if not in top-5
  const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"
  useEffect(() => {
    if (!characterId) return
    if (topPlayers.some((p) => p.character_id === characterId)) return
    fetch(`${API_URL}/leaderboard/character/${characterId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.entry) setCharEntry(d.entry) })
      .catch(() => {})
  }, [characterId, topPlayers, API_URL])

  const requestReconnect = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    retryCountRef.current = 0
    setConnected(false)
    setEndedReason(null)
    endedReasonRef.current = null
    setError(null)
    setObservation(null)
    setStatusMessage("Reconnecting...")
    setRetryToken((v) => v + 1)
  }

  useEffect(() => {
    let cancelled = false
    const connect = (id: string) => {
      if (cancelled) return
      const wsUrl = process.env["NEXT_PUBLIC_WS_URL"] ?? "ws://localhost:3001"
      const ws = new WebSocket(`${wsUrl}/spectate/${id}`)
      wsRef.current = ws
      setStatusMessage(retryCountRef.current > 0 ? "Reconnecting..." : "Connecting...")

      ws.onopen = () => {
        retryCountRef.current = 0
        endedReasonRef.current = null
        setConnected(true)
        setError(null)
        setEndedReason(null)
        setStatusMessage("LIVE_FEED: [STABLE]")
      }
      ws.onclose = () => {
        setConnected(false)
        if (cancelled || endedReasonRef.current) return
        // Issue #8: after a few consecutive failed attempts, check whether
        // the character is still in a live realm at all. If they're dead
        // or idle, the WS will never reconnect — stop retrying and show
        // a clear "this run has ended" message with a link to the
        // character page instead of spinning forever.
        //
        // We only poll when we haven't yet reached the connected state
        // OR when the connection was lost after being connected, because
        // a healthy session that just hiccupped should still reconnect
        // the normal way (the `ws.onopen` path above).
        const retryCount = retryCountRef.current
        retryCountRef.current += 1
        if (retryCount >= 3) {
          fetch(`${API_URL}/characters/public/${id}`)
            .then((r) => r.ok ? r.json() : null)
            .then((body) => {
              if (cancelled || endedReasonRef.current) return
              const character = body?.character
              if (!character) return
              if (character.status !== "alive") {
                endedReasonRef.current = "death"
                setEndedReason("death")
                setStatusMessage("Character has fallen.")
                return
              }
              if (!body.current_realm) {
                endedReasonRef.current = "idle"
                setEndedReason("idle")
                setStatusMessage("This character isn't in a realm right now.")
                return
              }
              // Character is alive and in a realm — retry normally
              const delay = Math.min(1000 * 2 ** retryCount, 8000)
              setStatusMessage("Reconnecting...")
              reconnectTimerRef.current = window.setTimeout(() => connect(id), delay)
            })
            .catch(() => {
              // Polling itself failed — retry anyway so we don't lock up
              const delay = Math.min(1000 * 2 ** retryCount, 8000)
              setStatusMessage("Reconnecting...")
              reconnectTimerRef.current = window.setTimeout(() => connect(id), delay)
            })
          return
        }
        const delay = Math.min(1000 * 2 ** retryCount, 8000)
        setStatusMessage("Connection lost. Retrying...")
        reconnectTimerRef.current = window.setTimeout(() => connect(id), delay)
      }
      ws.onerror = () => {
        setError("Unable to reach spectator feed.")
        setStatusMessage("FEED_UNREACHABLE")
      }
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as
            | { type: "observation"; data: SpectatorObservation }
            | { type: "session_ended"; reason: string }
            | { type: "error"; message: string }
          if (payload.type === "observation") {
            setObservation(payload.data)
            setError(null)
            setStatusMessage("LIVE_FEED: [STABLE]")
          } else if (payload.type === "session_ended") {
            setEndedReason(payload.reason)
            endedReasonRef.current = payload.reason
            setConnected(false)
            setStatusMessage("SESSION_ENDED")
            ws.close()
          } else if (payload.type === "error") {
            setError(payload.message)
          }
        } catch {
          setError("Malformed spectator data.")
        }
      }
    }
    params.then(({ characterId: id }) => {
      if (cancelled) return
      setCharacterId(id)
      connect(id)
    })
    return () => {
      cancelled = true
      endedReasonRef.current = null
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [params, retryToken])

  const obs = observation
  const enemies = obs?.visible_entities.filter((e) => e.type === "enemy") ?? []
  const leaderboardPlayer = topPlayers.find((p) => p.character_id === characterId)
  const charName = obs?.character.name ?? leaderboardPlayer?.character_name ?? charEntry?.character_name ?? null
  const classLabel = obs ? obs.character.class.toUpperCase() : "???"
  const charClass = obs?.character.class ?? leaderboardPlayer?.class ?? charEntry?.class ?? null
  const shortId = characterId ? characterId.slice(0, 8) : "..."
  const rank = leaderboardPlayer ? topPlayers.indexOf(leaderboardPlayer) + 1 : 0

  if (!characterId) {
    return (
      <div className="flex h-[calc(100vh-5rem)] items-center justify-center bg-ob-bg ob-body">
        <div className="text-center space-y-2">
          <div className="ob-headline text-3xl text-ob-primary ob-amber-glow">ADVENTURE.FUN</div>
          <div className="ob-label text-xs tracking-widest opacity-60 uppercase text-ob-on-surface-variant">
            Initialising spectator uplink...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col md:flex-row md:h-[calc(100vh-5rem)] md:overflow-hidden bg-ob-bg ob-body">

      {/* ── MOBILE: SEARCH + RANKINGS STRIP (above main) ─────────────────── */}
      {/* On mobile the left sidebar is hidden (see `hidden md:flex` below)
          — this block takes its place at the top of the page so search is
          still the first affordance after the header. */}
      <div className="md:hidden bg-ob-surface-container-low border-b border-ob-outline-variant/15">
        <CharacterSearch />
        <div className="px-4 pb-3">
          <h3 className="ob-label text-[9px] tracking-[0.2em] text-ob-primary uppercase mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary animate-pulse" />
            LIVE RUNS
          </h3>
          {liveRows.length === 0 ? (
            <div className="ob-label text-[10px] text-ob-on-surface-variant italic">
              No other live runs right now.
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
              {liveRows.map((session) => {
                const isWatching = session.character_id === characterId
                const cls = session.character.class
                return (
                  <Link
                    key={session.character_id}
                    href={`/spectate/${session.character_id}`}
                    className={`shrink-0 flex items-center gap-2 rounded-xl px-3 py-2 min-w-[170px] border transition-colors ${
                      isWatching
                        ? "bg-ob-primary/10 border-ob-primary/40"
                        : "bg-ob-surface-container-high border-ob-outline-variant/10 hover:border-ob-primary/30"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-ob-surface-container-lowest border border-ob-outline-variant/15 flex items-center justify-center shrink-0">
                      <span className={`material-symbols-outlined text-base ${CLASS_COLOR[cls] ?? "text-ob-primary"}`}>
                        {CLASS_ICON[cls] ?? "person"}
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-bold truncate text-ob-on-surface">
                        {session.character.name.toUpperCase()}
                      </span>
                      <span className="text-[9px] ob-label text-ob-on-surface-variant uppercase">
                        F{session.realm_info.current_floor} · T{session.turn}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── DESKTOP LEFT SIDEBAR: Live runs + Search ──────────────────────── */}
      <aside className="hidden md:flex flex-col w-72 bg-ob-surface-container-low border-r border-ob-outline-variant/15 overflow-y-auto shrink-0">
        <div className="p-6 space-y-6">
          <div>
            <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-primary uppercase mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary animate-pulse" />
              LIVE RUNS
            </h3>
            <div className="space-y-2">
              {liveRows.length === 0 ? (
                <div className="px-2 py-3 space-y-2">
                  <div className="ob-label text-[10px] text-ob-on-surface-variant italic">
                    No other live runs right now.
                  </div>
                  <Link
                    href="/leaderboard"
                    className="ob-label text-[10px] tracking-widest uppercase text-ob-primary hover:underline inline-flex items-center gap-1"
                  >
                    Browse leaderboard →
                  </Link>
                </div>
              ) : (
                liveRows.map((session) => {
                  const isWatching = session.character_id === characterId
                  const cls = session.character.class
                  return (
                    <Link
                      key={session.character_id}
                      href={`/spectate/${session.character_id}`}
                      className={`flex items-center justify-between p-3 rounded-lg transition-all ${
                        isWatching
                          ? "bg-ob-primary/10 border-l-2 border-ob-primary"
                          : "hover:bg-white/5 border-l-2 border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-ob-surface-container-lowest border border-ob-outline-variant/15 flex items-center justify-center shrink-0">
                          <span className={`material-symbols-outlined text-base ${CLASS_COLOR[cls] ?? "text-ob-primary"}`}>
                            {CLASS_ICON[cls] ?? "person"}
                          </span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className={`text-xs font-bold truncate ${
                            isWatching ? "text-ob-on-surface" : "text-ob-on-surface-variant"
                          }`}>
                            {session.character.name.toUpperCase()}
                          </span>
                          <span className="text-[9px] ob-label text-ob-on-surface-variant uppercase tracking-tighter">
                            LVL {session.character.level} {cls.toUpperCase()} · F{session.realm_info.current_floor}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-ob-secondary animate-pulse shadow-[0_0_6px_#6bfe9c]" />
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <CharacterSearch />

        <div className="mt-auto p-6 space-y-2">
          <button
            type="button"
            onClick={requestReconnect}
            className="w-full ob-label text-[10px] tracking-widest uppercase border border-ob-primary/30 text-ob-primary hover:bg-ob-primary/10 py-3 rounded-xl transition-colors"
          >
            Reconnect Feed
          </button>
          <Link
            href="/spectate"
            className="block w-full text-center ob-label text-[10px] tracking-widest uppercase border border-ob-outline-variant/15 text-ob-on-surface-variant hover:border-ob-primary/30 hover:text-ob-on-surface py-3 rounded-xl transition-colors"
          >
            All Live Runs
          </Link>
        </div>
      </aside>

      {/* ── MAIN CONTENT: Game Canvas + Feeds ──────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 bg-ob-bg relative min-h-[calc(100vh-5rem)] md:min-h-0">

        {/* Header bar */}
        <div className="px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3 border-b border-ob-outline-variant/10">
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
            <span className="hidden md:inline ob-label text-[10px] text-ob-primary tracking-widest whitespace-nowrap">
              NOW SPECTATING:
            </span>
            <h2 className="ob-headline text-base md:text-xl text-ob-on-surface truncate">
              {charName ?? classLabel}
            </h2>
            {rank > 0 && (
              <span className="hidden sm:inline ob-label text-[10px] text-ob-secondary border border-ob-secondary/40 px-2 py-0.5 rounded whitespace-nowrap">
                RANK #{rank}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {endedReason ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-ob-error/10 border border-ob-error/30">
                <div className="w-1.5 h-1.5 rounded-full bg-ob-error" />
                <span className="ob-label text-[10px] text-ob-error font-bold tracking-widest">
                  ENDED
                </span>
              </div>
            ) : (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded ${
                connected
                  ? "bg-ob-error/10 border border-ob-error/20"
                  : "bg-ob-surface-container border border-ob-outline-variant/15"
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${
                  connected ? "bg-ob-error animate-pulse" : "bg-ob-on-surface-variant"
                }`} />
                <span className={`ob-label text-[10px] font-bold tracking-widest ${
                  connected ? "text-ob-error" : "text-ob-on-surface-variant"
                }`}>
                  {connected ? "LIVE" : "OFFLINE"}
                </span>
              </div>
            )}
            <span className="ob-label text-[10px] text-ob-on-surface-variant uppercase hidden lg:inline">
              FLOOR: {obs?.realm_info.current_floor ?? "—"}
            </span>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-4 flex items-center justify-between border border-ob-error/30 bg-ob-error/10 px-4 py-3 rounded-lg">
            <span className="text-xs text-ob-error">{error}</span>
            <button
              type="button"
              onClick={requestReconnect}
              className="ob-label text-[10px] uppercase tracking-widest text-ob-error border border-ob-error/40 hover:bg-ob-error/10 px-3 py-1.5 rounded transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Session ended panel (issue #8).
            Three terminal states the reconnect-poll in the WS effect
            can detect and stop retrying on:
              - "death"   — character is dead
              - "idle"    — character is alive but not in a realm
              - other     — a session_ended message from the server */}
        {endedReason && (
          <div className="mx-6 mt-4 border border-ob-primary/20 bg-ob-primary/5 p-4 rounded-xl">
            <div className="ob-headline not-italic text-ob-primary text-sm uppercase mb-2 font-bold">
              {endedReason === "idle"
                ? "NOT IN A REALM"
                : endedReason === "death"
                  ? "CHARACTER HAS FALLEN"
                  : `RUN ENDED — ${endedReason.toUpperCase()}`}
            </div>
            <p className="text-xs text-ob-on-surface-variant mb-3">
              {endedReason === "idle"
                ? "This character isn't in a dungeon right now. Try again later, or browse their profile."
                : endedReason === "death"
                  ? "The spectator feed has closed. Visit their legend page to see how their run ended."
                  : "The spectator feed closed unexpectedly."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={requestReconnect}
                className="px-4 py-2 ob-label text-[10px] uppercase tracking-widest bg-ob-primary text-ob-on-primary rounded-lg hover:brightness-110 transition-all font-bold"
              >
                Retry Connection
              </button>
              {characterId && (
                <Link
                  href={`/character/${characterId}`}
                  className="px-4 py-2 ob-label text-[10px] uppercase tracking-widest border border-ob-outline-variant/30 text-ob-on-surface-variant hover:border-ob-primary/30 hover:text-ob-primary rounded-lg transition-colors"
                >
                  Character Profile
                </Link>
              )}
              {endedReason === "death" && characterId && (
                <Link
                  href={`/legends/${characterId}`}
                  className="px-4 py-2 ob-label text-[10px] uppercase tracking-widest border border-ob-outline-variant/30 text-ob-on-surface-variant hover:border-ob-primary/30 hover:text-ob-primary rounded-lg transition-colors"
                >
                  View Legend
                </Link>
              )}
              <Link
                href="/spectate"
                className="px-4 py-2 ob-label text-[10px] uppercase tracking-widest border border-ob-outline-variant/30 text-ob-on-surface-variant hover:border-ob-primary/30 hover:text-ob-primary rounded-lg transition-colors"
              >
                All Live Runs
              </Link>
            </div>
          </div>
        )}

        {/* Game canvas */}
        {/* On mobile we fix a min-h so it doesn't collapse under the weight
            of the feeds + chat that stack below. On desktop flex-1 takes
            whatever's left between header, vitals strip, and bottom feeds. */}
        <div className="flex-1 relative overflow-hidden flex items-center justify-center p-4 md:p-6 min-h-[300px]">
          <div className="absolute inset-0 ob-scanline opacity-30" />

          <div className="w-full h-full max-w-4xl bg-ob-surface-container-low rounded-xl border border-ob-outline-variant/10 shadow-2xl relative flex items-center justify-center overflow-hidden">

            {/* Asymmetric metadata corners — wired to real obs data */}
            {obs && (
              <>
                <div className="absolute top-3 left-3 ob-label text-[10px] text-ob-tertiary/60 tracking-widest z-20">
                  LOC: [{obs.position.tile.x}, {obs.position.tile.y}]<br />
                  REALM: {obs.realm_info.template_name.toUpperCase()}
                </div>
                <div className="absolute top-3 right-3 ob-label text-[10px] text-ob-on-surface-variant/60 text-right z-20">
                  HP: {obs.character.hp_percent}%<br />
                  ESS: {obs.character.resource_percent}%
                </div>
                <div className="absolute bottom-3 left-3 ob-label text-[10px] text-ob-on-surface-variant/60 z-20">
                  ID: {shortId}…<br />
                  STATUS: {statusMessage}
                </div>
                <div className="absolute bottom-3 right-3 ob-label text-[10px] text-ob-on-surface-variant/60 text-right z-20">
                  TURN: {obs.turn}<br />
                  FLOOR: {obs.realm_info.current_floor}
                </div>
              </>
            )}

            {/* Map content */}
            <div className="z-10 p-12 w-full h-full flex items-center justify-center">
              {obs ? (
                <GameMap
                  visibleTiles={obs.visible_tiles}
                  playerPosition={obs.position.tile}
                  entities={obs.visible_entities}
                  realmTemplateId={obs.realm_info.template_id}
                  playerClass={obs.character.class as CharacterClass}
                />
              ) : (
                <div className="ob-label text-xs text-ob-on-surface-variant tracking-widest uppercase animate-pulse">
                  Awaiting live feed...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Room narrative */}
        {obs?.room_text && (
          <div className="mx-6 mb-2 border-l-2 border-ob-primary/30 pl-3 py-1">
            <p className="text-xs text-ob-on-surface-variant italic">{obs.room_text}</p>
          </div>
        )}

        {/* Mobile-only inline vitals strip — gives tablet/phone users access
            to HP / resource / level / class without needing the right sidebar
            which is hidden below xl. Desktop (xl+) gets the full sidebar on
            the right. */}
        {obs && (
          <div className="xl:hidden mx-6 mb-2 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-ob-surface-container-high rounded-lg p-2">
              <div className="ob-label text-[9px] text-ob-on-surface-variant uppercase tracking-widest">HP</div>
              <div className="text-sm text-ob-secondary font-bold">{obs.character.hp_percent}%</div>
            </div>
            <div className="bg-ob-surface-container-high rounded-lg p-2">
              <div className="ob-label text-[9px] text-ob-on-surface-variant uppercase tracking-widest">RESOURCE</div>
              <div className="text-sm text-ob-tertiary font-bold">{obs.character.resource_percent}%</div>
            </div>
            <div className="bg-ob-surface-container-high rounded-lg p-2">
              <div className="ob-label text-[9px] text-ob-on-surface-variant uppercase tracking-widest">LEVEL</div>
              <div className="text-sm text-ob-primary font-bold">{obs.character.level}</div>
            </div>
            <div className="bg-ob-surface-container-high rounded-lg p-2">
              <div className="ob-label text-[9px] text-ob-on-surface-variant uppercase tracking-widest">ENEMIES</div>
              <div className="text-sm text-ob-error font-bold">{enemies.length}</div>
            </div>
          </div>
        )}

        {/* Bottom feeds: dungeon events + chat tabs */}
        {/* On mobile we stack these vertically so neither is cramped.
            The chat panel becomes the primary surface (most likely use)
            and the dungeon feed collapses to a smaller fixed-height block
            on top so chat still gets meaningful space. */}
        <div className="grid grid-cols-1 md:grid-cols-2 md:h-72 bg-ob-surface-container-low border-t border-ob-outline-variant/15 shrink-0">

          {/* Dungeon Feed */}
          <div className="h-40 md:h-auto p-4 border-b md:border-b-0 md:border-r border-ob-outline-variant/15 overflow-y-auto ob-scrollbar">
            <h4 className="ob-label text-[10px] text-ob-on-surface-variant tracking-widest mb-3 flex items-center gap-2 uppercase">
              <span className="w-1.5 h-1.5 bg-ob-secondary rounded-full" />
              DUNGEON FEED
              <button
                type="button"
                onClick={requestReconnect}
                className="ml-auto ob-label text-[10px] text-ob-on-surface-variant hover:text-ob-primary"
              >
                SYNC
              </button>
            </h4>
            <div className="space-y-1.5 ob-label text-[11px]">
              {obs && obs.recent_events.length > 0 ? (
                obs.recent_events.slice(-12).map((event, i, arr) => {
                  const isLatest = i === arr.length - 1
                  return (
                    <p key={`${event.turn}-${i}`} className={isLatest ? "text-ob-on-surface" : "text-ob-on-surface-variant"}>
                      <span className="text-ob-secondary">[T{event.turn}]</span>{" "}
                      {event.detail}
                    </p>
                  )
                })
              ) : (
                <p className="text-xs text-ob-on-surface-variant italic">Waiting for events...</p>
              )}
            </div>
          </div>

          {/* Chat tabs (global + per-player) */}
          <div className="h-80 md:h-auto min-h-0">
            <ChatTabs characterId={characterId} characterName={charName} />
          </div>
        </div>
      </main>

      {/* ── RIGHT SIDEBAR: Vital Signs + Entity Feed ───────────────────────── */}
      <aside className="hidden xl:flex flex-col w-80 bg-ob-surface-container border-l border-ob-outline-variant/15 overflow-y-auto shrink-0">
        <div className="p-6 space-y-6">

          {/* Character vitals card */}
          <div className="p-5 rounded-xl bg-ob-surface-container-high border border-ob-outline-variant/10">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-lg bg-ob-surface-container-lowest border border-ob-outline-variant/20 flex items-center justify-center">
                {charClass ? (
                  <span className={`material-symbols-outlined text-2xl ${CLASS_COLOR[charClass] ?? "text-ob-primary"}`}>
                    {CLASS_ICON[charClass] ?? "person"}
                  </span>
                ) : (
                  <span className="material-symbols-outlined text-2xl text-ob-on-surface-variant/40">person</span>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="ob-headline text-lg text-ob-primary leading-tight truncate">
                  {charName ? charName.toUpperCase() : "—"}
                </h2>
                <p className="ob-label text-[10px] text-ob-on-surface-variant uppercase tracking-widest">
                  {charClass ? `${charClass.toUpperCase()} • LVL ${obs?.character.level ?? leaderboardPlayer?.level ?? "?"}` : ""}
                </p>
              </div>
            </div>

            {obs ? (
              <div className="space-y-4">
                {/* HP bar */}
                <div className="space-y-1">
                  <div className="flex justify-between ob-label text-[10px]">
                    <span className="text-ob-secondary font-bold">HEALTH</span>
                    <span className="text-ob-on-surface">{obs.character.hp_percent}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-ob-surface-container-lowest rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        obs.character.hp_percent < 25
                          ? "bg-ob-error shadow-[0_0_8px_rgba(255,115,81,0.3)]"
                          : "bg-ob-secondary shadow-[0_0_8px_rgba(107,254,156,0.3)]"
                      }`}
                      style={{ width: `${obs.character.hp_percent}%` }}
                    />
                  </div>
                </div>

                {/* Resource bar */}
                <div className="space-y-1">
                  <div className="flex justify-between ob-label text-[10px]">
                    <span className="text-ob-tertiary font-bold">RESOURCE</span>
                    <span className="text-ob-on-surface">{obs.character.resource_percent}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-ob-surface-container-lowest rounded-full overflow-hidden">
                    <div
                      className="h-full bg-ob-tertiary shadow-[0_0_8px_rgba(127,197,255,0.3)] transition-all duration-500"
                      style={{ width: `${obs.character.resource_percent}%` }}
                    />
                  </div>
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-ob-outline-variant/10">
                  <div className="bg-ob-surface-container-low p-2 rounded">
                    <div className="ob-label text-[9px] text-ob-on-surface-variant uppercase tracking-widest">CLASS</div>
                    <div className={`text-xs mt-0.5 capitalize ${CLASS_COLOR[obs.character.class] ?? "text-ob-primary"}`}>
                      {obs.character.class}
                    </div>
                  </div>
                  <div className="bg-ob-surface-container-low p-2 rounded">
                    <div className="ob-label text-[9px] text-ob-on-surface-variant uppercase tracking-widest">LEVEL</div>
                    <div className="text-xs text-ob-primary mt-0.5">{obs.character.level}</div>
                  </div>
                  <div className="col-span-2 bg-ob-surface-container-low p-2 rounded">
                    <div className="ob-label text-[9px] text-ob-on-surface-variant uppercase tracking-widest">REALM</div>
                    <div className="text-xs text-ob-on-surface mt-0.5 truncate">{obs.realm_info.template_name}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="h-1.5 bg-ob-surface-container animate-pulse rounded-full" />
                <div className="h-1.5 bg-ob-surface-container animate-pulse rounded-full" />
              </div>
            )}
          </div>

          {/* Entity feed */}
          <div>
            <h3 className="ob-label text-[10px] tracking-[0.2em] text-ob-on-surface-variant uppercase mb-4">
              NEARBY ENTITIES
            </h3>
            {enemies.length > 0 ? (
              <div className="space-y-3">
                {enemies.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 group">
                    <div className="w-8 h-8 rounded bg-ob-error/10 border border-ob-error/20 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-ob-error text-base">
                        skull
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-2">
                        <span className="text-xs font-bold text-ob-on-surface truncate">{e.name}</span>
                        {e.health_indicator ? (
                          <span className="ob-label text-[9px] text-ob-error capitalize whitespace-nowrap">
                            {e.health_indicator} HP
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="ob-label text-[10px] text-ob-on-surface-variant italic">No enemies in view.</p>
            )}
          </div>
        </div>

        <div className="mt-auto p-6 border-t border-ob-outline-variant/10">
          <button
            type="button"
            onClick={requestReconnect}
            className="w-full ob-label text-[10px] tracking-widest uppercase border border-ob-primary/30 text-ob-primary hover:bg-ob-primary/10 py-3 rounded-xl transition-colors"
          >
            Initialize Uplink
          </button>
        </div>
      </aside>
    </div>
  )
}
