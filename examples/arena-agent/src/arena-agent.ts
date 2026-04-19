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
import type { ArchetypeProfile } from "./modules/archetypes.js"
import {
  ArenaPromptAdapter,
  type ArenaDecisionResult,
} from "./llm/arena-prompt-adapter.js"

const MAX_ARENA_HISTORY = 20

/**
 * Short-circuit threshold for the module-first pipeline. Any module whose
 * confidence meets or exceeds this value wins the turn without ever
 * consulting the LLM. Tuned against `ArenaSelfCareModule` (emergency heal
 * at 0.95), `ArenaCombatModule` (finishable at 0.85), and the chest looter
 * (high-value adjacent pile at 0.85) so clearly-optimal plays never burn
 * LLM credits or eat the 15s server turn timer on rate-limit backoff.
 */
const HIGH_CONFIDENCE_THRESHOLD = 0.8

/**
 * Hard deadline buffer for LLM calls. If fewer than this many milliseconds
 * remain on the server-side turn timeout, we skip the LLM and take the
 * highest-confidence module recommendation (or `wait`). Prevents the
 * server from defaulting our action to `wait` mid-request.
 */
const LLM_DEADLINE_BUFFER_MS = 3_000

export interface ArenaAgentOptions {
  modules: readonly ArenaAgentModule[]
  llm: ArenaPromptAdapter
  /**
   * Optional archetype profile plumbed into `ArenaAgentContext`. Modules
   * read `context.archetype` to tune thresholds (combat confidence, heal
   * triggers, chest greed, flee distance). Omit to run modules with their
   * built-in defaults (equivalent to "balanced").
   */
  archetype?: ArchetypeProfile
}

export interface ArenaAgentDecideOptions {
  /** Server-provided turn timeout in ms (from `your_turn.timeout_ms`). */
  timeoutMs?: number
  /** Wall-clock ms when the server's turn countdown began. Defaults to `Date.now()`. */
  turnStartedAt?: number
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
  private readonly archetype: ArchetypeProfile | undefined
  private context: ArenaAgentContext
  private lastRecommendations: ArenaModuleRecommendation[] = []

  constructor(options: ArenaAgentOptions) {
    this.registry = createArenaModuleRegistry(options.modules)
    this.llm = options.llm
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

  /** Reset per-match state (module context + recent action memory). */
  resetMatch(): void {
    this.context = createArenaAgentContext(
      this.archetype ? { archetype: this.archetype } : {},
    )
    this.lastRecommendations = []
  }

  /**
   * Decision pipeline (module-first, LLM-as-tiebreak):
   *   1. Run every registered module and sort recommendations by confidence.
   *   2. If the top module's confidence >= HIGH_CONFIDENCE_THRESHOLD, return
   *      its action immediately. This covers clearly-optimal plays
   *      (emergency heal, finishable target, adjacent loot pile) without
   *      spending an LLM call or blocking on rate-limit backoff.
   *   3. If we're within LLM_DEADLINE_BUFFER_MS of the server-side turn
   *      timeout, skip the LLM entirely — take the best available module
   *      or `wait` — to avoid the server defaulting us to `wait` mid-call.
   *   4. Otherwise, ask the LLM adapter to break the tie. The adapter has
   *      its own fallback to the best module on rate-limit / parse failure.
   *
   * Always records the outcome in the rolling history window consumed by
   * the next prompt.
   */
  async processArenaObservation(
    observation: ArenaObservation,
    options: ArenaAgentDecideOptions = {},
  ): Promise<ArenaDecisionResult & { action: ArenaAction }> {
    this.context.turn = observation.turn
    const recommendations = this.registry.analyzeAll(observation, this.context)
    this.lastRecommendations = recommendations

    const decision = await this.decide(observation, recommendations, options)

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

  private async decide(
    observation: ArenaObservation,
    recommendations: ArenaModuleRecommendation[],
    options: ArenaAgentDecideOptions,
  ): Promise<ArenaDecisionResult> {
    const top = pickTopRecommendation(recommendations)

    if (top && top.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      return {
        action: top.suggestedAction!,
        reasoning: `module-first:${top.moduleName} (conf=${top.confidence.toFixed(2)}) :: ${top.reasoning}`,
      }
    }

    const budgetMs = remainingTurnBudgetMs(options)
    if (budgetMs !== null && budgetMs < LLM_DEADLINE_BUFFER_MS) {
      if (top) {
        return {
          action: top.suggestedAction!,
          reasoning:
            `deadline-fallback (${budgetMs}ms left) → module:${top.moduleName}` +
            ` (conf=${top.confidence.toFixed(2)}) :: ${top.reasoning}`,
        }
      }
      return { action: { type: "wait" }, reasoning: `deadline-fallback (${budgetMs}ms left); no module fired` }
    }

    return await this.llm.decide({
      observation,
      moduleRecommendations: recommendations,
      recentActions: this.context.previousActions,
    })
  }
}

/**
 * Picks the highest-confidence module that actually suggested a concrete
 * `ArenaAction`. Pure — the same input always returns the same output so
 * the short-circuit decision is reproducible in tests.
 */
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

function remainingTurnBudgetMs(options: ArenaAgentDecideOptions): number | null {
  const { timeoutMs, turnStartedAt } = options
  if (timeoutMs === undefined) return null
  const started = turnStartedAt ?? Date.now()
  const elapsed = Math.max(0, Date.now() - started)
  return Math.max(0, timeoutMs - elapsed)
}
