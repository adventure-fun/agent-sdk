import type { Tile, TileType } from "@adventure-fun/schemas"

export interface Position {
  x: number
  y: number
}

export interface Room {
  id: string
  width: number
  height: number
  tiles: Tile[][]
}

/**
 * Computes visible tiles from a position using simple raycasting.
 * Walls and closed doors block line of sight.
 */
export function computeVisibleTiles(
  room: Room,
  position: Position,
  radius: number,
): Set<string> {
  const visible = new Set<string>()
  visible.add(tileKey(position))

  const BLOCKING: TileType[] = ["wall"]

  for (let angle = 0; angle < 360; angle += 1) {
    const rad = (angle * Math.PI) / 180
    let x = position.x + 0.5
    let y = position.y + 0.5

    for (let dist = 0; dist < radius; dist += 0.5) {
      const tx = Math.floor(x)
      const ty = Math.floor(y)

      if (tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) break

      const key = tileKey({ x: tx, y: ty })
      visible.add(key)

      const tileRow = room.tiles[ty]
      if (!tileRow) break
      const tile = tileRow[tx]
      if (!tile) break

      if (BLOCKING.includes(tile.type)) break

      x += Math.cos(rad) * 0.5
      y += Math.sin(rad) * 0.5
    }
  }

  return visible
}

/**
 * Returns true if there is an unobstructed line of sight between two positions.
 */
export function hasLineOfSight(
  room: Room,
  from: Position,
  to: Position,
): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2

  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = Math.floor(from.x + dx * t)
    const y = Math.floor(from.y + dy * t)

    if (x === to.x && y === to.y) return true

    const tileRow = room.tiles[y]
    if (!tileRow) return false
    const tile = tileRow[x]
    if (!tile) return false
    if (tile.type === "wall") return false
  }

  return true
}

export function tileKey(pos: Position): string {
  return `${pos.x},${pos.y}`
}

export function parseTileKey(key: string): Position {
  const [x, y] = key.split(",").map(Number)
  if (x === undefined || y === undefined) throw new Error(`Invalid tile key: ${key}`)
  return { x, y }
}

/**
 * Merges a set of newly visible tile keys into the discovered map.
 */
export function mergeDiscoveredTiles(
  existing: Set<string>,
  newly_visible: Set<string>,
): Set<string> {
  const merged = new Set(existing)
  for (const key of newly_visible) {
    merged.add(key)
  }
  return merged
}
