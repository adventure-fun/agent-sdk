import {
  bfsDistance,
  bfsStep,
  type Action,
  type AgentContext,
  type AgentModule,
  type InventorySlot,
  type ModuleRecommendation,
  type Observation,
} from "../../../../src/index.js"

const MAX_BFS_DISTANCE = 20

const KEY_NAME_PATTERN = /\bkey\b/i
const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

/**
 * Priority 65 — sits above KeyDoorModule (45) and below InteractableRouter (86).
 *
 * Activates when the agent holds a key-like item that does NOT match any remembered blocked
 * door in `mapMemory.encounteredDoors`. This is the "I just got a key from a sarcophagus /
 * chest and I have no idea where the matching door is" scenario — exactly what happens on
 * the first run through Sunken Crypt.
 *
 * When active, the module BFS-routes toward the nearest unvisited frontier tile (known-tile
 * neighbor of an unscanned tile) on the current floor. Confidence is 0.88 so it preempts the
 * default exploration east-bias (0.69) and most tactical LLM replans — the agent can't afford
 * to be randomly drifting while carrying an unused key.
 *
 * This module is intentionally quiet when:
 *   - No key in inventory.
 *   - A remembered blocked door already matches a held key (KeyDoorModule routes there).
 *   - Realm is cleared (extraction routers take over).
 *   - Enemies are visible (combat takes over).
 */
export class KeyHunterModule implements AgentModule {
  readonly name = "key-hunter"
  readonly priority = 65

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    if (COMPLETED_STATUSES.has(observation.realm_info.status)) {
      return idle("Realm cleared; defer to extraction.")
    }
    if (observation.visible_entities.some((e) => e.type === "enemy")) {
      return idle("Enemies visible; defer to combat.")
    }

    const keyTemplates = collectKeyTemplateIds(observation.inventory)
    if (keyTemplates.size === 0) {
      return idle("No key-like items held.")
    }

    // If any held key already matches a remembered blocked door, KeyDoorModule handles it.
    const doors = context.mapMemory.encounteredDoors
    if (doors) {
      for (const door of doors.values()) {
        if (!door.isBlocked) continue
        if (!door.requiredKeyTemplateId) continue
        if (keyTemplates.has(door.requiredKeyTemplateId)) {
          return idle(
            `Held key ${door.requiredKeyTemplateId} matches remembered door ${door.targetId}; defer to KeyDoorModule.`,
          )
        }
      }
    }

    // No match — hunt mode. Route toward the nearest frontier tile (known passable tile with
    // at least one unknown-tile neighbor) on the current floor.
    const frontierStep = stepTowardFrontier(observation, context)
    if (!frontierStep) {
      return idle("Holding an unplaced key but no reachable frontier tile.")
    }

    const heldKeys = Array.from(keyTemplates).join(", ")
    return {
      suggestedAction: frontierStep,
      reasoning: `Holding unplaced key(s) [${heldKeys}]; hunting for the matching locked door — stepping ${frontierStep.direction} toward nearest unexplored frontier.`,
      confidence: 0.88,
      context: { phase: "key-hunt", heldKeys: Array.from(keyTemplates) },
    }
  }
}

function idle(reason: string): ModuleRecommendation {
  return { reasoning: reason, confidence: 0 }
}

function collectKeyTemplateIds(inventory: InventorySlot[]): Set<string> {
  const out = new Set<string>()
  for (const slot of inventory) {
    if (KEY_NAME_PATTERN.test(slot.name) || /-key$/i.test(slot.template_id)) {
      out.add(slot.template_id)
    }
  }
  return out
}

/**
 * Finds the nearest "frontier" tile — a passable known tile that has at least one neighbor
 * which is NOT in our known-tile set (i.e. unexplored). BFS-steps toward it. Returns null when
 * no frontier is reachable from the current position on the current floor.
 */
function stepTowardFrontier(
  observation: Observation,
  context: AgentContext,
): Extract<Action, { type: "move" }> | null {
  const currentFloor = observation.position.floor
  const known = context.mapMemory.knownTiles

  // Build a coordinate-only map of known tile types on the current floor, plus the current
  // observation's visible tiles.
  const knownCoords = new Map<string, string>()
  for (const [key, tile] of known.entries()) {
    if (!key.startsWith(`${currentFloor}:`)) continue
    knownCoords.set(`${tile.x},${tile.y}`, tile.type)
  }
  for (const tile of observation.visible_tiles) {
    knownCoords.set(`${tile.x},${tile.y}`, tile.type)
  }
  if (knownCoords.size === 0) return null

  const passableTypes = new Set(["floor", "door", "stairs", "stairs_up", "entrance"])

  // Find all frontier tiles. A frontier tile is a passable known tile with at least one
  // cardinal neighbor that isn't in our known map.
  const frontiers: Array<{ x: number; y: number }> = []
  for (const [coordKey, type] of knownCoords.entries()) {
    if (!passableTypes.has(type)) continue
    const parts = coordKey.split(",")
    const x = Number(parts[0])
    const y = Number(parts[1])
    const neighbors = [
      { nx: x + 1, ny: y },
      { nx: x - 1, ny: y },
      { nx: x, ny: y + 1 },
      { nx: x, ny: y - 1 },
    ]
    for (const { nx, ny } of neighbors) {
      if (!knownCoords.has(`${nx},${ny}`)) {
        frontiers.push({ x, y })
        break
      }
    }
  }
  if (frontiers.length === 0) return null

  // Pick the closest reachable frontier.
  const currentTile = observation.position.tile
  let best: { coord: { x: number; y: number }; distance: number } | null = null
  for (const coord of frontiers) {
    if (coord.x === currentTile.x && coord.y === currentTile.y) continue
    const distance = bfsDistance(observation, context, coord)
    if (distance === null || distance > MAX_BFS_DISTANCE) continue
    if (!best || distance < best.distance) {
      best = { coord, distance }
    }
  }
  if (!best) return null

  return bfsStep(observation, context, best.coord)
}
