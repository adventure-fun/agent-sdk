"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import type { SpectatorObservation } from "@adventure-fun/schemas"
import { GameMap } from "../../components/game-map"

interface Props {
  params: Promise<{ characterId: string }>
}

// ── All WebSocket / reconnect logic is UNCHANGED ──────────────────────────────

export default function SpectatePage({ params }: Props) {
  const [observation, setObservation] = useState<SpectatorObservation | null>(null)
  const [characterId, setCharacterId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [statusMessage, setStatusMessage] = useState("Connecting to live realm...")
  const [error, setError] = useState<string | null>(null)
  const [endedReason, setEndedReason] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const retryCountRef = useRef(0)
  const endedReasonRef = useRef<string | null>(null)

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
    setStatusMessage("Reconnecting to live realm...")
    setRetryToken((v) => v + 1)
  }

  useEffect(() => {
    let cancelled = false

    const connect = (id: string) => {
      if (cancelled) return
      const wsUrl = process.env["NEXT_PUBLIC_WS_URL"] ?? "ws://localhost:3001"
      const ws = new WebSocket(`${wsUrl}/spectate/${id}`)
      wsRef.current = ws
      setStatusMessage(retryCountRef.current > 0 ? "Reconnecting..." : "Connecting to live realm...")

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
        const retryDelay = Math.min(1000 * 2 ** retryCountRef.current, 8000)
        retryCountRef.current += 1
        setStatusMessage("Connection lost. Retrying...")
        reconnectTimerRef.current = window.setTimeout(() => connect(id), retryDelay)
      }

      ws.onerror = () => {
        setError("Unable to reach the spectator feed for this character.")
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
            return
          }
          if (payload.type === "session_ended") {
            setEndedReason(payload.reason)
            endedReasonRef.current = payload.reason
            setConnected(false)
            setStatusMessage("SESSION_ENDED")
            ws.close()
            return
          }
          if (payload.type === "error") {
            setError(payload.message)
            setStatusMessage(payload.message)
          }
        } catch {
          setError("Received malformed spectator data.")
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
  const classLabel = obs ? obs.character.class.toUpperCase() : "???"
  const shortId = characterId ? characterId.slice(0, 8) : "..."

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (!characterId) {
    return (
      <div className="flex h-screen items-center justify-center bg-aw-bg aw-label text-aw-secondary">
        <div className="space-y-2 text-center">
          <div className="aw-headline text-2xl text-aw-primary aw-amber-glow">ARCANE_WATCH</div>
          <div className="text-sm tracking-widest opacity-60">INITIALISING SPECTATOR UPLINK...</div>
        </div>
      </div>
    )
  }

  // ── Full layout ───────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-aw-bg aw-label">

      {/* ── Left sidebar — session meta ────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-60 bg-aw-surface-lowest border-r border-white/5 py-4 overflow-y-auto shrink-0">
        <div className="px-4 mb-6">
          <div className="text-[10px] tracking-[0.2em] text-aw-outline uppercase mb-3">Session Info</div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-aw-outline">Class</span>
              <span className="text-aw-secondary font-medium">{classLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-aw-outline">Level</span>
              <span className="text-aw-on-surface">{obs?.character.level ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-aw-outline">Floor</span>
              <span className="text-aw-on-surface">{obs?.realm_info.current_floor ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-aw-outline">Turn</span>
              <span className="text-aw-on-surface">{obs?.turn ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-aw-outline">Realm</span>
              <span className="text-aw-on-surface truncate max-w-[100px] text-right">
                {obs?.realm_info.template_name ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-aw-outline">Status</span>
              <span className="text-aw-on-surface capitalize">
                {obs?.realm_info.status.replaceAll("_", " ") ?? "—"}
              </span>
            </div>
          </div>
        </div>

        <div className="px-4 mb-4">
          <div className="text-[10px] tracking-[0.2em] text-aw-outline uppercase mb-3">Visible Threats</div>
          {enemies.length === 0 ? (
            <p className="text-xs text-aw-outline italic">No enemies visible.</p>
          ) : (
            <div className="space-y-2">
              {enemies.map((e) => (
                <div key={e.id} className="border-l-2 border-aw-secondary/40 pl-2 py-1">
                  <div className="text-xs text-aw-on-surface font-medium">{e.name}</div>
                  <div className="text-[10px] text-aw-outline capitalize">{e.health_indicator ?? "unknown"} HP</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-auto px-4 space-y-2">
          <button
            type="button"
            onClick={requestReconnect}
            className="w-full py-2 text-xs tracking-widest uppercase border border-aw-secondary/30 text-aw-secondary hover:bg-aw-secondary/10 transition-colors"
          >
            Reconnect Feed
          </button>
          <Link
            href="/spectate"
            className="block w-full py-2 text-center text-xs tracking-widest uppercase border border-white/10 text-aw-outline hover:text-aw-on-surface hover:border-white/20 transition-colors"
          >
            All Live Runs
          </Link>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-y-auto bg-aw-surface p-4 gap-4 relative">

        {/* Header bar */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="aw-headline text-aw-primary aw-amber-glow text-xl md:text-2xl">
              NOW SPECTATING: {classLabel}
            </h2>
            <p className="text-aw-secondary text-xs tracking-widest mt-0.5 opacity-80 uppercase">
              ID: {shortId}... // {statusMessage}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {endedReason ? (
              <span className="text-xs px-3 py-1 border border-aw-error/40 text-aw-error uppercase tracking-widest">
                SESSION_ENDED: {endedReason}
              </span>
            ) : (
              <span className={`flex items-center gap-2 text-xs px-3 py-1 border tracking-widest uppercase ${
                connected
                  ? "border-aw-secondary/40 text-aw-secondary"
                  : "border-white/10 text-aw-outline"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-aw-secondary animate-pulse" : "bg-aw-outline"}`} />
                {connected ? "LIVE" : "OFFLINE"}
              </span>
            )}
          </div>
        </header>

        {/* Error banner */}
        {error && (
          <div className="flex items-center justify-between gap-3 border border-aw-error/30 bg-aw-error-container/20 px-4 py-2 text-sm text-aw-error">
            <span>&gt;&gt; ERROR: {error}</span>
            <button type="button" onClick={requestReconnect} className="text-xs underline hover:no-underline">
              Retry
            </button>
          </div>
        )}

        {/* Run ended */}
        {endedReason && (
          <div className="border border-aw-primary/20 bg-aw-primary-container/10 p-4">
            <div className="aw-headline text-aw-primary text-sm mb-2">RUN_ENDED // {endedReason.toUpperCase()}</div>
            <div className="flex gap-3 mt-3">
              <button
                type="button"
                onClick={requestReconnect}
                className="px-4 py-2 text-xs bg-aw-primary-container text-aw-on-primary uppercase tracking-widest hover:opacity-90 transition-opacity"
              >
                Retry Connection
              </button>
              {endedReason === "death" && characterId && (
                <Link
                  href={`/legends/${characterId}`}
                  className="px-4 py-2 text-xs border border-aw-outline/40 text-aw-on-surface-variant uppercase tracking-widest hover:border-aw-outline transition-colors"
                >
                  View Legend
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Game feed terminal */}
        <div className={`relative border rounded-sm overflow-hidden ${
          connected ? "border-aw-secondary/30" : "border-white/10"
        }`} style={{ boxShadow: connected ? "0 0 40px rgba(118,211,244,0.06)" : "none" }}>

          {/* Corner brackets */}
          <div className="absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-aw-secondary/40 pointer-events-none z-10" />
          <div className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-aw-secondary/40 pointer-events-none z-10" />
          <div className="absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-aw-secondary/40 pointer-events-none z-10" />
          <div className="absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-aw-secondary/40 pointer-events-none z-10" />

          {/* Scanline overlay */}
          <div className="aw-scanline absolute inset-0 pointer-events-none z-10 opacity-50" />

          {/* HUD overlays */}
          {obs && (
            <div className="absolute inset-0 p-4 flex flex-col justify-between pointer-events-none z-20">
              <div className="flex justify-between items-start text-xs">
                <div className="space-y-1">
                  <div className="bg-black/60 border-l-2 border-aw-secondary px-2 py-1 text-aw-secondary flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-red-400 animate-pulse" : "bg-aw-outline"}`} />
                    {statusMessage}
                  </div>
                  <div className="bg-black/60 px-2 py-1 text-aw-secondary">
                    HP: {obs.character.hp_percent}%
                  </div>
                  <div className="bg-black/60 px-2 py-1 text-aw-secondary">
                    RESOURCE: {obs.character.resource_percent}%
                  </div>
                </div>
                <div className="text-right space-y-1">
                  <div className="bg-black/60 px-2 py-1 text-aw-secondary">
                    FLOOR: {obs.realm_info.current_floor}
                  </div>
                  <div className="bg-black/60 px-2 py-1 text-aw-secondary">
                    TURN: {obs.turn}
                  </div>
                </div>
              </div>

              {obs.recent_events.length > 0 && (
                <div className="text-[10px] text-aw-secondary">
                  <div className="bg-black/50 border border-aw-secondary/20 px-2 py-1 inline-block">
                    <span className="text-aw-primary">&gt;&gt; </span>
                    {obs.recent_events[obs.recent_events.length - 1]?.detail}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Map */}
          <div className="bg-black p-6 min-h-[320px] flex items-center justify-center">
            {obs ? (
              <GameMap
                visibleTiles={obs.visible_tiles}
                playerPosition={obs.position.tile}
                entities={obs.visible_entities}
              />
            ) : (
              <div className="text-aw-secondary/30 text-xs tracking-widest uppercase animate-pulse">
                Awaiting live feed...
              </div>
            )}
          </div>
        </div>

        {/* Room text */}
        {obs?.room_text && (
          <div className="border-l-2 border-aw-primary/40 pl-3 py-1">
            <p className="text-xs text-aw-on-surface-variant italic">{obs.room_text}</p>
          </div>
        )}

        {/* Recent events terminal */}
        <div className="border border-white/5 bg-aw-surface-lowest rounded-sm overflow-hidden">
          <div className="px-3 py-2 bg-aw-surface-container border-b border-white/5 flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-aw-outline">
              RECENT_EVENTS
            </span>
            <button type="button" onClick={requestReconnect} className="text-[10px] text-aw-outline hover:text-aw-on-surface transition-colors">
              SYNC
            </button>
          </div>
          <div className="p-3 space-y-1.5">
            {obs && obs.recent_events.length > 0 ? (
              obs.recent_events.slice(-6).map((event, i, arr) => (
                <div
                  key={`${event.turn}-${i}`}
                  className={`text-xs px-2 py-1 ${
                    i === arr.length - 1
                      ? "border-l-2 border-aw-primary text-aw-on-surface"
                      : "text-aw-on-surface-variant"
                  }`}
                >
                  <span className="text-aw-outline mr-2">T{event.turn}</span>
                  {event.detail}
                </div>
              ))
            ) : (
              <p className="text-xs text-aw-outline italic">Waiting for events...</p>
            )}
          </div>
        </div>
      </main>

      {/* ── Right sidebar — HP/resource bars + entity panel ───────────────── */}
      <aside className="hidden lg:flex flex-col w-56 bg-aw-surface-lowest border-l border-white/5 p-4 gap-5 shrink-0 overflow-y-auto">
        <div>
          <div className="text-[10px] tracking-[0.2em] text-aw-outline uppercase mb-3 aw-headline">
            VITAL_SIGNS
          </div>
          {obs ? (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-[10px] text-aw-outline mb-1">
                  <span>HP</span>
                  <span>{obs.character.hp_percent}%</span>
                </div>
                <div className="h-2 bg-aw-surface-highest rounded-sm overflow-hidden">
                  <div
                    className={`h-full rounded-sm transition-all duration-500 ${
                      obs.character.hp_percent < 25 ? "bg-aw-error" : "bg-green-500"
                    }`}
                    style={{ width: `${obs.character.hp_percent}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-aw-outline mb-1">
                  <span>RESOURCE</span>
                  <span>{obs.character.resource_percent}%</span>
                </div>
                <div className="h-2 bg-aw-surface-highest rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-aw-secondary rounded-sm transition-all duration-500"
                    style={{ width: `${obs.character.resource_percent}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-aw-surface-container p-2">
                  <div className="text-aw-outline">CLASS</div>
                  <div className="text-aw-secondary mt-0.5 font-medium capitalize">{obs.character.class}</div>
                </div>
                <div className="bg-aw-surface-container p-2">
                  <div className="text-aw-outline">LEVEL</div>
                  <div className="text-aw-primary mt-0.5 font-medium">{obs.character.level}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="h-2 bg-aw-surface-container rounded-sm animate-pulse" />
              <div className="h-2 bg-aw-surface-container rounded-sm animate-pulse" />
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] tracking-[0.2em] text-aw-outline uppercase mb-3 aw-headline">
            ENTITY_FEED
          </div>
          {obs && obs.visible_entities.length > 0 ? (
            <div className="space-y-2">
              {obs.visible_entities.slice(0, 8).map((e) => (
                <div key={e.id} className="bg-aw-surface-container p-2 text-[10px]">
                  <div className="flex justify-between gap-1">
                    <span className={`font-medium truncate ${
                      e.type === "enemy" ? "text-aw-error" : "text-aw-on-surface-variant"
                    }`}>{e.name}</span>
                    <span className="text-aw-outline capitalize shrink-0">{e.type}</span>
                  </div>
                  {e.type === "enemy" && e.health_indicator && (
                    <div className="text-aw-outline mt-0.5 capitalize">{e.health_indicator} HP</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-aw-outline italic">No entities in view.</p>
          )}
        </div>

        <div className="mt-auto">
          <button
            type="button"
            onClick={requestReconnect}
            className="w-full py-3 text-[10px] tracking-widest uppercase border border-aw-secondary/30 text-aw-secondary hover:bg-aw-secondary/10 transition-colors"
          >
            INITIALIZE_UPLINK
          </button>
        </div>
      </aside>
    </div>
  )
}
