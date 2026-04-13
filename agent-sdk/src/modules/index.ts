import type { Action, Direction, ItemRarity, Observation, TileInfo } from "../protocol.js"
import type { AgentConfig } from "../config.js"

export interface ModuleRecommendation {
  moduleName?: string
  suggestedAction?: Action
  reasoning: string
  confidence: number
  context?: Record<string, unknown>
}

export interface AgentModule {
  name: string
  priority: number
  analyze(observation: Observation, context: AgentContext): ModuleRecommendation
}

/**
 * Persistent record of an item we've seen on the map this run, keyed by the entity id.
 * Populated by the exploration module each turn from `observation.visible_entities`. Entries
 * survive after the agent walks away, letting downstream modules (e.g. the key/door module)
 * route back to a remembered item when stuck.
 */
export interface SeenItem {
  itemId: string
  floor: number
  roomId: string
  x: number
  y: number
  name: string
  rarity?: ItemRarity
  isLikelyKey: boolean
  lastSeenTurn: number
}

/**
 * Persistent record of a locked door (or any blocked interactable) we've encountered this run.
 * Populated from two signals:
 *   1. `visible_entities` containing an interactable with `is_locked_exit === true`
 *   2. `recent_events` of type `interact_blocked` with a `target_id` and optional
 *      `required_template_id`
 * Survives until the interactable is successfully used (then cleared).
 */
export interface EncounteredDoor {
  targetId: string
  floor: number
  roomId: string
  x: number
  y: number
  name?: string
  /** Template id of the item required to satisfy the door's `has-item` condition, if known. */
  requiredKeyTemplateId?: string
  /** Turn numbers on which the agent attempted `interact` on this door (useful for stuck detection). */
  interactedTurns: number[]
  /** Turn on which the door was first seen in visible_entities or encountered via an event. */
  firstSeenTurn: number
  /** Most recent human-readable reason string from an `interact_blocked` event. */
  lastBlockedDetail?: string
  /** True when we believe the door is still blocked. Flipped to false after successful interact. */
  isBlocked: boolean
}

/**
 * A `TileInfo` entry we've actually walked past or seen, stamped with the floor it belongs to.
 * Source of truth for "where are the real doors" — `Observation.known_map.floors[f].tiles`
 * reports every remembered tile as `type: "floor"` (the engine strips real types before sending),
 * so the prompt builder must use this instead.
 */
export interface KnownFloorTile {
  floor: number
  x: number
  y: number
  type: TileInfo["type"]
}

/**
 * Per-room connectivity record built from observed room-to-room moves. Each entry is a single
 * direction the agent has used to leave the room, plus the destination room id it arrived in.
 * Used by the prompt builder to give the LLM a graph view of "which rooms am I aware of and
 * how do they connect" so it can recognize when only 2 rooms are reachable (locked-key state).
 */
export interface RoomConnection {
  fromRoomId: string
  direction: Direction
  toRoomId: string
}

/**
 * Per-room stall record: how many times each direction failed to move the agent from this room.
 * Surfaced in the prompt so the LLM can stop retrying walls.
 */
export interface RoomStallRecord {
  roomId: string
  stalledByDirection: Record<Direction, number>
}

/**
 * Serializable slice of `MapMemory` passed to LLM prompt builders. Kept separate from
 * `MapMemory` itself because prompt builders should not reach into live Maps/Sets —
 * the planner converts before each decide/plan call.
 */
export interface MemorySnapshot {
  seenItems: SeenItem[]
  encounteredDoors: EncounteredDoor[]
  knownKeyTemplateIds: string[]
  currentFloorKnownTiles: KnownFloorTile[]
  currentRoomStalls: RoomStallRecord | null
  visitedRoomCount: number
  visitedRoomIds: string[]
  roomConnections: RoomConnection[]
  turnsWithoutNewRoom: number
}

export interface MapMemory {
  visitedRooms: Set<string>
  visitedTiles: Set<string>
  knownTiles: Map<string, TileInfo>
  discoveredExits: Map<string, Direction[]>
  stalledMoves: Map<string, number>
  lastRoomEntry?: {
    roomId: string
    cameFromDirection: Direction
  }
  lastPosition?: {
    floor: number
    roomId: string
    x: number
    y: number
  }
  /** Consecutive planner turns that used post-clear homing override (reset to let tactical LLM run). */
  extractionHomingOverrideStreak?: number
  /** Consecutive planner turns that used active-play east-bias exploration override. */
  explorationHomingOverrideStreak?: number
  /**
   * Floor-1 post-clear: after `extractionPreferLeftBiasExit` west steps hit a dead end, set to
   * `reassess` so deterministic homing yields to the tactician (and auto-portal is skipped once).
   */
  extractionFloor1ExitPhase?: "reassess"
  /**
   * One `realm_info.template_name` per delve; when it changes, loop buffers reset.
   */
  loopTrackTemplate?: string
  /**
   * Most recently observed `realm_info.status`. Used to detect status transitions
   * (especially active → boss_cleared / realm_cleared) and clear stale loop tracking
   * so the post-clear extraction logic doesn't fire phantom ping-pong recovery in
   * a fresh boss/exit room.
   */
  lastRealmStatus?: string
  /** Recent room ids (one per observation) to detect A↔B↔A↔B ping-pong during play or extraction. */
  loopRecentRooms?: string[]
  /** Room-to-room moves via `move` (any floor) to learn which direction bridges the ping-pong pair. */
  loopDoorCrossings?: Array<{ fromRoomId: string; toRoomId: string; direction: Direction }>
  /**
   * When stuck in a two-room alternation under survival or floor-1 post-clear, forbid these move
   * directions (they re-enter the loop).
   */
  loopEdgeBans?: Partial<Record<string, Direction>>
  /**
   * Active "unstuck" mode during post-clear floor-1 extraction. While the current room id matches
   * and `untilTurn` hasn't been passed, the exploration module forces moves *away* from
   * `awayFromDirection` (the ping-pong door edge) so the agent leaves the shared-door tile and
   * can see other exits within the room.
   */
  unstuckAwayFromEdge?: {
    roomId: string
    awayFromDirection: Direction
    untilTurn: number
  }
  /**
   * Turns since we last entered a room we hadn't seen this tick (reset on new-room entry). Used by
   * the post-clear portal safety valve to escape hopeless layouts.
   */
  turnsWithoutNewRoom?: number
  /**
   * Turns since the agent's tile position last changed. Reset to 0 on any tile move; counts up
   * while the agent is stationary. Used by the stuck detector to distinguish "actively exploring
   * the same room" (position changes) from "frozen in place" (a mistaken stall).
   */
  turnsWithoutPositionChange?: number
  /**
   * Turn number on which the agent last transitioned between rooms. Used to age out stale
   * loopRecentRooms history — a ping-pong tail from many turns ago shouldn't trigger
   * "two-room reversal" recovery when the agent has long since settled into a single room.
   */
  lastRoomChangeTurn?: number
  /**
   * Persistent record of items we've seen on the map. Keyed by entity id; entries survive after
   * the agent moves away so the tactician can route back to uncollected loot (including keys).
   * Populated by the exploration module; pruned when the underlying entity is picked up.
   */
  seenItems?: Map<string, SeenItem>
  /**
   * Locked doors / blocked interactables encountered this run, keyed by interactable target id.
   * Populated from `visible_entities` (is_locked_exit) and `recent_events` (interact_blocked).
   * Read by the KeyDoorModule to route the agent back when the matching key is in inventory.
   */
  encounteredDoors?: Map<string, EncounteredDoor>
}

export interface AgentContext {
  turn: number
  previousActions: Array<{
    turn: number
    action: Action
    reasoning: string
    observation_summary?: string
  }>
  mapMemory: MapMemory
  config: AgentConfig
}

export interface ModuleRegistry {
  modules: AgentModule[]
  analyzeAll(observation: Observation, context: AgentContext): ModuleRecommendation[]
}

export function createMapMemory(): MapMemory {
  return {
    visitedRooms: new Set(),
    visitedTiles: new Set(),
    knownTiles: new Map(),
    discoveredExits: new Map(),
    stalledMoves: new Map(),
  }
}

export function createAgentContext(config: AgentConfig): AgentContext {
  return {
    turn: 0,
    previousActions: [],
    mapMemory: createMapMemory(),
    config,
  }
}

export function createModuleRegistry(modules: AgentModule[]): ModuleRegistry {
  const sorted = [...modules].sort((a, b) => b.priority - a.priority)

  return {
    modules: sorted,
    analyzeAll(observation: Observation, context: AgentContext): ModuleRecommendation[] {
      return sorted.map((mod) => {
        const rec = mod.analyze(observation, context)
        return { ...rec, moduleName: mod.name }
      })
    },
  }
}

export { CombatModule } from "./combat.js"
export { ExplorationModule } from "./exploration.js"
export { InventoryModule } from "./inventory.js"
export { TrapHandlingModule } from "./trap-handling.js"
export { PortalModule } from "./portal.js"
export { HealingModule } from "./healing.js"
export { KeyDoorModule } from "./key-door.js"
