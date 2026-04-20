import type { Action, Observation } from "../protocol.js"
import type {
  AgentContext,
  AgentModule,
  EncounteredDoor,
  ModuleRecommendation,
} from "./index.js"
import { bfsStep } from "./bfs.js"

const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

const KEY_NAME_PATTERN = /\bkey\b/i

/**
 * Per-context bookkeeping of (door targetId, key template_id) pairs we've already probed.
 * Prevents infinite re-probing when a held key turns out NOT to fit a visible locked door.
 * Lives in a WeakMap so we don't pollute MapMemory.
 */
const probedPairsByContext = new WeakMap<AgentContext, Set<string>>()
function getProbedPairs(context: AgentContext): Set<string> {
  let s = probedPairsByContext.get(context)
  if (!s) {
    s = new Set()
    probedPairsByContext.set(context, s)
  }
  return s
}
function pairKey(targetId: string, templateId: string): string {
  return `${targetId}::${templateId}`
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
      // Probe-on-sight fallback: when we hold a key-like item AND a visible locked door
      // hasn't yet revealed its required template id, take one interact attempt to learn
      // the requirement. interact_blocked will populate `requiredKeyTemplateId` and the
      // matched-key path above takes over on subsequent turns.
      const probe = tryProbeUnknownLockedDoor(observation, context, doors)
      if (probe) return probe
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

/**
 * When the agent holds any key-like item, try to interact with a visible+adjacent locked door
 * whose `requiredKeyTemplateId` we don't know yet. Each (door, key) pair is attempted at most
 * once per AgentContext lifetime to avoid infinite re-probing of mismatched pairs.
 * Returns a recommendation with confidence 0.92, or null if no probe is possible.
 */
function tryProbeUnknownLockedDoor(
  observation: Observation,
  context: AgentContext,
  doors: Map<string, EncounteredDoor>,
): ModuleRecommendation | null {
  const heldKeyTemplateIds: string[] = []
  for (const slot of observation.inventory) {
    if (KEY_NAME_PATTERN.test(slot.name) || /-key$/i.test(slot.template_id)) {
      heldKeyTemplateIds.push(slot.template_id)
    }
  }
  if (heldKeyTemplateIds.length === 0) return null

  const probed = getProbedPairs(context)
  const currentFloor = observation.position.floor

  for (const door of doors.values()) {
    if (!door.isBlocked) continue
    if (door.requiredKeyTemplateId) continue
    if (door.floor !== currentFloor) continue
    const visibleEntity = observation.visible_entities.find((entity) => entity.id === door.targetId)
    if (!visibleEntity) continue
    const legal = observation.legal_actions.some(
      (action) => action.type === "interact" && action.target_id === door.targetId,
    )
    if (!legal) continue

    for (const keyTemplateId of heldKeyTemplateIds) {
      const key = pairKey(door.targetId, keyTemplateId)
      if (probed.has(key)) continue
      probed.add(key)
      const interactAction: Extract<Action, { type: "interact" }> = {
        type: "interact",
        target_id: door.targetId,
      }
      return {
        suggestedAction: interactAction,
        reasoning: `Probing locked ${door.name ?? door.targetId} with held key ${keyTemplateId} to learn requirement.`,
        confidence: 0.92,
      }
    }
  }
  return null
}

// Re-export for tests that want to exercise BFS in isolation.
export { bfsStep as __bfsStepForTesting }
