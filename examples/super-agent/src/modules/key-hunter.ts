import {
  bfsDistance,
  bfsStep,
  type Action,
  type AgentContext,
  type AgentModule,
  type Direction,
  type InventorySlot,
  type ModuleRecommendation,
  type Observation,
} from "../../../../src/index.js"

const MAX_BFS_DISTANCE = 20

const KEY_NAME_PATTERN = /\bkey\b/i
const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

/**
 * East-first directional preference, matching the project-wide "right/east to
 * explore, left/west to escape" heuristic used by ExplorationModule + the
 * AntiLoopExplorationModule. Applied as a tiebreak when multiple frontiers sit
 * at the same BFS distance from the agent.
 */
const DIRECTION_TIEBREAK_RANK: Record<Direction, number> = {
  right: 0,
  down: 1,
  up: 2,
  left: 3,
}

const INVERSE_DIRECTION: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
}

/**
 * How many turns to stay committed to a chosen frontier target before we're
 * allowed to repick. Commitment is the main fix for the observed A→B→A failure
 * mode where two frontiers sat at nearly-equal BFS distance and the agent
 * flipped between them every turn as new tiles were observed. Re-evaluations
 * still happen whenever the target is reached, becomes unreachable, or is
 * consumed (no longer a frontier tile).
 */
const TARGET_HOLD_TURNS = 12

/**
 * Sliding window of recent agent positions used for tight ping-pong detection.
 * Seeing the exact pattern A→B→A→B within this window is the "I'm stuck and
 * making no progress" signal that causes this module to step aside so the
 * lower-priority AntiLoopExplorationModule (priority 42, confidence 0.78) can
 * run with its reversal bans + east-first bias.
 */
const POSITION_HISTORY_LEN = 8

/**
 * Per-AgentContext memory. Lives in a WeakMap so we don't pollute the SDK's
 * MapMemory type.
 */
interface KeyHunterState {
  /** Floor + (x,y) of the frontier tile we're currently committed to. */
  target:
    | {
        floor: number
        x: number
        y: number
        committedTurn: number
      }
    | null
  /** Short history of {turn, floor, x, y} stamps for ping-pong detection. */
  positions: Array<{ turn: number; floor: number; x: number; y: number }>
  /** Turn at which this state was last refreshed — used to reset on realm change. */
  lastRealmTemplate: string | null
  /**
   * Turn until which this module stays silent after detecting a ping-pong.
   * Lets the anti-loop module commit to a reversal ban without us yanking the
   * agent back to the key-hunt the very next turn.
   */
  silentUntilTurn: number
  /**
   * Targets we've stalled on this realm — keyed `floor:x,y`. Skipped during target
   * selection so a wall-bashed locked door we can't actually reach doesn't keep
   * pulling us back into the same dead-end every time the silent window expires.
   */
  bannedTargets: Set<string>
}

const stateByContext = new WeakMap<AgentContext, KeyHunterState>()

function getState(context: AgentContext): KeyHunterState {
  let s = stateByContext.get(context)
  if (!s) {
    s = {
      target: null,
      positions: [],
      lastRealmTemplate: null,
      silentUntilTurn: 0,
      bannedTargets: new Set(),
    }
    stateByContext.set(context, s)
  }
  return s
}

/**
 * Priority 65 — sits above KeyDoorModule (45) and below InteractableRouter (86).
 *
 * Activates when the agent holds a key-like item that does NOT match any remembered blocked
 * door in `mapMemory.encounteredDoors`. This is the "I just got a key from a sarcophagus /
 * chest and I have no idea where the matching door is" scenario — exactly what happens on
 * the first run through Sunken Crypt.
 *
 * Routing contract:
 *   - Pick the nearest reachable frontier tile (known passable tile with at least one
 *     unobserved cardinal neighbor), breaking ties by east-first direction relative to the
 *     agent. Commit to that target for up to TARGET_HOLD_TURNS turns so we don't flip between
 *     two near-equidistant frontiers every turn as new tiles enter the known set (the bug
 *     reported in realm logs where bot-realm-low/mid ping-ponged forever holding `mine-key`).
 *   - Re-evaluate early when: target reached, target no longer a frontier, target became
 *     unreachable, or the committed BFS step would immediately reverse the agent's last
 *     successful move.
 *   - Track the last N agent positions. If we detect an A→B→A→B ping-pong, go silent for a
 *     cooldown window (confidence 0) so AntiLoopExplorationModule can apply its reversal ban.
 *
 * This module is intentionally quiet when:
 *   - No key in inventory.
 *   - A remembered blocked door already matches a held key (KeyDoorModule routes there).
 *   - Realm is cleared (extraction routers take over).
 *   - Enemies are visible (combat takes over).
 *   - We're inside a self-imposed silent window after detecting a ping-pong.
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

    const state = getState(context)

    // Reset committed target + history when the realm template changes (new run).
    const currentTemplate = observation.realm_info.template_id
    if (state.lastRealmTemplate !== currentTemplate) {
      state.target = null
      state.positions = []
      state.silentUntilTurn = 0
      state.bannedTargets = new Set()
      state.lastRealmTemplate = currentTemplate
    }

    // Update position history BEFORE any ping-pong check so the current turn counts.
    const currentTile = observation.position.tile
    const currentFloor = observation.position.floor
    pushPosition(state, {
      turn: context.turn,
      floor: currentFloor,
      x: currentTile.x,
      y: currentTile.y,
    })

    // Silent cooldown — let anti-loop take over.
    if (context.turn < state.silentUntilTurn) {
      return idle(
        `Deferring to anti-loop exploration until turn ${state.silentUntilTurn} (detected key-hunt ping-pong).`,
      )
    }

    // Tight A→B→A→B detection: last four positions on the same floor alternate between two
    // tiles. When we see this, stop driving and let the anti-loop module break the cycle.
    if (detectPingPong(state.positions, currentFloor)) {
      state.target = null
      state.silentUntilTurn = context.turn + 6
      return idle(
        "Detected key-hunt ping-pong (A↔B on same floor); yielding to anti-loop exploration.",
      )
    }

    // Stall detection: agent has been at the same tile for the last STALL_TILE_REPEAT turns
    // on this floor. This happens when BFS routes through tiles it believes are passable but
    // the engine actually blocks (wall, locked door without bump-interact resolution, etc.).
    // Ban the current target so we don't re-pick it, drop commitment, silent-yield to anti-loop.
    if (detectStall(state.positions, currentFloor)) {
      if (state.target) {
        state.bannedTargets.add(`${state.target.floor}:${state.target.x},${state.target.y}`)
      }
      state.target = null
      state.silentUntilTurn = context.turn + 6
      return idle(
        "Detected key-hunt stall (no position change for several turns); banning target and yielding to anti-loop exploration.",
      )
    }

    // If we reached our committed target, clear it so we repick.
    if (
      state.target
      && state.target.floor === currentFloor
      && state.target.x === currentTile.x
      && state.target.y === currentTile.y
    ) {
      state.target = null
    }

    // Drop a target that aged out, changed floors, or is no longer a frontier.
    if (state.target) {
      if (state.target.floor !== currentFloor) {
        state.target = null
      } else if (context.turn - state.target.committedTurn > TARGET_HOLD_TURNS) {
        state.target = null
      }
    }

    // Prefer known locked doors with unknown key requirement on this floor before generic
    // frontier tiles. The agent can probe such a door with KeyDoorModule's probe path once
    // adjacent — much more direct than wandering the map looking for unexplored tiles.
    const isBanned = (x: number, y: number): boolean =>
      state.bannedTargets.has(`${currentFloor}:${x},${y}`)

    const lockedDoorTargets = collectUnknownLockedDoorCoords(observation, context).filter(
      (c) => !isBanned(c.x, c.y),
    )

    const frontierCoords = collectFrontierCoords(observation, context)
    for (const key of Array.from(frontierCoords.keys())) {
      const coord = frontierCoords.get(key)!
      if (isBanned(coord.x, coord.y)) frontierCoords.delete(key)
    }
    if (frontierCoords.size === 0 && lockedDoorTargets.length === 0) {
      state.target = null
      return idle("Holding an unplaced key but no known frontier tile exists yet.")
    }

    // Validate the committed target is still a valid candidate (locked-door or frontier).
    // If not, repick.
    if (state.target) {
      const key = `${state.target.x},${state.target.y}`
      const stillLockedDoor = lockedDoorTargets.some(
        (c) => c.x === state.target!.x && c.y === state.target!.y,
      )
      if (!stillLockedDoor && !frontierCoords.has(key)) {
        state.target = null
      }
    }

    // Decide on (or renew) the target. Prefer locked-door targets over generic frontiers.
    let targetCoord: { x: number; y: number } | null =
      state.target && state.target.floor === currentFloor
        ? { x: state.target.x, y: state.target.y }
        : null
    let targetIsLockedDoor = false

    if (!targetCoord) {
      const doorPick = lockedDoorTargets.length > 0
        ? pickBestFrontier(observation, context, lockedDoorTargets)
        : null
      if (doorPick) {
        targetCoord = doorPick
        targetIsLockedDoor = true
      } else {
        targetCoord = pickBestFrontier(
          observation,
          context,
          Array.from(frontierCoords.values()),
        )
        if (!targetCoord) {
          state.target = null
          return idle("Holding an unplaced key but no reachable frontier tile.")
        }
      }
      state.target = {
        floor: currentFloor,
        x: targetCoord.x,
        y: targetCoord.y,
        committedTurn: context.turn,
      }
    } else {
      targetIsLockedDoor = lockedDoorTargets.some(
        (c) => c.x === targetCoord!.x && c.y === targetCoord!.y,
      )
    }

    // BFS-step toward the committed target.
    let step = bfsStep(observation, context, targetCoord)
    if (!step) {
      // Target became unreachable — repick immediately with a fresh scan.
      state.target = null
      const alt = pickBestFrontier(
        observation,
        context,
        Array.from(frontierCoords.values()),
      )
      if (!alt) {
        return idle("Holding an unplaced key but no reachable frontier tile.")
      }
      state.target = {
        floor: currentFloor,
        x: alt.x,
        y: alt.y,
        committedTurn: context.turn,
      }
      step = bfsStep(observation, context, alt)
      if (!step) {
        return idle("Holding an unplaced key but BFS could not produce a step.")
      }
      targetCoord = alt
    }

    // Immediate-reversal guard: if our step would reverse the previous successful move, try
    // to re-pick a different frontier whose first step isn't a reversal. Prevents the "step
    // east, now west tile is closer, step west" flapping.
    const lastDir = lastMoveDirection(context)
    if (lastDir && step.direction === INVERSE_DIRECTION[lastDir]) {
      const alternative = pickNonReversingFrontier(
        observation,
        context,
        Array.from(frontierCoords.values()),
        INVERSE_DIRECTION[lastDir],
      )
      if (alternative) {
        state.target = {
          floor: currentFloor,
          x: alternative.coord.x,
          y: alternative.coord.y,
          committedTurn: context.turn,
        }
        step = alternative.step
        targetCoord = alternative.coord
      }
      // If no non-reversing frontier exists, proceed with the reversal — better than idle.
    }

    const heldKeys = Array.from(keyTemplates).join(", ")
    const targetLabel = targetIsLockedDoor
      ? `known locked door at (${targetCoord.x},${targetCoord.y}) to probe it`
      : `committed frontier (${targetCoord.x},${targetCoord.y})`
    return {
      suggestedAction: step,
      reasoning: `Holding unplaced key(s) [${heldKeys}]; routing ${step.direction} toward ${targetLabel}.`,
      confidence: 0.88,
      context: {
        phase: "key-hunt",
        heldKeys: Array.from(keyTemplates),
        target: targetCoord,
        targetIsLockedDoor,
        committedTurn: state.target?.committedTurn ?? context.turn,
      },
    }
  }
}

/**
 * Returns coords of locked doors on the current floor whose key requirement is unknown
 * (`requiredKeyTemplateId === undefined` AND `isBlocked === true`). Includes both currently
 * visible doors and remembered ones. KeyDoorModule's probe-on-sight path opens these once we
 * arrive adjacent.
 */
function collectUnknownLockedDoorCoords(
  observation: Observation,
  context: AgentContext,
): Array<{ x: number; y: number }> {
  const doors = context.mapMemory.encounteredDoors
  if (!doors || doors.size === 0) return []
  const currentFloor = observation.position.floor
  const out: Array<{ x: number; y: number }> = []
  for (const door of doors.values()) {
    if (!door.isBlocked) continue
    if (door.requiredKeyTemplateId) continue
    if (door.floor !== currentFloor) continue
    out.push({ x: door.x, y: door.y })
  }
  return out
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

function pushPosition(
  state: KeyHunterState,
  entry: { turn: number; floor: number; x: number; y: number },
): void {
  const last = state.positions[state.positions.length - 1]
  if (
    last
    && last.turn === entry.turn
    && last.floor === entry.floor
    && last.x === entry.x
    && last.y === entry.y
  ) {
    return
  }
  state.positions.push(entry)
  if (state.positions.length > POSITION_HISTORY_LEN) {
    state.positions.shift()
  }
}

const STALL_TILE_REPEAT = 4

/**
 * Returns true when the last STALL_TILE_REPEAT same-floor entries in `positions` are all
 * the same tile — i.e. the agent has not moved for several turns despite emitting actions.
 * Caused by BFS suggesting a move the engine then blocks (wall, locked door bump that fails
 * a precondition, etc.). When detected, KeyHunter should drop its target and yield so the
 * anti-loop module can try a different direction.
 */
function detectStall(
  positions: KeyHunterState["positions"],
  currentFloor: number,
): boolean {
  const sameFloor = positions.filter((p) => p.floor === currentFloor)
  if (sameFloor.length < STALL_TILE_REPEAT) return false
  const tail = sameFloor.slice(-STALL_TILE_REPEAT)
  const first = tail[0]!
  return tail.every((p) => p.x === first.x && p.y === first.y)
}

/**
 * Returns true when the last four same-floor entries in `positions` alternate between
 * two distinct tiles — i.e. A, B, A, B (or equivalent). This is the canonical "two
 * near-equidistant frontiers fighting" failure mode.
 */
function detectPingPong(
  positions: KeyHunterState["positions"],
  currentFloor: number,
): boolean {
  const sameFloor = positions.filter((p) => p.floor === currentFloor)
  if (sameFloor.length < 4) return false
  const [p4, p3, p2, p1] = sameFloor.slice(-4)
  if (!p1 || !p2 || !p3 || !p4) return false
  const sameTile = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): boolean => a.x === b.x && a.y === b.y
  return (
    sameTile(p1, p3)
    && sameTile(p2, p4)
    && !sameTile(p1, p2)
  )
}

/**
 * Build a coordinate-keyed set of frontier tiles on the current floor. A frontier tile is a
 * passable known tile with at least one cardinal neighbor that is NOT in our known-tile set.
 */
function collectFrontierCoords(
  observation: Observation,
  context: AgentContext,
): Map<string, { x: number; y: number }> {
  const currentFloor = observation.position.floor
  const known = context.mapMemory.knownTiles

  const knownCoords = new Map<string, string>()
  for (const [key, tile] of known.entries()) {
    if (!key.startsWith(`${currentFloor}:`)) continue
    knownCoords.set(`${tile.x},${tile.y}`, tile.type)
  }
  for (const tile of observation.visible_tiles) {
    knownCoords.set(`${tile.x},${tile.y}`, tile.type)
  }

  const frontiers = new Map<string, { x: number; y: number }>()
  if (knownCoords.size === 0) return frontiers

  const passableTypes = new Set(["floor", "door", "stairs", "stairs_up", "entrance"])
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
        frontiers.set(coordKey, { x, y })
        break
      }
    }
  }
  return frontiers
}

/**
 * Pick the best frontier tile to commit to. Sorts by (bfsDistance asc, east-first tiebreak,
 * then lexicographic x/y for determinism).
 */
function pickBestFrontier(
  observation: Observation,
  context: AgentContext,
  candidates: Array<{ x: number; y: number }>,
): { x: number; y: number } | null {
  const currentTile = observation.position.tile
  const scored: Array<{
    coord: { x: number; y: number }
    distance: number
    tiebreakRank: number
  }> = []

  for (const coord of candidates) {
    if (coord.x === currentTile.x && coord.y === currentTile.y) continue
    const distance = bfsDistance(observation, context, coord)
    if (distance === null || distance > MAX_BFS_DISTANCE) continue
    const step = bfsStep(observation, context, coord)
    const tiebreakRank = step
      ? DIRECTION_TIEBREAK_RANK[step.direction]
      : Number.POSITIVE_INFINITY
    scored.push({ coord, distance, tiebreakRank })
  }
  if (scored.length === 0) return null

  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance
    if (a.tiebreakRank !== b.tiebreakRank) return a.tiebreakRank - b.tiebreakRank
    if (a.coord.x !== b.coord.x) return a.coord.x - b.coord.x
    return a.coord.y - b.coord.y
  })

  return scored[0]?.coord ?? null
}

/**
 * When our committed step would reverse the last move, try to find a frontier whose next
 * step isn't the `bannedDirection`. Returns the runner-up or null.
 */
function pickNonReversingFrontier(
  observation: Observation,
  context: AgentContext,
  candidates: Array<{ x: number; y: number }>,
  bannedDirection: Direction,
): {
  coord: { x: number; y: number }
  step: Extract<Action, { type: "move" }>
} | null {
  const currentTile = observation.position.tile
  const scored: Array<{
    coord: { x: number; y: number }
    distance: number
    step: Extract<Action, { type: "move" }>
    tiebreakRank: number
  }> = []

  for (const coord of candidates) {
    if (coord.x === currentTile.x && coord.y === currentTile.y) continue
    const distance = bfsDistance(observation, context, coord)
    if (distance === null || distance > MAX_BFS_DISTANCE) continue
    const step = bfsStep(observation, context, coord)
    if (!step) continue
    if (step.direction === bannedDirection) continue
    scored.push({
      coord,
      distance,
      step,
      tiebreakRank: DIRECTION_TIEBREAK_RANK[step.direction],
    })
  }
  if (scored.length === 0) return null

  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance
    if (a.tiebreakRank !== b.tiebreakRank) return a.tiebreakRank - b.tiebreakRank
    if (a.coord.x !== b.coord.x) return a.coord.x - b.coord.x
    return a.coord.y - b.coord.y
  })

  const top = scored[0]
  if (!top) return null
  return { coord: top.coord, step: top.step }
}

function lastMoveDirection(context: AgentContext): Direction | null {
  for (let i = context.previousActions.length - 1; i >= 0; i -= 1) {
    const entry = context.previousActions[i]
    if (!entry) continue
    if (entry.action.type === "move") {
      return entry.action.direction
    }
  }
  return null
}

/**
 * Test-only reset hook so unit tests can isolate per-context state without needing to
 * construct disposable AgentContext instances.
 */
export function __resetKeyHunterForTests(context: AgentContext): void {
  stateByContext.delete(context)
}

/**
 * Test-only inspection hook — returns a shallow snapshot of the committed target and silent
 * window for assertions. Undefined when no state has ever been created for `context`.
 */
export function __peekKeyHunterStateForTests(
  context: AgentContext,
): Pick<KeyHunterState, "target" | "silentUntilTurn"> | undefined {
  const s = stateByContext.get(context)
  if (!s) return undefined
  return {
    target: s.target ? { ...s.target } : null,
    silentUntilTurn: s.silentUntilTurn,
  }
}
