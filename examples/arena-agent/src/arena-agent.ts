import type {
  ArenaAction,
  ArenaObservation,
} from "../../../src/index.js"
import {
  createArenaAgentContext,
  createArenaModuleRegistry,
  type ArenaAgentContext,
  type ArenaAgentModule,
  type ArenaModuleRecommendation,
  type ArenaModuleRegistry,
} from "./modules/base.js"
import {
  ArenaPromptAdapter,
  type ArenaDecisionResult,
} from "./llm/arena-prompt-adapter.js"

const MAX_ARENA_HISTORY = 20

export interface ArenaAgentOptions {
  modules: readonly ArenaAgentModule[]
  llm: ArenaPromptAdapter
}

/**
 * Parallel path to `BaseAgent` that ingests `ArenaObservation` and emits
 * `ArenaAction` without touching dungeon types or the dungeon planner. Chosen
 * over inheritance so no arena-specific state leaks into the dungeon lifecycle
 * loop (`BaseAgent.start` -> `playRealm` -> `handleObservation` -> ...). The
 * arena lifecycle lives entirely in `examples/arena-agent/index.ts`, which
 * drives one `ArenaAgent` instance per match.
 */
export class ArenaAgent {
  private readonly registry: ArenaModuleRegistry
  private readonly llm: ArenaPromptAdapter
  private context: ArenaAgentContext = createArenaAgentContext()
  private lastRecommendations: ArenaModuleRecommendation[] = []

  constructor(options: ArenaAgentOptions) {
    this.registry = createArenaModuleRegistry(options.modules)
    this.llm = options.llm
  }

  get moduleRegistry(): ArenaModuleRegistry {
    return this.registry
  }

  get lastModuleRecommendations(): readonly ArenaModuleRecommendation[] {
    return this.lastRecommendations
  }

  /** Reset per-match state (module context + recent action memory). */
  resetMatch(): void {
    this.context = createArenaAgentContext()
    this.lastRecommendations = []
  }

  /**
   * Runs every arena module against the observation, asks the LLM adapter to
   * pick a legal action given the aggregate recommendations, and records the
   * result in the rolling history window consumed by the next prompt.
   */
  async processArenaObservation(
    observation: ArenaObservation,
  ): Promise<ArenaDecisionResult & { action: ArenaAction }> {
    this.context.turn = observation.turn
    const recommendations = this.registry.analyzeAll(observation, this.context)
    this.lastRecommendations = recommendations

    const decision = await this.llm.decide({
      observation,
      moduleRecommendations: recommendations,
      recentActions: this.context.previousActions,
    })

    this.context.previousActions.push({
      turn: observation.turn,
      action: decision.action,
      reasoning: decision.reasoning,
    })
    if (this.context.previousActions.length > MAX_ARENA_HISTORY) {
      this.context.previousActions.shift()
    }

    return decision
  }
}
