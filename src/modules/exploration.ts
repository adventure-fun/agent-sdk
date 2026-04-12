import type { Action, Direction, Observation } from "../protocol.js"
import type { AgentContext, AgentModule, ModuleRecommendation } from "./index.js"

const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"]
const PASSABLE_TILE_TYPES = new Set(["floor", "door", "stairs", "stairs_up", "entrance"])

/**
 * Derive a synthetic room key for a direction from the current room.
 * If the direction was previously discovered as an exit, use a convention like "room-<direction>"
 * that matches how agents track visited destinations.
 */
function directionTargetRoom(
  _currentRoom: string,
  direction: Direction,
  _exits: Direction[] | undefined,
): string {
  return `room-${direction}`
}

export class ExplorationModule implements AgentModule {
  readonly name = "exploration"
  readonly priority = 40

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    this.updateMapMemory(observation, context)

    const moveActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "move" }> => a.type === "move",
    )

    if (COMPLETED_STATUSES.has(observation.realm_info.status)) {
      const portalAction = observation.legal_actions.find((a) => a.type === "use_portal")
      if (portalAction) {
        return {
          suggestedAction: portalAction,
          reasoning: "Realm completed, extracting via portal.",
          confidence: 0.7,
        }
      }
    }

    if (moveActions.length === 0) {
      return { reasoning: "No movement actions available.", confidence: 0 }
    }

    const currentRoom = observation.position.room_id
    const exits = context.mapMemory.discoveredExits.get(currentRoom)

    const bestMove = chooseExplorationMove(observation, context, moveActions)
    if (bestMove) {
      return {
        suggestedAction: bestMove.action,
        reasoning: bestMove.reasoning,
        confidence: bestMove.confidence,
        context: bestMove.context,
      }
    }

    const unexplored = moveActions.filter((a) => {
      const targetRoom = directionTargetRoom(currentRoom, a.direction, exits)
      return !context.mapMemory.visitedRooms.has(targetRoom)
    })
    if (unexplored.length > 0) {
      const chosen = unexplored[0]!
      return {
        suggestedAction: chosen,
        reasoning: `Exploring unexplored direction: ${chosen.direction}.`,
        confidence: 0.35,
      }
    }

    const leastVisited = moveActions[0]!
    return {
      suggestedAction: leastVisited,
      reasoning: `All adjacent areas explored, moving ${leastVisited.direction}.`,
      confidence: exits ? 0.3 : 0.4,
    }
  }

  private updateMapMemory(observation: Observation, context: AgentContext): void {
    const currentPosition = {
      floor: observation.position.floor,
      roomId: observation.position.room_id,
      x: observation.position.tile.x,
      y: observation.position.tile.y,
    }

    const previousAction = context.previousActions.at(-1)?.action
    const previousPosition = context.mapMemory.lastPosition
    if (
      previousAction?.type === "move"
      && previousPosition
      && previousPosition.floor === currentPosition.floor
      && previousPosition.roomId === currentPosition.roomId
      && previousPosition.x === currentPosition.x
      && previousPosition.y === currentPosition.y
    ) {
      const key = stalledMoveKey(currentPosition.roomId, previousAction.direction)
      context.mapMemory.stalledMoves.set(key, (context.mapMemory.stalledMoves.get(key) ?? 0) + 1)
    } else if (previousAction?.type === "move") {
      const key = stalledMoveKey(
        previousPosition?.roomId ?? currentPosition.roomId,
        previousAction.direction,
      )
      context.mapMemory.stalledMoves.delete(key)
    }

    const roomId = observation.position.room_id
    context.mapMemory.visitedRooms.add(roomId)
    context.mapMemory.visitedTiles.add(tileMemoryKey(currentPosition.floor, currentPosition.x, currentPosition.y))

    for (const tile of observation.visible_tiles) {
      const key = `${observation.position.floor}:${tile.x},${tile.y}`
      context.mapMemory.knownTiles.set(key, tile)
    }

    const moveDirections = observation.legal_actions
      .filter((a): a is Extract<Action, { type: "move" }> => a.type === "move")
      .map((a) => a.direction)

    if (moveDirections.length > 0) {
      const existing = context.mapMemory.discoveredExits.get(roomId) ?? []
      const merged = [...new Set([...existing, ...moveDirections])] as Direction[]
      context.mapMemory.discoveredExits.set(roomId, merged)
    }

    context.mapMemory.lastPosition = currentPosition
  }
}

type MoveCandidate = {
  action: Extract<Action, { type: "move" }>
  reasoning: string
  confidence: number
  context: Record<string, unknown>
}

function chooseExplorationMove(
  observation: Observation,
  context: AgentContext,
  moveActions: Array<Extract<Action, { type: "move" }>>,
): MoveCandidate | null {
  if (moveActions.length === 0) {
    return null
  }

  const current = observation.position.tile
  const tileByCoordinate = new Map(
    observation.visible_tiles.map((tile) => [`${tile.x},${tile.y}`, tile] as const),
  )
  const moveCandidates = moveActions.map((action) => {
    const next = nextPosition(current, action.direction)
    const nextTile = tileByCoordinate.get(`${next.x},${next.y}`)
    const stalledCount = context.mapMemory.stalledMoves.get(
      stalledMoveKey(observation.position.room_id, action.direction),
    ) ?? 0
    const visited = context.mapMemory.visitedTiles.has(
      tileMemoryKey(observation.position.floor, next.x, next.y),
    )
    const frontier = isFrontierTile(next, tileByCoordinate)
    const target = selectVisibleTarget(observation, context)
    const distanceGain = target
      ? manhattanDistance(current, target) - manhattanDistance(next, target)
      : 0

    let score = 0
    if (nextTile && PASSABLE_TILE_TYPES.has(nextTile.type)) {
      score += 1
    }
    if (!visited) {
      score += 2.5
    }
    if (frontier) {
      score += 2
    }
    score += distanceGain
    score -= stalledCount * 4

    if (nextTile?.type === "door" || nextTile?.type === "stairs" || nextTile?.type === "stairs_up") {
      score += 2
    }

    return {
      action,
      next,
      nextTile,
      stalledCount,
      visited,
      frontier,
      score,
      target,
    }
  })

  moveCandidates.sort((left, right) => right.score - left.score)
  const best = moveCandidates[0]
  if (!best) {
    return null
  }

  const destinationSummary = best.nextTile
    ? `${best.nextTile.type} at (${best.next.x},${best.next.y})`
    : `unseen tile at (${best.next.x},${best.next.y})`
  const reasonParts = [
    `Exploring ${best.action.direction} toward ${destinationSummary}.`,
    best.frontier ? "This advances toward the visible frontier." : null,
    !best.visited ? "The destination tile has not been visited yet." : null,
    best.stalledCount > 0 ? "This direction was previously stalled, so confidence is reduced." : null,
  ].filter((part): part is string => part !== null)

  return {
    action: best.action,
    reasoning: reasonParts.join(" "),
    confidence: best.stalledCount > 0 ? 0.25 : best.frontier || !best.visited ? 0.72 : 0.45,
    context: {
      destination: destinationSummary,
      frontier: best.frontier,
      visited: best.visited,
      stalledCount: best.stalledCount,
      score: best.score,
      ...(best.target ? { target: best.target } : {}),
    },
  }
}

function selectVisibleTarget(
  observation: Observation,
  context: AgentContext,
): { x: number; y: number } | null {
  const current = observation.position.tile
  const visibleEntities = observation.visible_entities

  const enemy = visibleEntities.find((entity) => entity.type === "enemy")
  if (enemy?.position) {
    return enemy.position
  }

  const item = visibleEntities.find((entity) => entity.type === "item")
  if (item?.position) {
    return item.position
  }

  const interactable = visibleEntities.find((entity) => entity.type === "interactable")
  if (interactable?.position) {
    return interactable.position
  }

  const traversalTile = observation.visible_tiles
    .filter((tile) => tile.type === "door" || tile.type === "stairs" || tile.type === "stairs_up")
    .sort((left, right) => manhattanDistance(current, left) - manhattanDistance(current, right))[0]
  if (traversalTile) {
    return traversalTile
  }

  const frontierTile = observation.visible_tiles
    .filter((tile) => PASSABLE_TILE_TYPES.has(tile.type) && isFrontierTile(tile, new Map(
      observation.visible_tiles.map((candidate) => [`${candidate.x},${candidate.y}`, candidate] as const),
    )))
    .sort((left, right) => manhattanDistance(current, left) - manhattanDistance(current, right))[0]

  if (frontierTile) {
    return frontierTile
  }

  const unvisitedKnownTile = observation.visible_tiles
    .filter((tile) => PASSABLE_TILE_TYPES.has(tile.type))
    .find((tile) => !context.mapMemory.visitedTiles.has(tileMemoryKey(observation.position.floor, tile.x, tile.y)))

  return unvisitedKnownTile ?? null
}

function isFrontierTile(
  tile: { x: number; y: number },
  tileByCoordinate: Map<string, Observation["visible_tiles"][number]>,
): boolean {
  return DIRECTIONS.some((direction) => {
    const neighbor = nextPosition(tile, direction)
    return !tileByCoordinate.has(`${neighbor.x},${neighbor.y}`)
  })
}

function tileMemoryKey(floor: number, x: number, y: number): string {
  return `${floor}:${x},${y}`
}

function stalledMoveKey(roomId: string, direction: Direction): string {
  return `${roomId}:${direction}`
}

function nextPosition(
  position: { x: number; y: number },
  direction: Direction,
): { x: number; y: number } {
  switch (direction) {
    case "up":
      return { x: position.x, y: position.y - 1 }
    case "down":
      return { x: position.x, y: position.y + 1 }
    case "left":
      return { x: position.x - 1, y: position.y }
    case "right":
      return { x: position.x + 1, y: position.y }
  }
}

function manhattanDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
}

