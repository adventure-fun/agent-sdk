import { hasActionableLootBlockingPostClearExtraction } from "../extraction-loot-gate.js"
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

    if (!COMPLETED_STATUSES.has(observation.realm_info.status)) {
      delete context.mapMemory.extractionRecentRooms
      delete context.mapMemory.extractionHomingOverrideStreak
      delete context.mapMemory.extractionFloor1ExitPhase
      delete context.mapMemory.extractionDoorCrossings
      delete context.mapMemory.extractionFloor1LoopBans
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

    if (
      COMPLETED_STATUSES.has(observation.realm_info.status)
      && !hasActionableLootBlockingPostClearExtraction(observation)
    ) {
      const retreatAction = observation.legal_actions.find((a) => a.type === "retreat")
      if (retreatAction) {
        return {
          suggestedAction: retreatAction,
          reasoning: "Realm completed; returning to town via the first-floor entrance.",
          confidence: 0.7,
        }
      }
      const homing = chooseHomingTowardsEntrance(observation, context, moveActions)
      if (homing) {
        return homing
      }
      if (
        observation.position.floor === 1
        && context.mapMemory.extractionFloor1LoopBans?.[observation.position.room_id]
      ) {
        const loopBan = context.mapMemory.extractionFloor1LoopBans[observation.position.room_id]!
        const strippedLoop = moveActions.filter((a) => a.direction !== loopBan)
        if (strippedLoop.length > 0) {
          effectiveMoveActions = strippedLoop
        }
      }
      const portalAction = observation.legal_actions.find((a) => a.type === "use_portal")
      const skipAutoPortalForTactical =
        context.config.decision?.extractionPreferLeftBiasExit === true
        && context.mapMemory.extractionFloor1ExitPhase === "reassess"
      if (portalAction && !skipAutoPortalForTactical) {
        return {
          suggestedAction: portalAction,
          reasoning: "Realm completed; no path toward entrance visible — extracting via portal.",
          confidence: 0.65,
        }
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

    if (
      COMPLETED_STATUSES.has(observation.realm_info.status)
      && observation.position.floor === 1
      && previousAction?.type === "move"
      && previousPosition
      && previousPosition.floor === currentPosition.floor
      && previousPosition.roomId !== currentPosition.roomId
    ) {
      const log =
        context.mapMemory.extractionDoorCrossings ?? (context.mapMemory.extractionDoorCrossings = [])
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

const EXTRACTION_ROOM_HISTORY_CAP = 12

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

function recordExtractionFloor1RoomVisit(context: AgentContext, roomId: string): boolean {
  const seq = context.mapMemory.extractionRecentRooms ?? (context.mapMemory.extractionRecentRooms = [])
  seq.push(roomId)
  if (seq.length > EXTRACTION_ROOM_HISTORY_CAP) {
    seq.shift()
  }
  return isAlternatingTwoRoomTail(seq, 4)
}

function refreshExtractionFloor1LoopBans(observation: Observation, context: AgentContext): void {
  if (!COMPLETED_STATUSES.has(observation.realm_info.status) || observation.position.floor !== 1) {
    delete context.mapMemory.extractionFloor1LoopBans
    return
  }
  const seq = context.mapMemory.extractionRecentRooms
  if (!seq || seq.length < 4 || !isAlternatingTwoRoomTail(seq, 4)) {
    delete context.mapMemory.extractionFloor1LoopBans
    return
  }
  const tail = seq.slice(-4)
  const a = tail[0]!
  const b = tail[1]!
  const crossings = context.mapMemory.extractionDoorCrossings ?? []
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
    context.mapMemory.extractionFloor1LoopBans = {
      [a]: dirAtoB,
      [b]: dirBtoA,
    }
  } else {
    delete context.mapMemory.extractionFloor1LoopBans
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

  if (floor > 1) {
    const stairUpMoves = moveActions.filter((a) => {
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
    const doorMoves = moveActions.filter((a) => {
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
      moveActions,
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
      moveActions,
      tileByCoordinate,
      current,
      ["door"],
      "Realm cleared; moving toward a visible doorway to reach stairs up and the surface.",
      0.61,
    )
    if (towardDoorDeep) {
      return towardDoorDeep
    }
  }

  if (floor === 1 && roomId !== entranceId) {
    const extractionOscillation = recordExtractionFloor1RoomVisit(context, roomId)
    refreshExtractionFloor1LoopBans(observation, context)
    const loopBan = context.mapMemory.extractionFloor1LoopBans?.[roomId] ?? null

    const preferLeftBias = context.config.decision?.extractionPreferLeftBiasExit === true
    if (preferLeftBias && context.mapMemory.extractionFloor1ExitPhase !== "reassess") {
      const prev = context.previousActions.at(-1)?.action
      // After moving east through a door, "west" would immediately walk back — same ping-pong as
      // cameFrom. Treat that as the left-bias dead end and hand off to the tactician.
      const immediateBacktrack =
        prev?.type === "move" && prev.direction === reverseDirection("left")
      const leftMove = moveActions.find((a) => a.direction === "left")
      const leftStalls = leftMove
        ? context.mapMemory.stalledMoves.get(stalledMoveKey(roomId, "left")) ?? 0
        : 1
      if (leftMove && leftStalls === 0 && !immediateBacktrack && loopBan !== "left") {
        return {
          suggestedAction: leftMove,
          reasoning:
            "Realm cleared on floor 1; moving west until that direction is blocked, then reassess with the tactician if still outside the entrance room.",
          confidence: 0.69,
          context: EXTRACTION_HOMING_CONTEXT,
        }
      }
      if (!leftMove || leftStalls > 0 || immediateBacktrack) {
        context.mapMemory.extractionFloor1ExitPhase = "reassess"
      }
    }

    const cameFrom = context.mapMemory.lastRoomEntry?.roomId === roomId
      ? context.mapMemory.lastRoomEntry.cameFromDirection
      : null

    if (extractionOscillation && cameFrom) {
      const breakout = chooseFloor1HomingBreakoutMove(
        observation,
        context,
        moveActions,
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
        const back = moveActions.find((a) => a.direction === cameFrom)
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

    const doorMoves = moveActions.filter((a) => {
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

    let towardDoorMoves = moveActions
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

  const current = observation.position.tile
  const tileByCoordinate = new Map(
    observation.visible_tiles.map((tile) => [`${tile.x},${tile.y}`, tile] as const),
  )
  const target = selectVisibleTarget(observation, context, cameFromDirection)
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
    if (cameFromDirection && moveActions.length > 1 && action.direction === cameFromDirection) {
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

