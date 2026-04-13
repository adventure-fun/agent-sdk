import { hasActionableLootBlockingPostClearExtraction } from "../extraction-loot-gate.js"
import type { Action, Direction, Observation } from "../protocol.js"
import type {
  AgentContext,
  AgentModule,
  EncounteredDoor,
  ModuleRecommendation,
  SeenItem,
} from "./index.js"

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

    const realmTemplate = observation.realm_info.template_name
    if (context.mapMemory.loopTrackTemplate !== realmTemplate) {
      delete context.mapMemory.loopRecentRooms
      delete context.mapMemory.loopDoorCrossings
      delete context.mapMemory.loopEdgeBans
      delete context.mapMemory.unstuckAwayFromEdge
      context.mapMemory.turnsWithoutNewRoom = 0
      context.mapMemory.loopTrackTemplate = realmTemplate
    }
    // Realm-status transition reset: when the realm flips from active to cleared (or any
    // other transition), wipe ping-pong tracking. Stale loopRecentRooms tails from the
    // pre-clear ping-pong otherwise keep firing the post-clear extraction loop-recovery
    // path inside the boss / exit room, where there is no actual loop.
    const currentStatus = observation.realm_info.status
    if (
      context.mapMemory.lastRealmStatus !== undefined
      && context.mapMemory.lastRealmStatus !== currentStatus
    ) {
      delete context.mapMemory.loopRecentRooms
      delete context.mapMemory.loopDoorCrossings
      delete context.mapMemory.loopEdgeBans
      delete context.mapMemory.unstuckAwayFromEdge
      context.mapMemory.turnsWithoutNewRoom = 0
    }
    context.mapMemory.lastRealmStatus = currentStatus
    refreshLoopEdgeBans(observation, context)

    if (!COMPLETED_STATUSES.has(observation.realm_info.status)) {
      delete context.mapMemory.extractionHomingOverrideStreak
      delete context.mapMemory.extractionFloor1ExitPhase
    }

    const entranceRoomId = observation.realm_info.entrance_room_id
    if (
      entranceRoomId
      && observation.position.floor === 1
      && observation.position.room_id === entranceRoomId
    ) {
      delete context.mapMemory.extractionFloor1ExitPhase
    }

    const moveActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "move" }> => a.type === "move",
    )

    let effectiveMoveActions = moveActions

    // Route toward the floor-1 entrance room when either:
    //   (a) the realm objective is met (post-clear extraction), or
    //   (b) HP is critically low and no enemies are visible (low-health retreat).
    // Both cases use the same deterministic routing so strategic replans aren't needed on
    // every turn. Low-HP routing is gated on "no visible enemies" so combat/emergency modules
    // stay in charge during an actual fight.
    const realmCompleted = COMPLETED_STATUSES.has(observation.realm_info.status)
    const hpMax = observation.character.hp.max
    const hpRatio = hpMax > 0 ? observation.character.hp.current / hpMax : 1
    const emergencyHpPercent = context.config.decision?.emergencyHpPercent ?? 0.2
    const hpCritical = hpRatio <= emergencyHpPercent
    const noVisibleEnemies = !observation.visible_entities.some((entity) => entity.type === "enemy")
    const lowHpRetreat = hpCritical && noVisibleEnemies && !realmCompleted
    const shouldRouteToEntrance =
      (realmCompleted || lowHpRetreat)
      && !hasActionableLootBlockingPostClearExtraction(observation)

    if (shouldRouteToEntrance) {
      const retreatAction = observation.legal_actions.find((a) => a.type === "retreat")
      if (retreatAction) {
        return {
          suggestedAction: retreatAction,
          reasoning: lowHpRetreat
            ? `HP critically low (${Math.round(hpRatio * 100)}%); retreating via the dungeon entrance.`
            : "Realm completed; returning to town via the first-floor entrance.",
          confidence: 0.7,
        }
      }
      const homing = chooseHomingTowardsEntrance(observation, context, moveActions)
      if (homing) {
        if (lowHpRetreat && !realmCompleted) {
          return {
            ...homing,
            reasoning: `HP critically low (${Math.round(hpRatio * 100)}%); ${homing.reasoning}`,
          }
        }
        return homing
      }
      if (context.mapMemory.loopEdgeBans?.[observation.position.room_id]) {
        const loopBan = context.mapMemory.loopEdgeBans[observation.position.room_id]!
        const strippedLoop = moveActions.filter((a) => a.direction !== loopBan)
        if (strippedLoop.length > 0) {
          effectiveMoveActions = strippedLoop
        }
      }
      const portalAction = observation.legal_actions.find((a) => a.type === "use_portal")
      const stuckTurns = context.mapMemory.turnsWithoutNewRoom ?? 0
      // Safety valve: if we've spent 30+ turns without entering a new room after clearing,
      // the homing layer has fully failed — take the portal cost and get out.
      if (portalAction && stuckTurns >= 30) {
        return {
          suggestedAction: portalAction,
          reasoning:
            `Realm completed; stuck ${stuckTurns} turns without reaching a new room — extracting via portal.`,
          confidence: 0.9,
        }
      }
      // Low-HP retreat takes the portal too if one is legal — the agent can't afford to walk
      // further into the dungeon looking for visible doors.
      if (portalAction && lowHpRetreat) {
        return {
          suggestedAction: portalAction,
          reasoning: `HP critically low (${Math.round(hpRatio * 100)}%); no walkable route toward the entrance — extracting via portal.`,
          confidence: 0.9,
        }
      }
      const skipAutoPortalForTactical =
        context.config.decision?.extractionPreferLeftBiasExit === true
        && context.mapMemory.extractionFloor1ExitPhase === "reassess"
      if (portalAction && !skipAutoPortalForTactical && realmCompleted) {
        return {
          suggestedAction: portalAction,
          reasoning: "Realm completed; no path toward entrance visible — extracting via portal.",
          confidence: 0.65,
        }
      }
      // Low-HP forced fallback: no retreat, no homing, no portal — pick the first non-stalled,
      // non-backtracking move so we never sit on `wait` waiting for healing that won't come.
      if (lowHpRetreat) {
        const prev = context.previousActions.at(-1)?.action
        const prevDirection = prev?.type === "move" ? prev.direction : null
        const candidates = effectiveMoveActions.filter((action) => {
          if (prevDirection && action.direction === reverseDirection(prevDirection)) {
            return false
          }
          const stalled =
            context.mapMemory.stalledMoves.get(
              stalledMoveKey(observation.position.room_id, action.direction),
            ) ?? 0
          return stalled === 0
        })
        const pick = candidates[0] ?? effectiveMoveActions[0]
        if (pick) {
          return {
            suggestedAction: pick,
            reasoning: `HP critically low (${Math.round(hpRatio * 100)}%); no deterministic retreat route visible — moving ${pick.direction} to escape the current tile (wait does not heal).`,
            confidence: 0.72,
            context: EXTRACTION_HOMING_CONTEXT,
          }
        }
      }
    }

    const navLoopBan = context.mapMemory.loopEdgeBans?.[observation.position.room_id]
    if (navLoopBan) {
      const strippedNav = effectiveMoveActions.filter((a) => a.direction !== navLoopBan)
      if (strippedNav.length > 0) {
        effectiveMoveActions = strippedNav
      }
    }

    if (
      context.config.decision?.extractionPreferLeftBiasExit === true
      && context.mapMemory.extractionFloor1ExitPhase === "reassess"
    ) {
      const prev = context.previousActions.at(-1)?.action
      if (prev?.type === "move" && prev.direction === reverseDirection("left")) {
        const stripped = moveActions.filter((a) => a.direction !== "left")
        if (stripped.length > 0) {
          effectiveMoveActions = stripped
        }
      }
    }

    if (effectiveMoveActions.length === 0) {
      return { reasoning: "No movement actions available.", confidence: 0 }
    }

    const currentRoom = observation.position.room_id
    const exits = context.mapMemory.discoveredExits.get(currentRoom)
    const cameFromDirection = context.mapMemory.lastRoomEntry?.roomId === currentRoom
      ? context.mapMemory.lastRoomEntry.cameFromDirection
      : null

    // East-bias active exploration: symmetric with post-clear west-bias retreat. Only applies
    // during active play when there are no visible enemies (combat module handles combat). The
    // planner has a matching override tier that keeps this recommendation in force across the
    // tactical LLM's replans.
    const hasVisibleEnemies = observation.visible_entities.some((entity) => entity.type === "enemy")
    const activeExploration =
      !COMPLETED_STATUSES.has(observation.realm_info.status) && !hasVisibleEnemies
    if (
      activeExploration
      && context.config.decision?.explorationPreferRightBias === true
    ) {
      const east = chooseEastBiasMove(
        context,
        effectiveMoveActions,
        currentRoom,
        context.mapMemory.loopEdgeBans?.[currentRoom] ?? null,
        "Exploring east (right) by default — realm spines generally run east from the entrance, so stepping right is usually forward progress.",
        0.69,
      )
      if (east) {
        return east
      }
    }

    const bestMove = chooseExplorationMove(observation, context, effectiveMoveActions, cameFromDirection)
    if (bestMove) {
      return {
        suggestedAction: bestMove.action,
        reasoning: bestMove.reasoning,
        confidence: bestMove.confidence,
        context: bestMove.context,
      }
    }

    const unexplored = effectiveMoveActions.filter((a) => {
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

    const leastVisited = effectiveMoveActions[0]!
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

    if (
      previousAction?.type === "move"
      && previousPosition
      && previousPosition.floor === currentPosition.floor
      && previousPosition.roomId !== currentPosition.roomId
    ) {
      context.mapMemory.lastRoomEntry = {
        roomId: currentPosition.roomId,
        cameFromDirection: reverseDirection(previousAction.direction),
      }
    } else if (context.mapMemory.lastRoomEntry?.roomId !== currentPosition.roomId) {
      delete context.mapMemory.lastRoomEntry
    }

    const roomId = observation.position.room_id
    const roomChanged = previousPosition?.roomId !== roomId
    if (roomChanged) {
      appendLoopRoomVisit(context, roomId)
      context.mapMemory.lastRoomChangeTurn = observation.turn
    }
    const isNewRoom = !context.mapMemory.visitedRooms.has(roomId)
    if (isNewRoom) {
      context.mapMemory.turnsWithoutNewRoom = 0
    } else {
      context.mapMemory.turnsWithoutNewRoom = (context.mapMemory.turnsWithoutNewRoom ?? 0) + 1
    }

    const positionChanged =
      !previousPosition
      || previousPosition.floor !== currentPosition.floor
      || previousPosition.roomId !== currentPosition.roomId
      || previousPosition.x !== currentPosition.x
      || previousPosition.y !== currentPosition.y
    if (positionChanged) {
      context.mapMemory.turnsWithoutPositionChange = 0
    } else {
      context.mapMemory.turnsWithoutPositionChange =
        (context.mapMemory.turnsWithoutPositionChange ?? 0) + 1
    }
    context.mapMemory.visitedRooms.add(roomId)
    context.mapMemory.visitedTiles.add(tileMemoryKey(currentPosition.floor, currentPosition.x, currentPosition.y))

    for (const tile of observation.visible_tiles) {
      const key = `${observation.position.floor}:${tile.x},${tile.y}`
      context.mapMemory.knownTiles.set(key, tile)
    }

    updateSeenItems(observation, context)
    updateEncounteredDoors(observation, context)

    const moveDirections = observation.legal_actions
      .filter((a): a is Extract<Action, { type: "move" }> => a.type === "move")
      .map((a) => a.direction)

    if (moveDirections.length > 0) {
      const existing = context.mapMemory.discoveredExits.get(roomId) ?? []
      const merged = [...new Set([...existing, ...moveDirections])] as Direction[]
      context.mapMemory.discoveredExits.set(roomId, merged)
    }

    if (
      previousAction?.type === "move"
      && previousPosition
      && previousPosition.floor === currentPosition.floor
      && previousPosition.roomId !== currentPosition.roomId
    ) {
      const log = context.mapMemory.loopDoorCrossings ?? (context.mapMemory.loopDoorCrossings = [])
      log.push({
        fromRoomId: previousPosition.roomId,
        toRoomId: currentPosition.roomId,
        direction: previousAction.direction,
      })
      if (log.length > 24) {
        log.shift()
      }
    }

    context.mapMemory.lastPosition = currentPosition
  }
}

const EXTRACTION_HOMING_CONTEXT = { extractionHoming: true as const }
const EXPLORATION_HOMING_CONTEXT = { explorationHoming: true as const }

const LOOP_ROOM_HISTORY_CAP = 16

const KEY_ITEM_NAME_PATTERN = /\bkey\b/i

function isLikelyKey(entity: { name: string; template_type?: string }): boolean {
  if (entity.template_type === "key-item") return true
  return KEY_ITEM_NAME_PATTERN.test(entity.name)
}

/**
 * Record every visible item in `mapMemory.seenItems` so downstream modules (key/door routing,
 * stuck recovery) can backtrack to uncollected loot. Entries live until the item is picked up,
 * at which point we prune the last-action target so revisit logic can't loop.
 */
function updateSeenItems(observation: Observation, context: AgentContext): void {
  const seen = context.mapMemory.seenItems ?? (context.mapMemory.seenItems = new Map<string, SeenItem>())

  for (const entity of observation.visible_entities) {
    if (entity.type !== "item") continue
    const existing = seen.get(entity.id)
    const next: SeenItem = {
      itemId: entity.id,
      floor: observation.position.floor,
      roomId: observation.position.room_id,
      x: entity.position.x,
      y: entity.position.y,
      name: entity.name,
      ...(entity.rarity !== undefined ? { rarity: entity.rarity } : {}),
      isLikelyKey: isLikelyKey(entity),
      lastSeenTurn: observation.turn,
    }
    if (!existing || existing.lastSeenTurn < next.lastSeenTurn) {
      seen.set(entity.id, next)
    }
  }

  // Prune pickups. Two complementary signals because neither is perfectly reliable:
  //  (1) `observation.new_item_ids` — entity ids that entered inventory this turn.
  //  (2) Last action was `pickup` AND the target is no longer visible — covers servers that
  //      don't populate new_item_ids or that reassign ids when stacking into inventory.
  for (const id of observation.new_item_ids ?? []) {
    seen.delete(id)
  }
  const lastAction = context.previousActions.at(-1)?.action
  if (lastAction?.type === "pickup") {
    const stillVisible = observation.visible_entities.some((e) => e.id === lastAction.item_id)
    if (!stillVisible) {
      seen.delete(lastAction.item_id)
    }
  }
}

/**
 * Maintain `mapMemory.encounteredDoors` from two signals:
 *   1. Interactables with `is_locked_exit === true` in `visible_entities` (door is still there).
 *   2. `interact_blocked` events in `recent_events` (door condition failed — remember the door
 *      and the required key template id so the KeyDoorModule can route back).
 * Also clears a door when a previous `interact` action succeeds (target no longer visible).
 */
function updateEncounteredDoors(observation: Observation, context: AgentContext): void {
  const doors =
    context.mapMemory.encounteredDoors
    ?? (context.mapMemory.encounteredDoors = new Map<string, EncounteredDoor>())

  // Signal 1: visible locked-exit interactables.
  for (const entity of observation.visible_entities) {
    if (entity.type !== "interactable" || entity.is_locked_exit !== true) continue
    const existing = doors.get(entity.id)
    if (existing) {
      existing.x = entity.position.x
      existing.y = entity.position.y
      existing.floor = observation.position.floor
      existing.roomId = observation.position.room_id
      existing.name = entity.name
      continue
    }
    doors.set(entity.id, {
      targetId: entity.id,
      floor: observation.position.floor,
      roomId: observation.position.room_id,
      x: entity.position.x,
      y: entity.position.y,
      name: entity.name,
      interactedTurns: [],
      firstSeenTurn: observation.turn,
      isBlocked: true,
    })
  }

  // Signal 2: structured `interact_blocked` events.
  for (const event of observation.recent_events) {
    if (event.type !== "interact_blocked") continue
    const data = event.data ?? {}
    const targetId = typeof data.target_id === "string" ? data.target_id : null
    if (!targetId) continue
    const reason = typeof data.reason === "string" ? data.reason : "unknown"
    const requiredTemplateId =
      typeof data.required_template_id === "string" ? data.required_template_id : undefined
    const isLockedExit = data.is_locked_exit === true

    const existing = doors.get(targetId)
    if (existing) {
      if (!existing.interactedTurns.includes(event.turn)) {
        existing.interactedTurns.push(event.turn)
      }
      existing.lastBlockedDetail = event.detail
      if (requiredTemplateId && reason === "missing-item") {
        existing.requiredKeyTemplateId = requiredTemplateId
      }
      existing.isBlocked = true
      continue
    }
    // First time seeing this target — we don't have a position for it unless it's also in
    // visible_entities this turn (handled above). Store what we have; position will get filled
    // in on a future turn when the interactable is in view.
    const visible = observation.visible_entities.find((entity) => entity.id === targetId)
    doors.set(targetId, {
      targetId,
      floor: observation.position.floor,
      roomId: observation.position.room_id,
      x: visible?.position.x ?? observation.position.tile.x,
      y: visible?.position.y ?? observation.position.tile.y,
      ...(visible?.name ? { name: visible.name } : {}),
      ...(requiredTemplateId && reason === "missing-item"
        ? { requiredKeyTemplateId: requiredTemplateId }
        : {}),
      interactedTurns: [event.turn],
      firstSeenTurn: event.turn,
      lastBlockedDetail: event.detail,
      isBlocked: true,
      ...(isLockedExit ? {} : {}),
    })
  }

  // Clear a door when our last action was a successful `interact` on it. Successful interact =
  // target_id no longer appears in visible_entities AND no new interact_blocked event for it.
  const lastAction = context.previousActions.at(-1)?.action
  if (lastAction?.type === "interact") {
    const targetId = lastAction.target_id
    const stillVisible = observation.visible_entities.some((entity) => entity.id === targetId)
    const blockedAgain = observation.recent_events.some(
      (event) =>
        event.type === "interact_blocked"
        && typeof event.data?.target_id === "string"
        && event.data.target_id === targetId,
    )
    if (!stillVisible && !blockedAgain) {
      const existing = doors.get(targetId)
      if (existing) {
        existing.isBlocked = false
      }
    }
  }
}

function isAlternatingTwoRoomTail(roomIds: string[], tailLen: number): boolean {
  if (roomIds.length < tailLen || tailLen < 4 || tailLen % 2 !== 0) {
    return false
  }
  const tail = roomIds.slice(-tailLen)
  const a = tail[0]!
  const b = tail[1]!
  if (a === b) {
    return false
  }
  return tail.every((roomId, index) => roomId === (index % 2 === 0 ? a : b))
}

const SETTLED_IN_ROOM_TURN_THRESHOLD = 4

/**
 * Conservative oscillation check: confirms the alternating-tail pattern AND requires the
 * current room to actually be one of the two looping rooms AND requires the agent to have
 * transitioned rooms recently. Without these guards, stale loopRecentRooms data from before
 * a realm-clear (or from many turns ago) keeps reporting "you're ping-ponging" while the
 * agent has long since settled into one room and is just exploring its interior.
 */
function isCurrentRoomOscillating(
  context: AgentContext,
  currentRoomId: string,
  currentTurn: number,
): boolean {
  const seq = context.mapMemory.loopRecentRooms ?? []
  if (!isAlternatingTwoRoomTail(seq, 4)) return false
  const tail = seq.slice(-4)
  if (tail[0] !== currentRoomId && tail[1] !== currentRoomId) return false
  // If the agent hasn't switched rooms in many turns, the ABAB tail is ancient history.
  // The agent is now wandering inside one room, not actually ping-ponging.
  const lastChange = context.mapMemory.lastRoomChangeTurn
  if (lastChange !== undefined && currentTurn - lastChange > SETTLED_IN_ROOM_TURN_THRESHOLD) {
    return false
  }
  return true
}

function appendLoopRoomVisit(context: AgentContext, roomId: string): void {
  const seq = context.mapMemory.loopRecentRooms ?? (context.mapMemory.loopRecentRooms = [])
  seq.push(roomId)
  if (seq.length > LOOP_ROOM_HISTORY_CAP) {
    seq.shift()
  }
}

function isSurvivalHpLow(observation: Observation, context: AgentContext): boolean {
  const maxHp = observation.character.hp.max
  if (maxHp <= 0) {
    return false
  }
  const ratio = observation.character.hp.current / maxHp
  const threshold = context.config.decision?.emergencyHpPercent ?? 0.2
  return ratio <= threshold
}

function shouldLearnTwoRoomLoopBans(observation: Observation, context: AgentContext): boolean {
  if (isSurvivalHpLow(observation, context)) {
    return true
  }
  if (COMPLETED_STATUSES.has(observation.realm_info.status) && observation.position.floor === 1) {
    return true
  }
  // Active-play stall: if we've spent 6+ turns without entering a new room, treat that as a
  // ping-pong signal so the loop-edge ban learner can kick in. Without this, the east-bias
  // override happily flings the agent back through the same door it just came out of when
  // the realm spine actually runs west (e.g. backtracking to find a key).
  const stuckTurns = context.mapMemory.turnsWithoutNewRoom ?? 0
  return stuckTurns >= 6
}

function refreshLoopEdgeBans(observation: Observation, context: AgentContext): void {
  if (!shouldLearnTwoRoomLoopBans(observation, context)) {
    delete context.mapMemory.loopEdgeBans
    return
  }
  const seq = context.mapMemory.loopRecentRooms
  if (!seq || seq.length < 4 || !isAlternatingTwoRoomTail(seq, 4)) {
    delete context.mapMemory.loopEdgeBans
    return
  }
  // Stale-loop guard: if the agent's current room is NOT part of the alternating pair, the
  // ABAB tail is ancient history (e.g. left over from before a realm clear or after a room
  // breakthrough). Don't apply bans to the current room — it's not actually in the loop.
  const currentRoomId = observation.position.room_id
  const tail = seq.slice(-4)
  if (tail[0] !== currentRoomId && tail[1] !== currentRoomId) {
    delete context.mapMemory.loopEdgeBans
    return
  }
  const a = tail[0]!
  const b = tail[1]!
  const crossings = context.mapMemory.loopDoorCrossings ?? []
  let dirAtoB: Direction | undefined
  let dirBtoA: Direction | undefined
  for (let i = crossings.length - 1; i >= 0; i--) {
    const c = crossings[i]!
    if (c.fromRoomId === a && c.toRoomId === b && dirAtoB === undefined) {
      dirAtoB = c.direction
    }
    if (c.fromRoomId === b && c.toRoomId === a && dirBtoA === undefined) {
      dirBtoA = c.direction
    }
    if (dirAtoB !== undefined && dirBtoA !== undefined) {
      break
    }
  }
  if (dirAtoB !== undefined && dirBtoA !== undefined) {
    context.mapMemory.loopEdgeBans = {
      [a]: dirAtoB,
      [b]: dirBtoA,
    }
  } else {
    delete context.mapMemory.loopEdgeBans
  }
}

/**
 * When `cameFrom` retracing only swaps between two side rooms, skip it and try another exit.
 */
function chooseFloor1HomingBreakoutMove(
  observation: Observation,
  context: AgentContext,
  moveActions: Array<Extract<Action, { type: "move" }>>,
  tileByCoordinate: Map<string, Observation["visible_tiles"][number]>,
  current: { x: number; y: number },
  avoidDirection: Direction,
  loopBan: Direction | null,
): ModuleRecommendation | null {
  const doorMoves = moveActions.filter((a) => {
    if (a.direction === avoidDirection || (loopBan !== null && a.direction === loopBan)) {
      return false
    }
    const next = nextPosition(current, a.direction)
    return tileByCoordinate.get(`${next.x},${next.y}`)?.type === "door"
  })
  if (doorMoves.length > 0) {
    return {
      suggestedAction: doorMoves[0]!,
      reasoning:
        "Realm cleared on floor 1; leaving a two-room ping-pong — using a different doorway toward the entrance room.",
      confidence: 0.63,
      context: EXTRACTION_HOMING_CONTEXT,
    }
  }

  const towardDoor = chooseMoveTowardsNearestPassableTarget(
    observation,
    context,
    moveActions.filter(
      (a) => a.direction !== avoidDirection && (loopBan === null || a.direction !== loopBan),
    ),
    tileByCoordinate,
    current,
    ["door"],
    "Realm cleared on floor 1; avoiding an immediate room-to-room reversal; moving toward another visible doorway.",
    0.6,
  )
  if (towardDoor) {
    return towardDoor
  }

  const nonBack = moveActions.filter(
    (a) => a.direction !== avoidDirection && (loopBan === null || a.direction !== loopBan),
  )
  if (nonBack.length > 0) {
    nonBack.sort((left, right) => {
      const ls =
        context.mapMemory.stalledMoves.get(stalledMoveKey(observation.position.room_id, left.direction)) ?? 0
      const rs =
        context.mapMemory.stalledMoves.get(stalledMoveKey(observation.position.room_id, right.direction)) ?? 0
      return ls - rs
    })
    return {
      suggestedAction: nonBack[0]!,
      reasoning:
        "Realm cleared on floor 1; breaking out of a two-room reversal loop to search for a path to the entrance room.",
      confidence: 0.58,
      context: EXTRACTION_HOMING_CONTEXT,
    }
  }

  return null
}

/**
 * Active-play mirror of `chooseWestBiasMove`: during normal exploration, prefer moving east
 * (`right`) to make forward progress through the realm spine. Returns null if `right` is absent,
 * stalled, loop-banned, or would immediately undo the agent's previous west step.
 */
function chooseEastBiasMove(
  context: AgentContext,
  moveActions: Array<Extract<Action, { type: "move" }>>,
  roomId: string,
  loopBan: Direction | null,
  reasoning: string,
  confidence: number,
): ModuleRecommendation | null {
  const prev = context.previousActions.at(-1)?.action
  const immediateBacktrack =
    prev?.type === "move" && prev.direction === reverseDirection("right")
  if (immediateBacktrack) {
    return null
  }
  const rightMove = moveActions.find((a) => a.direction === "right")
  if (!rightMove) {
    return null
  }
  const rightStalls =
    context.mapMemory.stalledMoves.get(stalledMoveKey(roomId, "right")) ?? 0
  if (rightStalls > 0) {
    return null
  }
  if (loopBan === "right") {
    return null
  }
  return {
    suggestedAction: rightMove,
    reasoning,
    confidence,
    context: EXPLORATION_HOMING_CONTEXT,
  }
}

/**
 * Pure check: can we return a clean "move west" recommendation right now?
 * West is a safe default for retreat on most realm layouts (entrance tends to sit west). Only
 * returns a move if `left` is legal, not stalled, not banned by a known loop edge, and does not
 * immediately undo the agent's previous east step (which would start a door ping-pong).
 */
function chooseWestBiasMove(
  context: AgentContext,
  homingMoves: Array<Extract<Action, { type: "move" }>>,
  roomId: string,
  loopBan: Direction | null,
  reasoning: string,
  confidence: number,
): ModuleRecommendation | null {
  const prev = context.previousActions.at(-1)?.action
  const immediateBacktrack =
    prev?.type === "move" && prev.direction === reverseDirection("left")
  if (immediateBacktrack) {
    return null
  }
  const leftMove = homingMoves.find((a) => a.direction === "left")
  if (!leftMove) {
    return null
  }
  const leftStalls =
    context.mapMemory.stalledMoves.get(stalledMoveKey(roomId, "left")) ?? 0
  if (leftStalls > 0) {
    return null
  }
  if (loopBan === "left") {
    return null
  }
  return {
    suggestedAction: leftMove,
    reasoning,
    confidence,
    context: EXTRACTION_HOMING_CONTEXT,
  }
}

/**
 * When oscillation is detected, the agent usually sits hugging the ping-pong door, so every
 * "nearest door" homing pick puts it right back through that door. This helper forces a move
 * *away from that edge* (preferring the opposite direction, then perpendicular directions toward
 * unvisited / passable tiles) so the agent walks into the room's interior and can see other exits.
 */
function chooseAwayFromEdgeMove(
  observation: Observation,
  context: AgentContext,
  moveActions: Array<Extract<Action, { type: "move" }>>,
  pingPongDirection: Direction,
  tileByCoordinate: Map<string, Observation["visible_tiles"][number]>,
  current: { x: number; y: number },
  loopBan: Direction | null,
): ModuleRecommendation | null {
  const oppositeDirection = reverseDirection(pingPongDirection)
  const cameFromDirection =
    context.mapMemory.lastRoomEntry?.roomId === observation.position.room_id
      ? context.mapMemory.lastRoomEntry.cameFromDirection
      : null
  const roomId = observation.position.room_id

  const candidates = moveActions.filter((a) => {
    if (a.direction === pingPongDirection) return false
    if (cameFromDirection !== null && a.direction === cameFromDirection) return false
    if (loopBan !== null && a.direction === loopBan) return false
    return true
  })
  if (candidates.length === 0) {
    return null
  }

  type Scored = { action: Extract<Action, { type: "move" }>; score: number }
  const scored: Scored[] = candidates.map((action) => {
    const next = nextPosition(current, action.direction)
    const nextTile = tileByCoordinate.get(`${next.x},${next.y}`)
    const isPassable = nextTile ? PASSABLE_TILE_TYPES.has(nextTile.type) : false
    const isUnvisited = !context.mapMemory.visitedTiles.has(
      tileMemoryKey(observation.position.floor, next.x, next.y),
    )
    const stalledCount =
      context.mapMemory.stalledMoves.get(stalledMoveKey(roomId, action.direction)) ?? 0
    let score = 0
    if (action.direction === oppositeDirection) score += 5
    if (isPassable) score += 2
    if (isUnvisited) score += 3
    if (nextTile?.type === "door") score += 1
    score -= stalledCount * 4
    return { action, score }
  })
  scored.sort((left, right) => right.score - left.score)
  const pick = scored[0]
  if (!pick || pick.score <= -4) {
    return null
  }
  return {
    suggestedAction: pick.action,
    reasoning:
      `Realm cleared on floor 1; breaking ping-pong loop by walking away from the ${pingPongDirection} edge so a different exit becomes visible.`,
    confidence: 0.67,
    context: EXTRACTION_HOMING_CONTEXT,
  }
}

/**
 * Find the direction that keeps sending the agent back through the ping-pong door from the
 * current room. Uses the most recent outbound door crossing recorded for this room; falls back to
 * an existing `loopEdgeBans` entry if door-crossing history has rotated out of the buffer.
 */
function findPingPongEdgeDirection(
  context: AgentContext,
  currentRoomId: string,
): Direction | null {
  const crossings = context.mapMemory.loopDoorCrossings ?? []
  for (let i = crossings.length - 1; i >= 0; i--) {
    const c = crossings[i]!
    if (c.fromRoomId === currentRoomId) {
      return c.direction
    }
  }
  const ban = context.mapMemory.loopEdgeBans?.[currentRoomId]
  return ban ?? null
}

type HomingTargetType = "door" | "stairs_up"

/**
 * When the door or stairs are visible but not on an adjacent tile, pick a legal move onto a
 * known passable tile that strictly reduces Manhattan distance to the nearest target. This avoids
 * LLM oscillation on interior floor tiles (e.g. wide boss rooms).
 */
function chooseMoveTowardsNearestPassableTarget(
  observation: Observation,
  context: AgentContext,
  moveActions: Array<Extract<Action, { type: "move" }>>,
  tileByCoordinate: Map<string, Observation["visible_tiles"][number]>,
  current: { x: number; y: number },
  tileTypes: HomingTargetType[],
  reasoning: string,
  confidence: number,
  forbiddenDirections?: ReadonlySet<Direction> | null,
): ModuleRecommendation | null {
  const targets = observation.visible_tiles.filter((tile) => tileTypes.includes(tile.type as HomingTargetType))
  if (targets.length === 0) {
    return null
  }

  let bestTarget = targets[0]!
  let bestDistFromCurrent = manhattanDistance(current, bestTarget)
  for (const tile of targets.slice(1)) {
    const d = manhattanDistance(current, tile)
    if (d < bestDistFromCurrent) {
      bestDistFromCurrent = d
      bestTarget = tile
    }
  }

  if (bestDistFromCurrent === 0) {
    return null
  }

  type Scored = { action: Extract<Action, { type: "move" }>; distAfter: number; stalled: number }
  const scored: Scored[] = []
  for (const action of moveActions) {
    if (forbiddenDirections?.has(action.direction)) {
      continue
    }
    const next = nextPosition(current, action.direction)
    const nextTile = tileByCoordinate.get(`${next.x},${next.y}`)
    if (!nextTile || !PASSABLE_TILE_TYPES.has(nextTile.type)) {
      continue
    }
    const distAfter = manhattanDistance(next, bestTarget)
    if (distAfter >= bestDistFromCurrent) {
      continue
    }
    const stalled =
      context.mapMemory.stalledMoves.get(stalledMoveKey(observation.position.room_id, action.direction)) ?? 0
    scored.push({ action, distAfter, stalled })
  }

  if (scored.length === 0) {
    return null
  }

  scored.sort((left, right) => {
    if (left.distAfter !== right.distAfter) {
      return left.distAfter - right.distAfter
    }
    return left.stalled - right.stalled
  })
  const pick = scored[0]!

  return {
    suggestedAction: pick.action,
    reasoning,
    confidence,
    context: EXTRACTION_HOMING_CONTEXT,
  }
}

/**
 * After a boss/realm clear, `retreat` is only legal on floor 1 in `realm_info.entrance_room_id`.
 * Until then, route toward stairs_up (deeper floors) or retrace doors toward that room.
 */
function chooseHomingTowardsEntrance(
  observation: Observation,
  context: AgentContext,
  moveActions: Array<Extract<Action, { type: "move" }>>,
): ModuleRecommendation | null {
  const entranceId = observation.realm_info.entrance_room_id
  if (!entranceId) {
    return null
  }

  const { floor, room_id: roomId } = observation.position
  if (floor === 1 && roomId === entranceId) {
    return null
  }

  if (moveActions.length === 0) {
    return null
  }

  const tileByCoordinate = new Map(
    observation.visible_tiles.map((tile) => [`${tile.x},${tile.y}`, tile] as const),
  )
  const current = observation.position.tile
  const loopBanAny = context.mapMemory.loopEdgeBans?.[roomId] ?? null
  const movesAvoidLoop =
    loopBanAny ? moveActions.filter((a) => a.direction !== loopBanAny) : moveActions
  const homingMoves = movesAvoidLoop.length > 0 ? movesAvoidLoop : moveActions

  if (floor > 1) {
    const stairUpMoves = homingMoves.filter((a) => {
      const next = nextPosition(current, a.direction)
      return tileByCoordinate.get(`${next.x},${next.y}`)?.type === "stairs_up"
    })
    if (stairUpMoves.length > 0) {
      return {
        suggestedAction: stairUpMoves[0]!,
        reasoning:
          "Realm cleared; taking stairs up toward the surface, then the floor-1 entrance for retreat.",
        confidence: 0.72,
        context: EXTRACTION_HOMING_CONTEXT,
      }
    }

    // e.g. test-dungeon: boss room has no stairs_up — it lives in the floor entrance; walk through doors first.
    const doorMoves = homingMoves.filter((a) => {
      const next = nextPosition(current, a.direction)
      return tileByCoordinate.get(`${next.x},${next.y}`)?.type === "door"
    })
    if (doorMoves.length > 0) {
      const cameFrom = context.mapMemory.lastRoomEntry?.roomId === roomId
        ? context.mapMemory.lastRoomEntry.cameFromDirection
        : null
      const preferred =
        cameFrom ? doorMoves.find((a) => a.direction === cameFrom) ?? doorMoves[0] : doorMoves[0]
      return {
        suggestedAction: preferred!,
        reasoning:
          "Realm cleared on a lower floor; moving through a doorway toward the stairs up, then the floor-1 entrance for retreat.",
        confidence: 0.66,
        context: EXTRACTION_HOMING_CONTEXT,
      }
    }

    const towardStairs = chooseMoveTowardsNearestPassableTarget(
      observation,
      context,
      homingMoves,
      tileByCoordinate,
      current,
      ["stairs_up"],
      "Realm cleared; moving toward visible stairs up, then the floor-1 entrance for retreat.",
      0.64,
    )
    if (towardStairs) {
      return towardStairs
    }

    const towardDoorDeep = chooseMoveTowardsNearestPassableTarget(
      observation,
      context,
      homingMoves,
      tileByCoordinate,
      current,
      ["door"],
      "Realm cleared; moving toward a visible doorway to reach stairs up and the surface.",
      0.61,
    )
    if (towardDoorDeep) {
      return towardDoorDeep
    }

    if (context.config.decision?.extractionPreferLeftBiasExit === true) {
      const west = chooseWestBiasMove(
        context,
        homingMoves,
        roomId,
        context.mapMemory.loopEdgeBans?.[roomId] ?? null,
        "Realm cleared on a lower floor; no visible stairs or doors — defaulting to west (stairs-up normally sit to the west of the room spine).",
        0.6,
      )
      if (west) {
        return west
      }
    }
  }

  if (floor === 1 && roomId !== entranceId) {
    const extractionOscillation = isCurrentRoomOscillating(context, roomId, observation.turn)
    const loopBan = context.mapMemory.loopEdgeBans?.[roomId] ?? null

    // Unstuck mode: once a ping-pong has been detected we commit to walking away from the shared
    // door for up to 6 turns (or until we enter a new room). This prevents the "nearest visible
    // door" heuristic from immediately re-picking the same edge door each subsequent turn.
    // ALSO: if the agent has been settled in this room for more than a few turns, the
    // recovery state is stale and should not fire — fall through to normal exploration.
    const lastChange = context.mapMemory.lastRoomChangeTurn
    const settledInRoom =
      lastChange !== undefined
      && observation.turn - lastChange > SETTLED_IN_ROOM_TURN_THRESHOLD
    const activeUnstuck = context.mapMemory.unstuckAwayFromEdge
    if (activeUnstuck) {
      const stale =
        activeUnstuck.roomId !== roomId || observation.turn > activeUnstuck.untilTurn || settledInRoom
      if (stale) {
        delete context.mapMemory.unstuckAwayFromEdge
      } else {
        const away = chooseAwayFromEdgeMove(
          observation,
          context,
          homingMoves,
          activeUnstuck.awayFromDirection,
          tileByCoordinate,
          current,
          loopBan,
        )
        if (away) {
          return away
        }
        delete context.mapMemory.unstuckAwayFromEdge
      }
    }

    if (extractionOscillation) {
      const pingEdge = findPingPongEdgeDirection(context, roomId)
      if (pingEdge) {
        context.mapMemory.unstuckAwayFromEdge = {
          roomId,
          awayFromDirection: pingEdge,
          untilTurn: observation.turn + 6,
        }
        const away = chooseAwayFromEdgeMove(
          observation,
          context,
          homingMoves,
          pingEdge,
          tileByCoordinate,
          current,
          loopBan,
        )
        if (away) {
          return away
        }
      }
    }

    const preferLeftBias = context.config.decision?.extractionPreferLeftBiasExit === true
    if (preferLeftBias && context.mapMemory.extractionFloor1ExitPhase !== "reassess") {
      const west = chooseWestBiasMove(
        context,
        homingMoves,
        roomId,
        loopBan,
        "Realm cleared on floor 1; moving west until that direction is blocked, then reassess with the tactician if still outside the entrance room.",
        0.69,
      )
      if (west) {
        return west
      }
      // Couldn't commit west cleanly — flip to reassess so the tactician takes over. This preserves
      // the historical "don't restart a ping-pong" guard when the only west move would undo the
      // last east step.
      context.mapMemory.extractionFloor1ExitPhase = "reassess"
    }

    const cameFrom = context.mapMemory.lastRoomEntry?.roomId === roomId
      ? context.mapMemory.lastRoomEntry.cameFromDirection
      : null

    if (extractionOscillation && cameFrom) {
      const breakout = chooseFloor1HomingBreakoutMove(
        observation,
        context,
        homingMoves,
        tileByCoordinate,
        current,
        cameFrom,
        loopBan,
      )
      if (breakout) {
        return breakout
      }
    }

    const skipCameFromDuringReassess = context.mapMemory.extractionFloor1ExitPhase === "reassess"

    if (cameFrom && !extractionOscillation && !skipCameFromDuringReassess) {
      const cameFromStalls =
        context.mapMemory.stalledMoves.get(stalledMoveKey(roomId, cameFrom)) ?? 0
      // Breadcrumb matches the last door crossing; if that direction repeatedly fails to move
      // (wall, gate, etc.), do not keep recommending it — fall through to other doors / gradient.
      if (cameFromStalls === 0) {
        const back = homingMoves.find((a) => a.direction === cameFrom)
        if (back) {
          return {
            suggestedAction: back,
            reasoning:
              "Realm cleared on floor 1; retracing toward the entrance room (realm_info.entrance_room_id) to retreat.",
            confidence: 0.68,
            context: EXTRACTION_HOMING_CONTEXT,
          }
        }
      }
    }

    const blockReversalDoor = extractionOscillation && cameFrom

    const doorMoves = homingMoves.filter((a) => {
      if (loopBan !== null && a.direction === loopBan) {
        return false
      }
      if (blockReversalDoor && cameFrom && a.direction === cameFrom) {
        return false
      }
      const next = nextPosition(current, a.direction)
      return tileByCoordinate.get(`${next.x},${next.y}`)?.type === "door"
    })
    if (doorMoves.length > 0) {
      return {
        suggestedAction: doorMoves[0]!,
        reasoning:
          "Realm cleared on floor 1; using a doorway to move closer to the entrance room for retreat.",
        confidence: 0.62,
        context: EXTRACTION_HOMING_CONTEXT,
      }
    }

    let towardDoorMoves = homingMoves
    if (loopBan !== null) {
      towardDoorMoves = towardDoorMoves.filter((a) => a.direction !== loopBan)
    }
    if (blockReversalDoor && cameFrom) {
      towardDoorMoves = towardDoorMoves.filter((a) => a.direction !== cameFrom)
    }
    const towardDoorF1 = chooseMoveTowardsNearestPassableTarget(
      observation,
      context,
      towardDoorMoves,
      tileByCoordinate,
      current,
      ["door"],
      "Realm cleared on floor 1; moving toward a visible doorway to reach the entrance room for retreat.",
      0.61,
    )
    if (towardDoorF1) {
      return towardDoorF1
    }
  }

  return null
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
  cameFromDirection: Direction | null,
): MoveCandidate | null {
  if (moveActions.length === 0) {
    return null
  }

  const loopBan = context.mapMemory.loopEdgeBans?.[observation.position.room_id]
  let workingMoves = loopBan ? moveActions.filter((a) => a.direction !== loopBan) : moveActions
  if (workingMoves.length === 0) {
    workingMoves = moveActions
  }

  const current = observation.position.tile
  const tileByCoordinate = new Map(
    observation.visible_tiles.map((tile) => [`${tile.x},${tile.y}`, tile] as const),
  )
  const target = selectVisibleTarget(observation, context, cameFromDirection)
  const moveCandidates = workingMoves.map((action) => {
    const next = nextPosition(current, action.direction)
    const nextTile = tileByCoordinate.get(`${next.x},${next.y}`)
    const stalledCount = context.mapMemory.stalledMoves.get(
      stalledMoveKey(observation.position.room_id, action.direction),
    ) ?? 0
    const visited = context.mapMemory.visitedTiles.has(
      tileMemoryKey(observation.position.floor, next.x, next.y),
    )
    const frontier = isFrontierTile(next, tileByCoordinate)
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
    if (cameFromDirection && workingMoves.length > 1 && action.direction === cameFromDirection) {
      score -= 3
    }

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
  cameFromDirection: Direction | null,
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

  const traversalTileCandidates = observation.visible_tiles
    .filter((tile) => tile.type === "door" || tile.type === "stairs" || tile.type === "stairs_up")
  const preferredTraversalTile = traversalTileCandidates
    .filter((tile) => !isTileInDirection(current, tile, cameFromDirection))
    .sort((left, right) => manhattanDistance(current, left) - manhattanDistance(current, right))[0]
  const traversalTile = preferredTraversalTile
    ?? traversalTileCandidates.sort((left, right) => manhattanDistance(current, left) - manhattanDistance(current, right))[0]
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

function reverseDirection(direction: Direction): Direction {
  switch (direction) {
    case "up":
      return "down"
    case "down":
      return "up"
    case "left":
      return "right"
    case "right":
      return "left"
  }
}

function isTileInDirection(
  current: { x: number; y: number },
  tile: { x: number; y: number },
  direction: Direction | null,
): boolean {
  switch (direction) {
    case "up":
      return tile.y < current.y
    case "down":
      return tile.y > current.y
    case "left":
      return tile.x < current.x
    case "right":
      return tile.x > current.x
    case null:
      return false
  }
}

function manhattanDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
}

