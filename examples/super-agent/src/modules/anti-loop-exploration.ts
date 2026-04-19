import type {
  Action,
  AgentContext,
  AgentModule,
  Direction,
  ModuleRecommendation,
  Observation,
} from "../../../../src/index.js"

/**
 * Priority 42 — sits between KeyDoorModule (45) and ExplorationModule (40).
 *
 * Hardens the deterministic explorer against the two most common realm-time pathologies
 * that the built-in ExplorationModule has historically needed the tactical LLM to break
 * out of:
 *
 *   1. **Two-room ping-pong.** The agent crosses A→B, then B→A, repeatedly. The built-in
 *      loop-edge-ban detector in `exploration.ts` requires `turnsWithoutNewRoom >= 6`
 *      before it does anything, and by then the agent has already wasted 6 turns bouncing
 *      and the tactical LLM usually steps in with a fresh plan. Without an LLM, the agent
 *      just keeps bouncing.
 *
 *      This module detects the pattern after **one full reversal** (A→B→A) and bans
 *      reverse(last move) from the current room for a cooldown window (`REVERSAL_COOLDOWN_TURNS`).
 *      It also promotes per-direction "door burn": each time we cross the same A→B door,
 *      the next attempt from A gets down-weighted so alternate exits win.
 *
 *   2. **Aimless wander when the previous tactical layer said "east to explore".** The
 *      built-in east-bias in `ExplorationModule.chooseEastBiasMove` refuses to fire when
 *      the previous step was west (to avoid restarting the ping-pong it *just* detected).
 *      That's correct, but then the fallback scorer in `chooseExplorationMove` has no hard
 *      preference for forward progress — it picks the highest-score frontier tile, which
 *      in many realm layouts is a door tile WEST of the agent (the door it just came in
 *      through), and the ping-pong starts again.
 *
 *      This module emits an east-first, then down/up, then left preference with a confidence
 *      tuned to just beat the default exploration scorer (0.72 frontier/unvisited) — 0.78 —
 *      while staying below item-magnet (0.85+) and interactable-router (0.88+) so loot and
 *      interactables always preempt wandering.
 *
 * Quiet conditions (defers to other modules):
 *   - Enemies visible.
 *   - Realm cleared (boss_cleared / realm_cleared).
 *   - Emergency HP.
 *   - No `move` actions legal.
 *
 * Interaction with built-in memory:
 *   - Reads `context.mapMemory.loopDoorCrossings` (filled by ExplorationModule in the same
 *     turn's analyze pass — our priority 42 runs AFTER exploration's 40 only if we wanted
 *     that; but the planner dispatches `analyzeAll` once per turn, so ordering between
 *     modules doesn't matter — both look at the *previous* turn's memory).
 *   - Writes a short-lived per-room "banned reversal" entry under a dedicated map that's
 *     stored on a symbol-keyed side table (avoids polluting the SDK's MapMemory shape).
 */
const REVERSAL_COOLDOWN_TURNS = 8
const MAX_DOOR_BURN_PENALTY = 3
const DIRECTION_PREFERENCE_ORDER: Direction[] = ["right", "down", "up", "left"]
const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

/**
 * Per-agent-context state keyed by identity. The AgentContext instance is stable across
 * turns within a run, so a WeakMap is the cleanest way to persist anti-loop memory without
 * polluting the SDK's MapMemory type.
 */
interface RoomState {
  /** Banned direction from this room and the turn the ban expires on (exclusive). */
  bannedReversal?: { direction: Direction; expiresAtTurn: number }
  /** Per-direction counter that pins how often we've taken each exit from this room. */
  doorBurn: Partial<Record<Direction, number>>
}

const stateByContext = new WeakMap<AgentContext, Map<string, RoomState>>()

function getRoomState(context: AgentContext, roomId: string): RoomState {
  let byRoom = stateByContext.get(context)
  if (!byRoom) {
    byRoom = new Map()
    stateByContext.set(context, byRoom)
  }
  let state = byRoom.get(roomId)
  if (!state) {
    state = { doorBurn: {} }
    byRoom.set(roomId, state)
  }
  return state
}

export class AntiLoopExplorationModule implements AgentModule {
  readonly name = "anti-loop-exploration"
  readonly priority = 42

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    if (observation.visible_entities.some((entity) => entity.type === "enemy")) {
      return idle("Enemies visible; defer to combat.")
    }
    if (COMPLETED_STATUSES.has(observation.realm_info.status)) {
      return idle("Realm cleared; defer to extraction-router/portal.")
    }

    const hpMax = observation.character.hp.max
    const hpRatio = hpMax > 0 ? observation.character.hp.current / hpMax : 1
    const emergencyHpPercent = context.config.decision?.emergencyHpPercent ?? 0.2
    if (hpRatio <= emergencyHpPercent) {
      return idle("HP critical; defer to healing/extraction.")
    }

    const moveActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "move" }> => a.type === "move",
    )
    if (moveActions.length === 0) {
      return idle("No legal moves.")
    }

    const currentRoomId = observation.position.room_id
    const previousAction = context.previousActions.at(-1)?.action
    const previousDirection =
      previousAction?.type === "move" ? previousAction.direction : null

    // Update door-burn counters whenever the agent successfully transitioned rooms last turn.
    // The room we came from is in `loopDoorCrossings[last].fromRoomId`, and we took
    // `direction` to leave it. That's the door we just burned.
    const crossings = context.mapMemory.loopDoorCrossings ?? []
    const lastCrossing = crossings[crossings.length - 1]
    const secondLastCrossing = crossings[crossings.length - 2]
    if (
      lastCrossing
      && lastCrossing.toRoomId === currentRoomId
      && previousAction?.type === "move"
      && previousDirection === lastCrossing.direction
    ) {
      const fromState = getRoomState(context, lastCrossing.fromRoomId)
      const prev = fromState.doorBurn[lastCrossing.direction] ?? 0
      fromState.doorBurn[lastCrossing.direction] = Math.min(prev + 1, MAX_DOOR_BURN_PENALTY)
    }

    // Detect A→B→A reversal in one shot and ban it from A going forward. When the last
    // two crossings are (A→B) then (B→A), the B-side door that led back to A gets a ban on
    // *A* for the REVERSAL_COOLDOWN_TURNS turns so we don't immediately walk back through.
    if (
      lastCrossing
      && secondLastCrossing
      && lastCrossing.toRoomId === secondLastCrossing.fromRoomId
      && lastCrossing.fromRoomId === secondLastCrossing.toRoomId
    ) {
      // We're currently in `lastCrossing.toRoomId` (= the "A" room). Ban the direction we
      // just used to come back (lastCrossing.direction) from A itself for the cooldown.
      const bannedDirection = lastCrossing.direction
      if (currentRoomId === lastCrossing.toRoomId) {
        const state = getRoomState(context, currentRoomId)
        state.bannedReversal = {
          direction: reverseDirection(bannedDirection),
          expiresAtTurn: observation.turn + REVERSAL_COOLDOWN_TURNS,
        }
      }
    }

    const roomState = getRoomState(context, currentRoomId)
    const activeBan =
      roomState.bannedReversal && roomState.bannedReversal.expiresAtTurn > observation.turn
        ? roomState.bannedReversal.direction
        : null
    if (roomState.bannedReversal && !activeBan) {
      delete roomState.bannedReversal
    }

    // Existing legacy loop-edge-ban from the built-in exploration module — respect it too.
    const legacyBan =
      context.mapMemory.loopEdgeBans?.[currentRoomId] ?? null

    const stalls = context.mapMemory.stalledMoves
    const stallPenalty = (direction: Direction): number =>
      stalls.get(`${currentRoomId}:${direction}`) ?? 0

    type Candidate = {
      action: Extract<Action, { type: "move" }>
      score: number
      reasonBits: string[]
    }

    const immediateReverse = previousDirection
      ? reverseDirection(previousDirection)
      : null

    const candidates: Candidate[] = []
    for (const action of moveActions) {
      const reasonBits: string[] = []

      // Hard exclusions first.
      if (activeBan && action.direction === activeBan) continue
      if (legacyBan && action.direction === legacyBan) continue
      // Avoid the immediate reversal of last turn's step unless it's the ONLY option.
      // We apply a score penalty (not a hard exclusion) so the fallback path later can
      // still select it when nothing else remains.

      let score = 0

      // Base: directional preference. right > down > up > left. Picked so the planner's
      // explorationHomingOverrideStreak tie-breaker still sees this as the "right-bias"
      // recommendation the SDK expects during active play.
      const preferenceIndex = DIRECTION_PREFERENCE_ORDER.indexOf(action.direction)
      if (preferenceIndex >= 0) {
        score += 4 - preferenceIndex // right: +4, down: +3, up: +2, left: +1
        reasonBits.push(`pref-${action.direction}`)
      }

      // Door-burn penalty — each redundant crossing makes that door worse.
      const burn = roomState.doorBurn[action.direction] ?? 0
      if (burn > 0) {
        score -= burn * 1.5
        reasonBits.push(`burn-${burn}`)
      }

      // Stall penalty — if the game refused to move us that way recently, don't try again.
      const stall = stallPenalty(action.direction)
      if (stall > 0) {
        score -= stall * 3
        reasonBits.push(`stall-${stall}`)
      }

      // Reverse-of-last penalty — soft, keeps us from flipping direction.
      if (immediateReverse && action.direction === immediateReverse) {
        score -= 5
        reasonBits.push("reverse-of-last")
      }

      // Unvisited-tile bonus via the SDK's visitedTiles map. Peek one tile ahead.
      const nextTile = peekNextTile(observation, action.direction)
      if (nextTile) {
        const isPassable = isPassableTileType(nextTile.type)
        if (isPassable) score += 1
        const visitedKey = `${observation.position.floor}:${nextTile.x},${nextTile.y}`
        if (!context.mapMemory.visitedTiles.has(visitedKey)) {
          score += 2.5
          reasonBits.push("unvisited")
        }
        if (nextTile.type === "door") {
          score += 1.5
          reasonBits.push("door-adjacent")
        }
      }

      candidates.push({ action, score, reasonBits })
    }

    if (candidates.length === 0) {
      // All moves are banned. Fall back to the first legal move anyway — banning every exit
      // is worse than taking the least-bad one, since stuck-escape / portal will kick in.
      const anyMove = moveActions[0]!
      return {
        moduleName: this.name,
        suggestedAction: anyMove,
        reasoning: `Anti-loop: all exits hard-banned in room ${currentRoomId}; taking ${anyMove.direction} as a least-bad move.`,
        confidence: 0.5,
        context: {
          phase: "anti-loop-forced",
          currentRoomId,
          activeBan,
          legacyBan,
        },
      }
    }

    candidates.sort((left, right) => right.score - left.score)
    const best = candidates[0]!

    return {
      moduleName: this.name,
      suggestedAction: best.action,
      reasoning: `Anti-loop exploration: moving ${best.action.direction} (${best.reasonBits.join(
        ", ",
      )})${activeBan ? ` — reversal banned for ${REVERSAL_COOLDOWN_TURNS} turns` : ""}.`,
      confidence: 0.78,
      context: {
        phase: "anti-loop",
        currentRoomId,
        chosenDirection: best.action.direction,
        score: best.score,
        activeBan,
        legacyBan,
        burnByDirection: { ...roomState.doorBurn },
      },
    }
  }
}

function idle(reason: string): ModuleRecommendation {
  return { reasoning: reason, confidence: 0 }
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

function peekNextTile(
  observation: Observation,
  direction: Direction,
): Observation["visible_tiles"][number] | undefined {
  const current = observation.position.tile
  const next = nextCoord(current, direction)
  return observation.visible_tiles.find((tile) => tile.x === next.x && tile.y === next.y)
}

function nextCoord(
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

function isPassableTileType(type: string): boolean {
  return (
    type === "floor"
    || type === "door"
    || type === "stairs"
    || type === "stairs_up"
    || type === "entrance"
  )
}

/** Test hook to reset per-context state for isolation. */
export function __resetAntiLoopForTests(context: AgentContext): void {
  stateByContext.delete(context)
}

/** Test hook to inspect per-room state (asserts over internal fields). */
export function __peekAntiLoopRoomStateForTests(
  context: AgentContext,
  roomId: string,
): RoomState | undefined {
  return stateByContext.get(context)?.get(roomId)
}
