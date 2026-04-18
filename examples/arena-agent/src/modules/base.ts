import type { ArenaAction, ArenaObservation } from "../../../../src/index.js"

/**
 * Arena-specific context passed to each module. Kept minimal (turn + past
 * actions) — arena observations are full-fidelity, so modules do NOT need a
 * reconstructed map memory like the dungeon `AgentContext`.
 */
export interface ArenaAgentContext {
  turn: number
  /** Most recent actions submitted by this agent, newest last. */
  previousActions: Array<{
    turn: number
    action: ArenaAction
    reasoning: string
  }>
}

/**
 * Recommendation emitted by an arena module. Mirrors the dungeon
 * `ModuleRecommendation` shape so a single planner can consume either.
 */
export interface ArenaModuleRecommendation {
  moduleName?: string
  suggestedAction?: ArenaAction
  reasoning: string
  confidence: number
  context?: Record<string, unknown>
}

/**
 * Arena module interface. Modules are pure: given the same observation +
 * context they must return the same recommendation so tests are deterministic
 * and the LLM prompt-builder can cache module outputs per turn.
 */
export interface ArenaAgentModule {
  readonly name: string
  readonly priority: number
  analyze(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation
}

export interface ArenaModuleRegistry {
  modules: ArenaAgentModule[]
  analyzeAll(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation[]
}

export function createArenaAgentContext(): ArenaAgentContext {
  return { turn: 0, previousActions: [] }
}

export function createArenaModuleRegistry(
  modules: readonly ArenaAgentModule[],
): ArenaModuleRegistry {
  const sorted = [...modules].sort((a, b) => b.priority - a.priority)
  return {
    modules: sorted,
    analyzeAll(observation, context) {
      return sorted.map((mod) => {
        const rec = mod.analyze(observation, context)
        return { ...rec, moduleName: mod.name }
      })
    },
  }
}

/** Chebyshev distance — matches the single-step movement cost (king moves). */
export function chebyshev(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

/** Manhattan distance — matches the engine's ability range check. */
export function manhattan(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}
