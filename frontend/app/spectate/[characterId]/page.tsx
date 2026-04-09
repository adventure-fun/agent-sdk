"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import type { SpectatorObservation } from "@adventure-fun/schemas"
import { AsciiMap } from "../../components/ascii-map"

interface Props {
  params: Promise<{ characterId: string }>
}

export default function SpectatePage({ params }: Props) {
  const [observation, setObservation] = useState<SpectatorObservation | null>(null)
  const [characterId, setCharacterId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [statusMessage, setStatusMessage] = useState("Connecting to live realm...")
  const [error, setError] = useState<string | null>(null)
  const [endedReason, setEndedReason] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const retryCountRef = useRef(0)
  const endedReasonRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const connect = (id: string) => {
      if (cancelled) return

      const wsUrl = process.env["NEXT_PUBLIC_WS_URL"] ?? "ws://localhost:3001"
      const ws = new WebSocket(`${wsUrl}/spectate/${id}`)
      wsRef.current = ws
      setStatusMessage(retryCountRef.current > 0 ? "Reconnecting to the live feed..." : "Connecting to live realm...")

      ws.onopen = () => {
        retryCountRef.current = 0
        endedReasonRef.current = null
        setConnected(true)
        setError(null)
        setEndedReason(null)
        setStatusMessage("Live spectator feed connected.")
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
            setStatusMessage("Watching live.")
            return
          }

          if (payload.type === "session_ended") {
            setEndedReason(payload.reason)
            endedReasonRef.current = payload.reason
            setConnected(false)
            setStatusMessage("This run has ended.")
            ws.close()
            return
          }

          if (payload.type === "error") {
            setError(payload.message)
            setStatusMessage(payload.message)
          }
        } catch {
          setError("Received malformed spectator data.")
          setStatusMessage("The spectator feed returned unreadable data.")
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
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
      }
      wsRef.current?.close()
    }
  }, [params])

  if (!characterId) return null

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 via-black to-gray-950 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Spectator Mode</p>
            <h1 className="text-2xl font-bold text-amber-400">
              {observation ? `Watching ${observation.character.class.toUpperCase()}` : "Awaiting Live Run"}
            </h1>
            <p className="text-sm text-gray-400">{statusMessage}</p>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
            connected ? "bg-green-900/50 text-green-300" : "bg-gray-800 text-gray-400"
          }`}>
            <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse bg-green-400" : "bg-gray-500"}`} />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {endedReason && characterId ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
            <h2 className="text-lg font-bold text-amber-300">Run Ended</h2>
            <p className="mt-2 text-sm text-gray-400">
              This session ended due to <span className="text-gray-200">{endedReason}</span>.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded bg-amber-500 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-amber-400"
              >
                Retry Connection
              </button>
              <Link
                href={`/legends/${characterId}`}
                className="rounded border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:border-gray-500"
              >
                View Legend Page
              </Link>
            </div>
          </div>
        ) : null}

        {observation ? (
          <div className="grid gap-4 xl:grid-cols-[1.6fr_0.9fr]">
            <div className="rounded-2xl border border-gray-800 bg-gray-950 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-400">
                <div>
                  Floor {observation.realm_info.current_floor} · Room {observation.position.room_id}
                </div>
                <div>Turn {observation.turn}</div>
              </div>
              <AsciiMap
                visibleTiles={observation.visible_tiles}
                playerPosition={observation.position.tile}
                entities={observation.visible_entities}
              />
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 space-y-4">
                <div>
                  <div className="text-xs uppercase text-gray-500">Level</div>
                  <div className="text-xl font-bold text-amber-300">{observation.character.level}</div>
                </div>

                <div>
                  <div className="mb-1 text-xs uppercase text-gray-500">HP</div>
                  <div className="h-3 overflow-hidden rounded-full bg-gray-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        observation.character.hp_percent < 25 ? "bg-red-500" : "bg-green-500"
                      }`}
                      style={{ width: `${observation.character.hp_percent}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{observation.character.hp_percent}%</div>
                </div>

                <div>
                  <div className="mb-1 text-xs uppercase text-gray-500">Resource</div>
                  <div className="h-3 overflow-hidden rounded-full bg-gray-800">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${observation.character.resource_percent}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{observation.character.resource_percent}%</div>
                </div>

                <div className="grid gap-2 text-xs text-gray-400 sm:grid-cols-2">
                  <div className="rounded border border-gray-800 bg-gray-950/60 p-3">
                    <div className="text-gray-500">Realm</div>
                    <div className="font-semibold text-gray-200">{observation.realm_info.template_name}</div>
                  </div>
                  <div className="rounded border border-gray-800 bg-gray-950/60 p-3">
                    <div className="text-gray-500">Status</div>
                    <div className="font-semibold capitalize text-gray-200">{observation.realm_info.status.replaceAll("_", " ")}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Visible Threats</div>
                <div className="space-y-2">
                  {observation.visible_entities.filter((entity) => entity.type === "enemy").length === 0 ? (
                    <p className="text-sm text-gray-500">No enemies currently visible.</p>
                  ) : (
                    observation.visible_entities
                      .filter((entity) => entity.type === "enemy")
                      .map((entity) => (
                        <div key={entity.id} className="rounded border border-gray-800 bg-gray-950/60 p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-gray-100">{entity.name}</span>
                            <span className="text-xs capitalize text-gray-500">
                              {entity.health_indicator ?? "unknown"} health
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            ({entity.position.x}, {entity.position.y})
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 xl:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500">Recent Events</div>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="text-xs text-gray-500 transition-colors hover:text-gray-300"
                >
                  Refresh
                </button>
              </div>
              {observation.recent_events.length > 0 ? (
                <div className="space-y-2">
                  {observation.recent_events.slice(-8).map((event, index) => (
                    <div key={`${event.turn}-${index}`} className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2 text-sm text-gray-300">
                      <span className="mr-2 text-xs text-gray-500">T{event.turn}</span>
                      {event.detail}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Waiting for the next noteworthy event...</p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-8 text-center text-gray-500">
            {error ?? "Waiting for game data..."}
          </div>
        )}
      </div>
    </main>
  )
}
