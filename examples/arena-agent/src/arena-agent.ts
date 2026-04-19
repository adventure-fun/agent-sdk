import type {
  ArenaAction,
  ArenaObservation,
} from "../../../src/index.js"
import {
  collectAllCandidates,
  createArenaAgentContext,
  createArenaModuleRegistry,
  pickTopEvCandidate,
  type ArenaActionCandidate,
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
 * consulting the LLM. Tuned against `ArenaCombatModule` (finishable at
 * 0.85) and `ArenaCowardiceAvoidanceModule` (imminent cowardice tick at
 * 0.9) so clearly-optimal plays never burn LLM credits or eat the 15s
 * server turn timer on rate-limit backoff.
 */
const HIGH_CONFIDENCE_THRESHOLD = 0.8

/**
 * Utility margin required for the EV decision layer to commit without
 * consulting the LLM. If the top EV candidate outscores the runner-up
 * by at least this amount the agent takes it immediately (covers
 * emergency heals, finishing blows, lone legal moves, etc.). When the
 * margin is tighter the LLM picks between the top candidates instead
 * — the classic "ML tie-break" behavior the user asked for.
 */
const EV_DOMINANT_MARGIN = 15

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
    // EV-first decision path. Flatten every module's candidates into a
    // single pool and pick argmax utility. If the top candidate
    // dominates the runner-up by >= EV_DOMINANT_MARGIN, commit directly
    // (no LLM call). Otherwise, ask the LLM to tie-break.
    const evTop = pickTopEvCandidate(recommendations)
    const runnerUp = pickSecondBestUtility(recommendations, evTop)
    const dominant =
      evTop !== null &&
      (runnerUp === null || evTop.utility - runnerUp.utility >= EV_DOMINANT_MARGIN)

    if (evTop && dominant) {
      return {
        action: evTop.action,
        reasoning: `ev-dominant:${evTop.moduleName ?? "?"} (util=${evTop.utility.toFixed(2)}) :: ${evTop.reasoning}`,
      }
    }

    // Legacy short-circuit: a module with confidence >= 0.8 still wins
    // even if no candidates were produced (keeps back-compat with
    // non-EV modules and existing tests).
    const topByConfidence = pickTopRecommendation(recommendations)
    if (
      topByConfidence &&
      topByConfidence.confidence >= HIGH_CONFIDENCE_THRESHOLD &&
      !evTop
    ) {
      return {
        action: topByConfidence.suggestedAction!,
        reasoning: `module-first:${topByConfidence.moduleName} (conf=${topByConfidence.confidence.toFixed(2)}) :: ${topByConfidence.reasoning}`,
      }
    }

    const budgetMs = remainingTurnBudgetMs(options)
    if (budgetMs !== null && budgetMs < LLM_DEADLINE_BUFFER_MS) {
      if (evTop) {
        return {
          action: evTop.action,
          reasoning:
            `deadline-fallback (${budgetMs}ms left) → ev:${evTop.moduleName ?? "?"}` +
            ` (util=${evTop.utility.toFixed(2)}) :: ${evTop.reasoning}`,
        }
      }
      if (topByConfidence) {
        return {
          action: topByConfidence.suggestedAction!,
          reasoning:
            `deadline-fallback (${budgetMs}ms left) → module:${topByConfidence.moduleName}` +
            ` (conf=${topByConfidence.confidence.toFixed(2)}) :: ${topByConfidence.reasoning}`,
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

function pickSecondBestUtility(
  recommendations: readonly ArenaModuleRecommendation[],
  top: ArenaActionCandidate | null,
): ArenaActionCandidate | null {
  if (!top) return null
  // Use the same flattened pool `pickTopEvCandidate` uses — including
  // legacy confidence-only recommendations projected via
  // LEGACY_UTILITY_SCALE — so the dominance margin compares apples to
  // apples. Reference equality on `top` wins over action-json equality
  // because multiple modules may suggest the same action.
  const candidates = collectAllCandidates(recommendations)
  let runnerUp: ArenaActionCandidate | null = null
  for (const c of candidates) {
    if (c === top) continue
    // If a different module suggested the exact same action, treat
    // it as the same "vote" rather than a runner-up: it reinforces
    // the top pick instead of competing with it.
    if (sameAction(c.action, top.action)) continue
    if (runnerUp === null || c.utility > runnerUp.utility) {
      runnerUp = c
    }
  }
  return runnerUp
}

function sameAction(a: ArenaAction, b: ArenaAction): boolean {
  if (a.type !== b.type) return false
  return JSON.stringify(a) === JSON.stringify(b)
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
