import {
  bfsDistance,
  bfsStep,
  type Action,
  type AgentContext,
  type AgentModule,
  type Direction,
  type ModuleRecommendation,
  type Observation,
} from "../../../../src/index.js"

const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

const INVERSE_DIRECTION: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
}

/**
 * Priority 97 — post-clear retreat router.
 *
 * Runs only after `realm_info.status` is boss_cleared or realm_cleared. Uses the room-level
 * adjacency graph built from `mapMemory.loopDoorCrossings` (bidirectional via inverse edges)
 * to BFS from the current room to `realm_info.entrance_room_id`, then emits:
 *
 *   1. `retreat` when already at the entrance room on floor 1 and retreat is legal.
 *   2. A `move` in the direction of the next room on the BFS path when that direction is
 *      currently legal.
 *   3. A tile-level BFS step toward the nearest "door" tile in the current room when the
 *      needed direction is known but not legal from the current tile (door exists elsewhere
 *      in the room).
 *
 * Quiet when:
 *   - Realm is still active or enemies are visible (combat/healing take over).
 *   - On floor > 1 (default extraction routes to stairs; this module takes over on floor 1).
 *   - The room graph has no path from current to entrance (portal module emergency handles).
 *
 * Fixes the reported failure mode where the tactical LLM and the default exploration module's
 * tile-level west-bias ping-pong endlessly looking for "another exit" in a room that is
 * already the dead end — the agent needs to BACKTRACK through already-visited rooms, not
 * search for new exits.
 */
export class ExtractionRouterModule implements AgentModule {
  readonly name = "extraction-router"
  readonly priority = 97

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    const status = observation.realm_info.status
    if (!COMPLETED_STATUSES.has(status)) {
      return idle("Realm not cleared; defer to exploration/combat.")
    }
    if (observation.visible_entities.some((e) => e.type === "enemy")) {
      return idle("Enemies visible; defer to combat.")
    }

    const currentRoom = observation.position.room_id
    const targetRoom = observation.realm_info.entrance_room_id
    const currentFloor = observation.position.floor

    // Already at entrance room on floor 1 — emit retreat if legal.
    if (currentRoom === targetRoom && currentFloor === 1) {
      const retreat = observation.legal_actions.find((a) => a.type === "retreat")
      if (retreat) {
        return {
          suggestedAction: retreat,
          reasoning: "At entrance room on floor 1 with retreat legal — retreating to lobby.",
          confidence: 0.99,
          context: { phase: "retreat" },
        }
      }
      return idle("At entrance room but retreat not legal; defer to portal module.")
    }

    // Cross-floor case — the default extraction routes to stairs_up first; let it run until
    // we reach floor 1, then this module takes over.
    if (currentFloor > 1) {
      return idle(`On floor ${currentFloor}; cross-floor routing handled by default extraction.`)
    }

    // 1) PRIMARY: room-level BFS over loopDoorCrossings. This is the cleanest path when the
    //    agent has been running under this SDK build for the whole realm.
    const crossings = context.mapMemory.loopDoorCrossings ?? []
    if (crossings.length > 0) {
      const graph = buildRoomGraph(crossings)
      const firstStep = bfsFirstStepDirection(graph, currentRoom, targetRoom)
      if (firstStep) {
        const direct = tryDirectMove(observation, firstStep.direction)
        if (direct) {
          return {
            suggestedAction: direct,
            reasoning: `Retreat routing: room ${currentRoom} → ${firstStep.nextRoomId} → … → ${targetRoom}, stepping ${firstStep.direction}.`,
            confidence: 0.97,
            context: {
              phase: "retreat",
              currentRoom,
              nextRoom: firstStep.nextRoomId,
              targetRoom,
            },
          }
        }
        const doorStep = stepTowardNearestDoor(observation, context)
        if (doorStep) {
          return {
            suggestedAction: doorStep,
            reasoning: `Retreat routing: need ${firstStep.direction} to reach ${firstStep.nextRoomId}, but not legal from this tile — stepping ${doorStep.direction} toward nearest door.`,
            confidence: 0.92,
            context: {
              phase: "retreat-approach-door",
              currentRoom,
              neededDirection: firstStep.direction,
            },
          }
        }
      }
    }

    // 2) FALLBACK: no usable room graph (empty crossings, stale after reconnect, or no path
    //    found). Look for an "entrance" tile in scanned/visible tiles and BFS toward it.
    //    This handles the case where an agent hot-swaps into super-agent mid-realm and has
    //    no loopDoorCrossings populated yet.
    const entranceStep = stepTowardNearestTileType(
      observation,
      context,
      new Set(["entrance"]),
    )
    if (entranceStep) {
      return {
        suggestedAction: entranceStep,
        reasoning: `Retreat fallback: no room graph available; stepping ${entranceStep.direction} toward known entrance tile.`,
        confidence: 0.88,
        context: { phase: "retreat-tile-fallback", mode: "entrance" },
      }
    }

    // 3) FALLBACK: no entrance tile reachable from what we've scanned. Walk toward the
    //    nearest door tile in this room — once in the next room we'll re-evaluate with a
    //    refreshed visible tile set, and eventually reach either an entrance tile or new
    //    crossings.
    const doorStepOnly = stepTowardNearestTileType(
      observation,
      context,
      new Set(["door"]),
    )
    if (doorStepOnly) {
      return {
        suggestedAction: doorStepOnly,
        reasoning: `Retreat fallback: no entrance tile known; stepping ${doorStepOnly.direction} toward nearest door to leave this room.`,
        confidence: 0.8,
        context: { phase: "retreat-tile-fallback", mode: "door" },
      }
    }

    return idle(
      "No room crossings AND no entrance/door tiles reachable from this tile; deferring to default extraction.",
    )
  }
}

function tryDirectMove(
  observation: Observation,
  direction: Direction,
): Extract<Action, { type: "move" }> | null {
  const match = observation.legal_actions.find(
    (a): a is Extract<Action, { type: "move" }> =>
      a.type === "move" && a.direction === direction,
  )
  return match ?? null
}

interface RoomGraphEdge {
  neighbor: string
  direction: Direction
}

/**
 * Builds a room adjacency graph from the crossings log. Each crossing gives one edge; we add
 * the inverse-direction edge too so BFS can walk back toward the entrance.
 */
export function buildRoomGraph(
  crossings: ReadonlyArray<{ fromRoomId: string; toRoomId: string; direction: Direction }>,
): Map<string, RoomGraphEdge[]> {
  const graph = new Map<string, RoomGraphEdge[]>()

  function addEdge(from: string, neighbor: string, direction: Direction): void {
    const edges = graph.get(from) ?? []
    // Prefer more-recent crossing direction by overwriting an existing entry for the same
    // neighbor. (Doors stay in the same place within a run, but the tactical LLM may have
    // taken different tile paths; the most recent cross is the most reliable.)
    const existing = edges.findIndex((e) => e.neighbor === neighbor)
    if (existing >= 0) {
      edges.splice(existing, 1)
    }
    edges.push({ neighbor, direction })
    graph.set(from, edges)
  }

  for (const crossing of crossings) {
    addEdge(crossing.fromRoomId, crossing.toRoomId, crossing.direction)
    addEdge(crossing.toRoomId, crossing.fromRoomId, INVERSE_DIRECTION[crossing.direction])
  }
  return graph
}

interface BfsPathResult {
  direction: Direction
  nextRoomId: string
}

/**
 * BFS over the room graph from `start` to `target`. Returns the direction of the first step
 * plus the room id that step leads into, or null when no path exists within the known graph.
 */
export function bfsFirstStepDirection(
  graph: Map<string, RoomGraphEdge[]>,
  start: string,
  target: string,
): BfsPathResult | null {
  if (start === target) return null

  interface Node {
    room: string
    firstStep?: BfsPathResult
  }
  const visited = new Set<string>([start])
  const queue: Node[] = [{ room: start }]
  let head = 0

  while (head < queue.length) {
    const node = queue[head++]!
    const edges = graph.get(node.room) ?? []
    for (const edge of edges) {
      if (visited.has(edge.neighbor)) continue
      visited.add(edge.neighbor)
      const firstStep: BfsPathResult = node.firstStep ?? {
        direction: edge.direction,
        nextRoomId: edge.neighbor,
      }
      if (edge.neighbor === target) {
        return firstStep
      }
      queue.push({ room: edge.neighbor, firstStep })
    }
  }
  return null
}

/**
 * Convenience wrapper: find the nearest "door" tile via the multi-type helper.
 */
function stepTowardNearestDoor(
  observation: Observation,
  context: AgentContext,
): Extract<Action, { type: "move" }> | null {
  return stepTowardNearestTileType(observation, context, new Set(["door"]))
}

/**
 * Finds the nearest tile on the current floor whose type is in `wantedTypes` (via
 * `mapMemory.knownTiles` plus the current observation's `visible_tiles`) and returns a BFS
 * first-step toward it. Returns null when no such tile exists or none is reachable.
 *
 * Used for the cold-start retreat fallback: walk toward any "entrance" tile we've seen or
 * scanned, or any "door" tile if entrance is not yet known.
 */
function stepTowardNearestTileType(
  observation: Observation,
  context: AgentContext,
  wantedTypes: ReadonlySet<string>,
): Extract<Action, { type: "move" }> | null {
  const currentFloor = observation.position.floor
  const candidates: Array<{ x: number; y: number }> = []

  for (const [key, tile] of context.mapMemory.knownTiles.entries()) {
    if (!key.startsWith(`${currentFloor}:`)) continue
    if (wantedTypes.has(tile.type)) {
      candidates.push({ x: tile.x, y: tile.y })
    }
  }
  for (const tile of observation.visible_tiles) {
    if (wantedTypes.has(tile.type)) {
      if (!candidates.some((c) => c.x === tile.x && c.y === tile.y)) {
        candidates.push({ x: tile.x, y: tile.y })
      }
    }
  }
  if (candidates.length === 0) return null

  let best: { coord: { x: number; y: number }; distance: number } | null = null
  for (const coord of candidates) {
    // Skip the tile we're standing on — no step needed, and BFS on zero-distance returns null.
    if (
      coord.x === observation.position.tile.x
      && coord.y === observation.position.tile.y
    ) {
      continue
    }
    const distance = bfsDistance(observation, context, coord)
    if (distance === null) continue
    if (!best || distance < best.distance) {
      best = { coord, distance }
    }
  }
  if (!best) return null

  return bfsStep(observation, context, best.coord)
}

function idle(reason: string): ModuleRecommendation {
  return { reasoning: reason, confidence: 0 }
}
