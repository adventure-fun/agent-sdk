import type { Action, Direction, Observation } from "../protocol.js"
import type { AgentContext } from "./index.js"

const PASSABLE_TILE_TYPES = new Set(["floor", "door", "stairs", "stairs_up", "entrance"])
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"]

const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

export interface BfsOptions {
  /** Cap on BFS nodes expanded per call. Default 500. */
  maxNodes?: number
}

/**
 * Returns a `move` action that is the first step of the shortest path from the agent's current
 * tile to `target.{x,y}` on the agent's current floor, using `mapMemory.knownTiles` filtered by
 * `PASSABLE_TILE_TYPES` plus the current visible tiles. Returns null when no path exists within
 * the node budget, when the only move directions needed are not legal, or when the agent cannot
 * move at all.
 *
 * The BFS allows stepping onto the exact target tile even if it has not been scanned yet — this
 * lets callers reach a door or item position that has not been walked past before.
 */
export function bfsStep(
  observation: Observation,
  context: AgentContext,
  target: { x: number; y: number },
  options: BfsOptions = {},
): Extract<Action, { type: "move" }> | null {
  const currentFloor = observation.position.floor
  const start = observation.position.tile

  const legalMoveDirections = new Set(
    observation.legal_actions
      .filter((action): action is Extract<Action, { type: "move" }> => action.type === "move")
      .map((action) => action.direction),
  )
  if (legalMoveDirections.size === 0) return null

  const passable = new Map<string, boolean>()
  for (const [key, tile] of context.mapMemory.knownTiles.entries()) {
    if (!key.startsWith(`${currentFloor}:`)) continue
    passable.set(`${tile.x},${tile.y}`, PASSABLE_TILE_TYPES.has(tile.type))
  }
  for (const tile of observation.visible_tiles) {
    passable.set(`${tile.x},${tile.y}`, PASSABLE_TILE_TYPES.has(tile.type))
  }

  passable.set(`${start.x},${start.y}`, true)

  const visited = new Set<string>()
  visited.add(`${start.x},${start.y}`)

  interface Node {
    x: number
    y: number
    firstStep?: Direction
    distance: number
  }
  const queue: Node[] = [{ x: start.x, y: start.y, distance: 0 }]
  let head = 0

  const maxNodes = options.maxNodes ?? 500
  let processed = 0

  while (head < queue.length && processed < maxNodes) {
    const current = queue[head]!
    head += 1
    processed += 1

    if (current.x === target.x && current.y === target.y && current.firstStep) {
      if (legalMoveDirections.has(current.firstStep)) {
        return { type: "move", direction: current.firstStep }
      }
      return null
    }

    for (const direction of DIRECTIONS) {
      const { dx, dy } = DIRECTION_DELTA[direction]
      const nx = current.x + dx
      const ny = current.y + dy
      const key = `${nx},${ny}`
      if (visited.has(key)) continue
      const isTargetTile = nx === target.x && ny === target.y
      if (!isTargetTile && passable.get(key) !== true) continue
      visited.add(key)
      queue.push({
        x: nx,
        y: ny,
        firstStep: current.firstStep ?? direction,
        distance: current.distance + 1,
      })
    }
  }
  return null
}

/**
 * Returns the shortest-path distance (in tiles) from the agent's current tile to `target`, or
 * `null` if unreachable within the node budget. Useful for scoring candidate targets by proximity
 * without committing to routing there.
 */
export function bfsDistance(
  observation: Observation,
  context: AgentContext,
  target: { x: number; y: number },
  options: BfsOptions = {},
): number | null {
  const currentFloor = observation.position.floor
  const start = observation.position.tile

  if (start.x === target.x && start.y === target.y) {
    return 0
  }

  const passable = new Map<string, boolean>()
  for (const [key, tile] of context.mapMemory.knownTiles.entries()) {
    if (!key.startsWith(`${currentFloor}:`)) continue
    passable.set(`${tile.x},${tile.y}`, PASSABLE_TILE_TYPES.has(tile.type))
  }
  for (const tile of observation.visible_tiles) {
    passable.set(`${tile.x},${tile.y}`, PASSABLE_TILE_TYPES.has(tile.type))
  }
  passable.set(`${start.x},${start.y}`, true)

  const visited = new Set<string>()
  visited.add(`${start.x},${start.y}`)

  interface Node {
    x: number
    y: number
    distance: number
  }
  const queue: Node[] = [{ x: start.x, y: start.y, distance: 0 }]
  let head = 0

  const maxNodes = options.maxNodes ?? 500
  let processed = 0

  while (head < queue.length && processed < maxNodes) {
    const current = queue[head]!
    head += 1
    processed += 1

    if (current.x === target.x && current.y === target.y) {
      return current.distance
    }

    for (const direction of DIRECTIONS) {
      const { dx, dy } = DIRECTION_DELTA[direction]
      const nx = current.x + dx
      const ny = current.y + dy
      const key = `${nx},${ny}`
      if (visited.has(key)) continue
      const isTargetTile = nx === target.x && ny === target.y
      if (!isTargetTile && passable.get(key) !== true) continue
      visited.add(key)
      queue.push({
        x: nx,
        y: ny,
        distance: current.distance + 1,
      })
    }
  }
  return null
}
