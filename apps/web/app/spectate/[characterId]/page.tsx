"use client"

import { useEffect, useRef, useState } from "react"
import type { SpectatorObservation } from "@adventure-fun/schemas"

interface Props {
  params: Promise<{ characterId: string }>
}

export default function SpectatePage({ params }: Props) {
  const [observation, setObservation] = useState<SpectatorObservation | null>(null)
  const [characterId, setCharacterId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    params.then(({ characterId: id }) => {
      setCharacterId(id)
      const wsUrl = process.env["NEXT_PUBLIC_WS_URL"] ?? "ws://localhost:3001"
      const ws = new WebSocket(`${wsUrl}/spectate/${id}`)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => setConnected(false)
      ws.onmessage = (event) => {
        setObservation(JSON.parse(event.data as string) as SpectatorObservation)
      }
    })

    return () => wsRef.current?.close()
  }, [params])

  if (!characterId) return null

  return (
    <main className="min-h-screen p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-amber-400 font-bold">
            SPECTATING: {observation?.character.class.toUpperCase() ?? "..."}
          </h1>
          <span className={`text-xs px-2 py-1 rounded ${connected ? "bg-green-900 text-green-400" : "bg-gray-800 text-gray-500"}`}>
            {connected ? "LIVE" : "CONNECTING..."}
          </span>
        </div>

        {observation ? (
          <div className="grid grid-cols-3 gap-4">
            {/* Map */}
            <div className="col-span-2 border border-gray-800 rounded p-4 bg-gray-950">
              <pre className="text-xs leading-none font-mono text-gray-400">
                {renderSpectatorMap(observation)}
              </pre>
            </div>

            {/* Status */}
            <div className="border border-gray-800 rounded p-4 space-y-3">
              <div>
                <div className="text-xs text-gray-500 uppercase">Level</div>
                <div className="text-amber-400 font-bold">{observation.character.level}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase mb-1">HP</div>
                <div className="h-2 bg-gray-800 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${observation.character.hp_percent < 25 ? "bg-red-500" : "bg-green-500"}`}
                    style={{ width: `${observation.character.hp_percent}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase mb-1">Resource</div>
                <div className="h-2 bg-gray-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded"
                    style={{ width: `${observation.character.resource_percent}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase">Floor</div>
                <div>{observation.realm_info.current_floor}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase">Turn</div>
                <div>{observation.turn}</div>
              </div>
            </div>

            {/* Events */}
            {observation.recent_events.length > 0 && (
              <div className="col-span-3 border border-gray-800 rounded p-3">
                <div className="text-xs text-gray-500 uppercase mb-2">Recent Events</div>
                {observation.recent_events.slice(-5).map((e, i) => (
                  <div key={i} className="text-sm text-gray-400">&gt; {e.detail}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="border border-gray-800 rounded p-8 text-center text-gray-500">
            Waiting for game data...
          </div>
        )}
      </div>
    </main>
  )
}

function renderSpectatorMap(obs: SpectatorObservation): string {
  const { visible_tiles, position } = obs
  if (visible_tiles.length === 0) return "No map data"

  const xs = visible_tiles.map(t => t.x)
  const ys = visible_tiles.map(t => t.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const tileMap = new Map(visible_tiles.map(t => [`${t.x},${t.y}`, t]))
  const entityMap = new Map(
    obs.visible_entities.map(e => [`${e.position.x},${e.position.y}`, e])
  )

  const rows: string[] = []
  for (let y = minY; y <= maxY; y++) {
    let row = ""
    for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`
      if (x === position.tile.x && y === position.tile.y) {
        row += "@"
      } else if (entityMap.has(key)) {
        const entity = entityMap.get(key)!
        row += entity.type === "enemy" ? "E" : "?"
      } else {
        const tile = tileMap.get(key)
        if (!tile) { row += " "; continue }
        switch (tile.type) {
          case "wall": row += "#"; break
          case "floor": row += "."; break
          case "door": row += "D"; break
          case "stairs": row += ">"; break
          default: row += "."
        }
      }
    }
    rows.push(row)
  }
  return rows.join("\n")
}
