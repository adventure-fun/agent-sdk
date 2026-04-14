"use client"

import { useRef, useEffect } from "react"
import type { Tile, Entity, SpectatorEntity, CharacterClass, GameEvent } from "@adventure-fun/schemas"
import { TILE_SIZE } from "./sprite-registries"
import { DungeonRenderer } from "./dungeon-renderer"

const MAX_ROOM_TILES = 10
const CANVAS_RESERVED_HEIGHT_PX = MAX_ROOM_TILES * TILE_SIZE

interface PixiJSWorldProps {
  visibleTiles: Tile[]
  knownTiles?: Tile[]
  playerPosition: { x: number; y: number }
  playerHpPercent?: number
  entities: (Entity | SpectatorEntity)[]
  realmTemplateId?: string
  playerClass?: CharacterClass
  recentEvents?: GameEvent[]
  turn?: number
}

export function PixiJSWorld({
  visibleTiles,
  knownTiles = [],
  playerPosition,
  playerHpPercent,
  entities,
  realmTemplateId,
  playerClass,
  recentEvents = [],
  turn = 0,
}: PixiJSWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<DungeonRenderer | null>(null)

  // Always reserve enough height for the tallest room in the content
  // library (see CANVAS_RESERVED_HEIGHT_PX). This stops the dungeon
  // viewport from collapsing when the player walks into a small room,
  // which previously yanked the room text + d-pad upward and made the
  // controls feel like they were jumping around the screen.
  const mapHeight = CANVAS_RESERVED_HEIGHT_PX

  // Init renderer once, destroy on unmount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new DungeonRenderer()
    rendererRef.current = renderer
    renderer.init(container, playerClass)
    return () => {
      renderer.destroy()
      rendererRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push prop changes to the renderer
  useEffect(() => {
    rendererRef.current?.update({
      visibleTiles,
      knownTiles,
      playerPosition,
      playerHpPercent,
      entities,
      recentEvents,
      turn,
    })
  }, [visibleTiles, knownTiles, playerPosition, playerHpPercent, entities, recentEvents, turn])

  // Load enemy spritesheets when realm changes
  useEffect(() => {
    if (realmTemplateId) {
      rendererRef.current?.loadRealmEnemies(realmTemplateId)
    }
  }, [realmTemplateId])

  return (
    <div
      ref={containerRef}
      style={{ height: mapHeight }}
      className="w-full rounded overflow-hidden"
    />
  )
}
