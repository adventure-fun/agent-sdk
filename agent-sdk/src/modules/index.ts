import type { Action, Direction, Observation, TileInfo } from "../protocol.js"
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
}

export interface AgentContext {
  turn: number
  previousActions: Array<{ turn: number; action: Action; reasoning: string }>
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
