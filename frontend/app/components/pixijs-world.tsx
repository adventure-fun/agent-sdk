"use client"

import { useRef, useEffect, useCallback } from "react"
import type { Tile, Entity, SpectatorEntity } from "@adventure-fun/schemas"
import { Application, Graphics, Text, TextStyle, Container } from "pixi.js"

const TILE_SIZE = 24

const COLORS: Record<string, number> = {
  wall: 0x3b3b3b,
  floor: 0x1a1a2e,
  door: 0x8b6914,
  stairs: 0x4a90d9,
  stairs_up: 0x4a90d9,
  entrance: 0x4a90d9,
}

const COLORS_DIM: Record<string, number> = {
  wall: 0x2a2a2a,
  floor: 0x111122,
  door: 0x5a4510,
  stairs: 0x2e5a8a,
  stairs_up: 0x2e5a8a,
  entrance: 0x2e5a8a,
}

const ENTITY_COLORS: Record<string, number> = {
  enemy: 0xe74c3c,
  boss: 0xff2222,
  item: 0xf1c40f,
  interactable: 0xe67e22,
  trap_visible: 0x9b59b6,
}

const PLAYER_COLOR = 0x2ecc71

interface PixiJSWorldProps {
  visibleTiles: Tile[]
  knownTiles?: Tile[]
  playerPosition: { x: number; y: number }
  entities: (Entity | SpectatorEntity)[]
}

export function PixiJSWorld({
  visibleTiles,
  knownTiles = [],
  playerPosition,
  entities,
}: PixiJSWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const initPromiseRef = useRef<Promise<void> | null>(null)

  const draw = useCallback(
    (app: Application) => {
      // Remove previous children
      app.stage.removeChildren()

      const allTiles = [...visibleTiles, ...knownTiles]
      if (allTiles.length === 0) return

      const xs = allTiles.map((t) => t.x)
      const ys = allTiles.map((t) => t.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)

      const mapWidth = (maxX - minX + 1) * TILE_SIZE
      const mapHeight = (maxY - minY + 1) * TILE_SIZE

      // Center the map in the canvas
      const offsetX = Math.max(0, (app.canvas.width - mapWidth) / 2)
      const offsetY = Math.max(0, (app.canvas.height - mapHeight) / 2)

      const world = new Container()
      world.x = offsetX
      world.y = offsetY
      app.stage.addChild(world)

      const visibleSet = new Set(visibleTiles.map((t) => `${t.x},${t.y}`))
      const tileMap = new Map(allTiles.map((t) => [`${t.x},${t.y}`, t]))
      const entityMap = new Map(
        entities.map((e) => [`${e.position.x},${e.position.y}`, e])
      )

      // Draw tiles
      const tileGfx = new Graphics()
      for (const [key, tile] of tileMap) {
        const isVisible = visibleSet.has(key)
        const colors = isVisible ? COLORS : COLORS_DIM
        const color = colors[tile.type] ?? colors.floor
        const px = (tile.x - minX) * TILE_SIZE
        const py = (tile.y - minY) * TILE_SIZE

        tileGfx.rect(px, py, TILE_SIZE, TILE_SIZE).fill(color)

        // Wall top highlight for depth
        if (tile.type === "wall") {
          tileGfx
            .rect(px, py, TILE_SIZE, 3)
            .fill(isVisible ? 0x555555 : 0x3a3a3a)
        }

        // Door frame
        if (tile.type === "door") {
          tileGfx
            .rect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4)
            .fill(isVisible ? 0xc9a027 : 0x7a6020)
        }

        // Stairs arrow indicator
        if (
          tile.type === "stairs" ||
          tile.type === "stairs_up" ||
          tile.type === "entrance"
        ) {
          tileGfx
            .rect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8)
            .fill(isVisible ? 0x6ab4f2 : 0x3a6a9e)
        }
      }
      world.addChild(tileGfx)

      // Draw entities (only on visible tiles)
      const entityGfx = new Graphics()
      const labelStyle = new TextStyle({
        fontSize: 10,
        fill: 0xffffff,
        fontFamily: "monospace",
      })

      for (const [key, entity] of entityMap) {
        if (!visibleSet.has(key)) continue

        const px = (entity.position.x - minX) * TILE_SIZE
        const py = (entity.position.y - minY) * TILE_SIZE
        const cx = px + TILE_SIZE / 2
        const cy = py + TILE_SIZE / 2

        const isBoss = "is_boss" in entity && entity.is_boss
        const color = isBoss
          ? ENTITY_COLORS.boss
          : ENTITY_COLORS[entity.type] ?? 0xaaaaaa

        if (entity.type === "enemy") {
          // Diamond shape for enemies
          entityGfx
            .moveTo(cx, py + 4)
            .lineTo(px + TILE_SIZE - 4, cy)
            .lineTo(cx, py + TILE_SIZE - 4)
            .lineTo(px + 4, cy)
            .closePath()
            .fill(color)
          if (isBoss) {
            entityGfx.circle(cx, cy, 3).fill(0xffffff)
          }
        } else if (entity.type === "item") {
          // Small square for items
          entityGfx
            .rect(px + 6, py + 6, TILE_SIZE - 12, TILE_SIZE - 12)
            .fill(color)
        } else if (entity.type === "interactable") {
          // Exclamation label
          const label = new Text({ text: "!", style: labelStyle })
          label.x = cx - label.width / 2
          label.y = cy - label.height / 2
          world.addChild(label)
          entityGfx.circle(cx, cy, 8).fill(color ?? 0xaaaaaa)
        } else if (entity.type === "trap_visible") {
          // Triangle for traps
          entityGfx
            .moveTo(cx, py + 5)
            .lineTo(px + TILE_SIZE - 5, py + TILE_SIZE - 5)
            .lineTo(px + 5, py + TILE_SIZE - 5)
            .closePath()
            .fill(color)
        }
      }
      world.addChild(entityGfx)

      // Draw player
      const playerGfx = new Graphics()
      const ppx = (playerPosition.x - minX) * TILE_SIZE
      const ppy = (playerPosition.y - minY) * TILE_SIZE
      const pcx = ppx + TILE_SIZE / 2
      const pcy = ppy + TILE_SIZE / 2

      // Glow
      playerGfx.circle(pcx, pcy, TILE_SIZE / 2).fill(PLAYER_COLOR)
      // Body
      playerGfx.circle(pcx, pcy, TILE_SIZE / 3).fill(PLAYER_COLOR)
      world.addChild(playerGfx)
    },
    [visibleTiles, knownTiles, playerPosition, entities]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        const app = new Application()
        await app.init({
          background: 0x0a0a0a,
          resizeTo: container,
          antialias: true,
        })
        container.appendChild(app.canvas)
        appRef.current = app
        draw(app)
      })()
    } else {
      initPromiseRef.current.then(() => {
        if (appRef.current) draw(appRef.current)
      })
    }

    return () => {
      // Cleanup only on unmount — we let the init promise ref guard against double-init
    }
  }, [draw])

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      if (appRef.current) {
        appRef.current.destroy(true)
        appRef.current = null
        initPromiseRef.current = null
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="w-full aspect-square max-h-[500px] rounded overflow-hidden"
    />
  )
}
