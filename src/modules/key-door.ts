import type { Action, Direction, Observation } from "../protocol.js"
import type {
  AgentContext,
  AgentModule,
  EncounteredDoor,
  ModuleRecommendation,
} from "./index.js"

const PASSABLE_TILE_TYPES = new Set(["floor", "door", "stairs", "stairs_up", "entrance"])
const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"]

const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

/**
 * Routes the agent back to a locked door when the matching key is in inventory.
 *
 * Works off `context.mapMemory.encounteredDoors` (populated by the exploration module) and
 * `observation.inventory`. When we hold an item whose `template_id` matches a door's
 * `requiredKeyTemplateId`, we:
 *   - Return an `interact` action if the door entity is visible this turn AND pickup-legal.
 *   - Otherwise return a `move` action that's one BFS step closer to the door's remembered
 *     position, traversing `mapMemory.knownTiles` filtered by `PASSABLE_TILE_TYPES`.
 *
 * The module stays quiet (confidence 0) whenever:
 *   - The realm is cleared (extraction modules take over).
 *   - Enemies are visible (combat takes over).
 *   - No held item matches any pending door's key requirement.
 *   - No reachable path exists through known tiles to the target door.
 */
export class KeyDoorModule implements AgentModule {
  readonly name = "key-door"
  readonly priority = 45

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    if (COMPLETED_STATUSES.has(observation.realm_info.status)) {
      return idle("Realm cleared; KeyDoorModule defers to extraction.")
    }

    const hasEnemies = observation.visible_entities.some((entity) => entity.type === "enemy")
    if (hasEnemies) {
      return idle("Enemies visible; KeyDoorModule defers to combat.")
    }

    const doors = context.mapMemory.encounteredDoors
    if (!doors || doors.size === 0) {
      return idle("No encountered doors in memory.")
    }

    const heldTemplateIds = new Set(observation.inventory.map((slot) => slot.template_id))

    // Find pending (still blocked) doors whose key we currently hold.
    const candidates: EncounteredDoor[] = []
    for (const door of doors.values()) {
      if (!door.isBlocked) continue
      if (!door.requiredKeyTemplateId) continue
      if (!heldTemplateIds.has(door.requiredKeyTemplateId)) continue
      candidates.push(door)
    }
    if (candidates.length === 0) {
      return idle("No held key matches a pending locked door.")
    }

    // Prefer doors on the current floor; then by most recently interacted (freshest context).
    candidates.sort((left, right) => {
      const currentFloor = observation.position.floor
      const leftSameFloor = left.floor === currentFloor ? 0 : 1
      const rightSameFloor = right.floor === currentFloor ? 0 : 1
      if (leftSameFloor !== rightSameFloor) return leftSameFloor - rightSameFloor
      const leftLastInteract = left.interactedTurns.at(-1) ?? left.firstSeenTurn
      const rightLastInteract = right.interactedTurns.at(-1) ?? right.firstSeenTurn
      return rightLastInteract - leftLastInteract
    })

    const target = candidates[0]!

    // If the door is visible right now, take the interact action when it's legal.
    const visibleEntity = observation.visible_entities.find((entity) => entity.id === target.targetId)
    if (visibleEntity) {
      const interactAction: Extract<Action, { type: "interact" }> = {
        type: "interact",
        target_id: target.targetId,
      }
      const legal = observation.legal_actions.some(
        (action) => action.type === "interact" && action.target_id === target.targetId,
      )
      if (legal) {
        return {
          suggestedAction: interactAction,
          reasoning: `Unlocking ${target.name ?? "locked door"} with held key.`,
          confidence: 0.95,
        }
      }
      // Visible but not interactable (not adjacent). Step toward it via BFS through known tiles.
      const step = bfsStep(observation, context, { x: visibleEntity.position.x, y: visibleEntity.position.y })
      if (step) {
        return {
          suggestedAction: step,
          reasoning: `Holding key for ${target.name ?? target.targetId}; stepping ${step.direction} toward it.`,
          confidence: 0.9,
        }
      }
    }

    // Not visible. Route toward the remembered door tile.
    if (target.floor !== observation.position.floor) {
      // Cross-floor routing is not implemented — leave that to strategic planning.
      return idle(
        `Holding key for door on floor ${target.floor}; cross-floor routing not supported here.`,
      )
    }
    const step = bfsStep(observation, context, { x: target.x, y: target.y })
    if (step) {
      return {
        suggestedAction: step,
        reasoning: `Holding key for ${target.name ?? target.targetId} (room ${target.roomId}); routing back, stepping ${step.direction}.`,
        confidence: 0.88,
      }
    }

    return idle("Held key matches a door but no path is visible in known tiles.")
  }
}

function idle(reason: string): ModuleRecommendation {
  return { reasoning: reason, confidence: 0 }
}

function bfsStep(
  observation: Observation,
  context: AgentContext,
  target: { x: number; y: number },
): Extract<Action, { type: "move" }> | null {
  const currentFloor = observation.position.floor
  const start = observation.position.tile

  const legalMoveDirections = new Set(
    observation.legal_actions
      .filter((action): action is Extract<Action, { type: "move" }> => action.type === "move")
      .map((action) => action.direction),
  )
  if (legalMoveDirections.size === 0) return null

  // Build a passability map from SDK-side knownTiles (real tile types) plus the current visible
  // tiles. The SDK memory only holds the current floor's scanned tiles keyed by `${floor}:${x},${y}`.
  const passable = new Map<string, boolean>()
  for (const [key, tile] of context.mapMemory.knownTiles.entries()) {
    if (!key.startsWith(`${currentFloor}:`)) continue
    passable.set(`${tile.x},${tile.y}`, PASSABLE_TILE_TYPES.has(tile.type))
  }
  for (const tile of observation.visible_tiles) {
    passable.set(`${tile.x},${tile.y}`, PASSABLE_TILE_TYPES.has(tile.type))
  }

  // The start tile itself may not be tagged (the agent stands on floor, but passable is derived
  // from tile type). Force it passable so BFS can begin.
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

  const MAX_NODES = 500 // cap cost per turn
  let processed = 0

  while (head < queue.length && processed < MAX_NODES) {
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
      // Allow stepping onto the exact target tile even if we haven't scanned it yet — that's
      // how we reach the door position itself.
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

// Re-export for tests that want to exercise BFS in isolation.
export { bfsStep as __bfsStepForTesting }
