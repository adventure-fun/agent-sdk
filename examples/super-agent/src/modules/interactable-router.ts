import {
  bfsDistance,
  bfsStep,
  type Action,
  type AgentContext,
  type AgentModule,
  type Entity,
  type ModuleRecommendation,
  type Observation,
} from "../../../../src/index.js"

const MAX_BFS_DISTANCE = 18
const MEMORY_TTL_TURNS = 400

/**
 * Persistent record of a non-locked-exit interactable the agent has seen this realm run.
 * Kept in a WeakMap side table so we don't have to fork the SDK's MapMemory type.
 */
interface SeenInteractable {
  id: string
  name: string
  floor: number
  roomId: string
  x: number
  y: number
  lastSeenTurn: number
}

/**
 * Per-AgentContext state keyed by identity. The AgentContext instance is stable across turns
 * within a run, so a WeakMap is the cleanest way to persist interactable memory without
 * polluting the SDK types.
 */
const interactedIdsByContext = new WeakMap<AgentContext, Set<string>>()
const lastKnownTemplateByContext = new WeakMap<AgentContext, string>()
const seenInteractablesByContext = new WeakMap<AgentContext, Map<string, SeenInteractable>>()

/**
 * Priority 86 — sits above TrapHandlingModule (85) and just below HealingModule (95).
 *
 * Handles non-locked-exit `interactable` entities (chests, shrines, sarcophagi, levers, NPCs).
 * The SDK's default pipeline has no coverage for these — they're usually named in `room_text`
 * but the LLM often skips them when the content pack's `text_revisit` says "empty" on return
 * visits, leaving the agent unable to reach a key behind a locked door. This module:
 *
 *   1. Tracks every interactable seen into a WeakMap side table, persisting across turns so
 *      the agent can backtrack to a sarcophagus it walked past four turns ago.
 *   2. Emits `interact` immediately when the action is legal for any un-interacted candidate
 *      (confidence 0.95).
 *   3. BFS-routes toward the closest visible candidate (confidence 0.9).
 *   4. Falls back to a remembered (no-longer-visible) interactable on the current floor when
 *      no visible candidate exists (confidence 0.88).
 *   5. **Locked-door escalation**: when `mapMemory.encounteredDoors` has a blocked door whose
 *      key we don't hold, all confidences are bumped to 0.96 so the hunt for the grant-item
 *      reliably preempts exploration and LLM second-guessing. This is the specific failure
 *      mode on Sunken Crypt — the sarcophagus in `sc-side-vault` grants `crypt-key`, but the
 *      agent walks past without interacting and then bounces off the locked door in
 *      `sc-offering-room` forever.
 */
export class InteractableRouterModule implements AgentModule {
  readonly name = "interactable-router"
  readonly priority = 86

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    if (observation.visible_entities.some((e) => e.type === "enemy")) {
      return idle("Enemies visible; defer to combat.")
    }
    if (
      observation.realm_info.status === "boss_cleared"
      || observation.realm_info.status === "realm_cleared"
    ) {
      return idle("Realm cleared; defer to portal/extraction.")
    }

    // Reset per-realm caches when the realm template changes.
    const currentTemplate = observation.realm_info.template_id
    const lastTemplate = lastKnownTemplateByContext.get(context)
    if (lastTemplate !== currentTemplate) {
      interactedIdsByContext.set(context, new Set())
      seenInteractablesByContext.set(context, new Map())
      lastKnownTemplateByContext.set(context, currentTemplate)
    }

    const interactedIds = interactedIdsByContext.get(context) ?? new Set<string>()
    if (!interactedIdsByContext.has(context)) {
      interactedIdsByContext.set(context, interactedIds)
    }
    const seenInteractables =
      seenInteractablesByContext.get(context) ?? new Map<string, SeenInteractable>()
    if (!seenInteractablesByContext.has(context)) {
      seenInteractablesByContext.set(context, seenInteractables)
    }

    // Ingest the current visible interactables into the persistent cache so we can route back
    // to them later even after they leave the viewport.
    for (const entity of observation.visible_entities) {
      if (entity.type !== "interactable") continue
      if (entity.is_locked_exit === true) continue
      if (interactedIds.has(entity.id)) continue
      seenInteractables.set(entity.id, {
        id: entity.id,
        name: entity.name,
        floor: observation.position.floor,
        roomId: observation.position.room_id,
        x: entity.position.x,
        y: entity.position.y,
        lastSeenTurn: observation.turn,
      })
    }

    // Age out interactables that haven't been seen in a long time (defensive — normally the
    // per-realm reset clears them).
    for (const [id, record] of seenInteractables.entries()) {
      if (observation.turn - record.lastSeenTurn > MEMORY_TTL_TURNS) {
        seenInteractables.delete(id)
      }
    }

    // Locked-door escalation: if any encountered door is blocked and we don't hold a matching
    // key, bump our confidence bands so interactable hunting reliably preempts exploration.
    const escalate = hasBlockedDoorWithMissingKey(observation, context)

    const visibleCandidates = observation.visible_entities.filter((entity) =>
      isActionableInteractable(entity, interactedIds),
    )

    // 1) `interact` is already legal on a visible candidate → take it immediately.
    if (visibleCandidates.length > 0) {
      const legalInteract = observation.legal_actions.find(
        (a): a is Extract<Action, { type: "interact" }> =>
          a.type === "interact"
          && visibleCandidates.some((entity) => entity.id === a.target_id),
      )
      if (legalInteract) {
        interactedIds.add(legalInteract.target_id)
        const entity = visibleCandidates.find((c) => c.id === legalInteract.target_id)
        return {
          suggestedAction: legalInteract,
          reasoning: `Interacting with ${entity?.name ?? legalInteract.target_id}${
            escalate ? " (locked door blocking progress — hunting for key-grant)" : ""
          }.`,
          confidence: escalate ? 0.98 : 0.95,
          context: {
            targetId: legalInteract.target_id,
            escalated: escalate,
          },
        }
      }

      // 2) Visible candidate but not interactable yet — BFS to it.
      const routed = routeToBestInteractable(observation, context, visibleCandidates)
      if (routed) {
        return {
          suggestedAction: routed.step,
          reasoning: `Routing toward ${routed.entity.name} (${routed.distance} tiles, step ${routed.step.direction})${
            escalate ? " — locked door needs its key-grant" : ""
          }.`,
          confidence: escalate ? 0.96 : 0.9,
          context: {
            targetId: routed.entity.id,
            distance: routed.distance,
            escalated: escalate,
            mode: "visible",
          },
        }
      }
    }

    // 3) No visible candidate — fall back to remembered interactables on the current floor.
    //    This is the key fix: the agent walked past the sarcophagus earlier and is now in a
    //    different room; we route back to it.
    const rememberedRouted = routeToRememberedInteractable(
      observation,
      context,
      seenInteractables,
      interactedIds,
    )
    if (rememberedRouted) {
      return {
        suggestedAction: rememberedRouted.step,
        reasoning: `Routing back toward remembered ${rememberedRouted.record.name} in ${rememberedRouted.record.roomId} (${rememberedRouted.distance} tiles, step ${rememberedRouted.step.direction})${
          escalate ? " — locked door needs its key-grant" : ""
        }.`,
        confidence: escalate ? 0.96 : 0.88,
        context: {
          targetId: rememberedRouted.record.id,
          distance: rememberedRouted.distance,
          escalated: escalate,
          mode: "remembered",
        },
      }
    }

    return idle("No actionable interactables visible or remembered.")
  }
}

function routeToBestInteractable(
  observation: Observation,
  context: AgentContext,
  candidates: Entity[],
): { entity: Entity; distance: number; step: Extract<Action, { type: "move" }> } | null {
  let best: { entity: Entity; distance: number; step: Extract<Action, { type: "move" }> } | null =
    null
  for (const entity of candidates) {
    const distance = bfsDistance(observation, context, entity.position)
    if (distance === null || distance > MAX_BFS_DISTANCE) continue
    if (best && distance >= best.distance) continue
    const step = bfsStep(observation, context, entity.position)
    if (!step) continue
    best = { entity, distance, step }
  }
  return best
}

function routeToRememberedInteractable(
  observation: Observation,
  context: AgentContext,
  seen: Map<string, SeenInteractable>,
  interactedIds: Set<string>,
): {
  record: SeenInteractable
  distance: number
  step: Extract<Action, { type: "move" }>
} | null {
  const currentFloor = observation.position.floor
  let best: {
    record: SeenInteractable
    distance: number
    step: Extract<Action, { type: "move" }>
  } | null = null
  for (const record of seen.values()) {
    if (record.floor !== currentFloor) continue
    if (interactedIds.has(record.id)) continue
    const distance = bfsDistance(observation, context, { x: record.x, y: record.y })
    if (distance === null || distance > MAX_BFS_DISTANCE) continue
    if (best && distance >= best.distance) continue
    const step = bfsStep(observation, context, { x: record.x, y: record.y })
    if (!step) continue
    best = { record, distance, step }
  }
  return best
}

/**
 * Returns true when the agent has a remembered blocked door (from `mapMemory.encounteredDoors`)
 * OR a fresh `interact_blocked` event this turn, AND no held inventory item matches any blocked
 * door's `requiredKeyTemplateId`. This flags the "stuck in the sunken crypt" state where the
 * only way forward is finding a grant-item interactable in a room we've already walked past.
 */
function hasBlockedDoorWithMissingKey(observation: Observation, context: AgentContext): boolean {
  const doors = context.mapMemory.encounteredDoors
  const heldTemplates = new Set(observation.inventory.map((slot) => slot.template_id))

  if (doors) {
    for (const door of doors.values()) {
      if (!door.isBlocked) continue
      if (!door.requiredKeyTemplateId) {
        // A door with unknown key requirement — treat as blocked too; we need to hunt.
        return true
      }
      if (!heldTemplates.has(door.requiredKeyTemplateId)) {
        return true
      }
    }
  }

  // Fresh interact_blocked event this turn — escalate even before encounteredDoors populates.
  for (const event of observation.recent_events) {
    if (event.type === "interact_blocked") return true
  }
  return false
}

function idle(reason: string): ModuleRecommendation {
  return { reasoning: reason, confidence: 0 }
}

function isActionableInteractable(entity: Entity, interactedIds: Set<string>): boolean {
  if (entity.type !== "interactable") return false
  if (entity.is_locked_exit === true) return false
  if (interactedIds.has(entity.id)) return false
  return true
}

/** Test hook to seed the "already interacted" set for a given context. */
export function __markInteractedForTests(context: AgentContext, id: string): void {
  const existing = interactedIdsByContext.get(context) ?? new Set<string>()
  existing.add(id)
  interactedIdsByContext.set(context, existing)
}

/** Test hook to seed a remembered interactable for a given context. */
export function __rememberInteractableForTests(
  context: AgentContext,
  record: SeenInteractable,
): void {
  const map = seenInteractablesByContext.get(context) ?? new Map<string, SeenInteractable>()
  map.set(record.id, record)
  seenInteractablesByContext.set(context, map)
}

/** Test hook to clear all per-context state for isolation. */
export function __resetInteractableRouterForTests(context: AgentContext): void {
  interactedIdsByContext.set(context, new Set())
  seenInteractablesByContext.set(context, new Map())
  lastKnownTemplateByContext.delete(context)
}
