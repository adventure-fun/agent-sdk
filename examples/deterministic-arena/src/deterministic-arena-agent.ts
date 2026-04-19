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
} from "../../arena-agent/src/modules/base.js"
import type { ArchetypeProfile } from "../../arena-agent/src/modules/archetypes.js"

const MAX_ARENA_HISTORY = 20

/**
 * Deterministic arena agent — zero LLM calls.
 *
 * Shares the `ArenaAgent` module pipeline but never consults an LLM.
 * The decision rule is:
 *
 *   1. Run every registered module.
 *   2. Pick the highest-confidence recommendation that carries a concrete
 *      `ArenaAction`.
 *   3. If no module suggested an action, return `{ type: "wait" }`.
 *
 * This variant exists for bots that should run 24/7 without spending
 * OpenRouter credits. Behavior variety comes from the `archetype` knob
 * (passed through to every module via `ArenaAgentContext`) rather than
 * from model prompts.
 *
 * Kept as a peer (not a subclass) of `ArenaAgent` so the LLM-backed agent
 * stays free to evolve its prompt contract without deterministic bots
 * accidentally depending on those signatures.
 */
export interface DeterministicArenaAgentOptions {
  modules: readonly ArenaAgentModule[]
  archetype?: ArchetypeProfile
}

export interface DeterministicArenaDecision {
  action: ArenaAction
  reasoning: string
  /** Module that produced the chosen action, or `null` if we fell back to wait. */
  moduleName: string | null
  confidence: number
}

export class DeterministicArenaAgent {
  private readonly registry: ArenaModuleRegistry
  private readonly archetype: ArchetypeProfile | undefined
  private context: ArenaAgentContext
  private lastRecommendations: ArenaModuleRecommendation[] = []

  constructor(options: DeterministicArenaAgentOptions) {
    this.registry = createArenaModuleRegistry(options.modules)
    this.archetype = options.archetype
    this.context = createArenaAgentContext(
      this.archetype ? { archetype: this.archetype } : {},
    )
  }

  get moduleRegistry(): ArenaModuleRegistry {
    return this.registry
  }

  get lastModuleRecommendations(): readonly ArenaModuleRecommendation[] {
    return this.lastRecommendations
  }

  resetMatch(): void {
    this.context = createArenaAgentContext(
      this.archetype ? { archetype: this.archetype } : {},
    )
    this.lastRecommendations = []
  }

  processArenaObservation(observation: ArenaObservation): DeterministicArenaDecision {
    this.context.turn = observation.turn
    const recommendations = this.registry.analyzeAll(observation, this.context)
    this.lastRecommendations = recommendations

    const top = pickTopRecommendation(recommendations)
    const decision: DeterministicArenaDecision = top
      ? {
          action: top.suggestedAction,
          reasoning: `deterministic:${top.moduleName} (conf=${top.confidence.toFixed(2)}) :: ${top.reasoning}`,
          moduleName: top.moduleName ?? null,
          confidence: top.confidence,
        }
      : {
          action: { type: "wait" },
          reasoning: "deterministic: no module fired — defaulting to wait",
          moduleName: null,
          confidence: 0,
        }

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

function pickTopRecommendation(
  recommendations: readonly ArenaModuleRecommendation[],
): (ArenaModuleRecommendation & { suggestedAction: ArenaAction }) | null {
  let best: ArenaModuleRecommendation | null = null
  for (const rec of recommendations) {
    if (!rec.suggestedAction) continue
    if (best === null || rec.confidence > best.confidence) {
      best = rec
    }
  }
  return best && best.suggestedAction
    ? (best as ArenaModuleRecommendation & { suggestedAction: ArenaAction })
    : null
}
