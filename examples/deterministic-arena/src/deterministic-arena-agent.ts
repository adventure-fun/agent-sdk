import type {
  ArenaAction,
  ArenaObservation,
} from "../../../src/index.js"
import {
  createArenaAgentContext,
  createArenaModuleRegistry,
  pickTopEvCandidate,
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

    // EV decision: argmax across every module's `candidates[]` (and any
    // legacy suggestedAction projected to utility). This replaces the
    // pure "highest confidence wins" heuristic that caused bots to ping-
    // pong between conflicting module suggestions.
    const evTop = pickTopEvCandidate(recommendations)
    const decision: DeterministicArenaDecision = evTop
      ? {
          action: evTop.action,
          reasoning: `deterministic:${evTop.moduleName ?? "?"} (util=${evTop.utility.toFixed(2)}) :: ${evTop.reasoning}`,
          moduleName: evTop.moduleName ?? null,
          confidence: Math.min(0.99, Math.max(0, evTop.utility / 60)),
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

// Retained for back-compat with earlier tests/fixtures that import the
// helper. The production path now uses `pickTopEvCandidate` above.
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
// Keep the tree-shaker from dropping pickTopRecommendation even though the
// main decision path no longer references it.
void pickTopRecommendation
