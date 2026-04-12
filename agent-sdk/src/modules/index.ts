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
  lastPosition?: {
    floor: number
    roomId: string
    x: number
    y: number
  }
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
