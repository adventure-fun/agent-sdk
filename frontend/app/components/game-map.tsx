"use client"

import { useState, lazy, Suspense } from "react"
import type { Tile, Entity, SpectatorEntity } from "@adventure-fun/schemas"
import { AsciiMap } from "./ascii-map"

const PixiJSWorld = lazy(() =>
  import("./pixijs-world").then((m) => ({ default: m.PixiJSWorld }))
)

interface GameMapProps {
  visibleTiles: Tile[]
  knownTiles?: Tile[]
  playerPosition: { x: number; y: number }
  entities: (Entity | SpectatorEntity)[]
}

export function GameMap(props: GameMapProps) {
  const [mode, setMode] = useState<"ascii" | "2d">("2d")

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Map</span>
        <div className="flex rounded border border-gray-700 overflow-hidden text-[11px]">
          <button
            onClick={() => setMode("ascii")}
            className={`px-2 py-0.5 ${mode === "ascii" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"}`}
          >
            ASCII
          </button>
          <button
            onClick={() => setMode("2d")}
            className={`px-2 py-0.5 ${mode === "2d" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"}`}
          >
            2D
          </button>
        </div>
      </div>
      {mode === "ascii" ? (
        <AsciiMap {...props} />
      ) : (
        <Suspense
          fallback={
            <div className="w-full h-[280px] flex items-center justify-center text-gray-500 text-sm">
              Loading…
            </div>
          }
        >
          <PixiJSWorld {...props} />
        </Suspense>
      )}
    </div>
  )
}
