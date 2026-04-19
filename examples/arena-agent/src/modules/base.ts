import type { ArenaAction, ArenaObservation } from "../../../../src/index.js"
import type { ArchetypeProfile } from "./archetypes.js"

/**
 * Arena-specific context passed to each module. Kept minimal (turn + past
 * actions) — arena observations are full-fidelity, so modules do NOT need a
 * reconstructed map memory like the dungeon `AgentContext`.
 *
 * Optional `archetype` carries per-bot behavioral tuning (aggression,
 * self-care thresholds, chest-greed) so the same module pipeline can drive
 * deterministic bots with distinct personalities without forking code.
 * Modules MUST treat an unset profile as `balanced` to stay test-stable.
 */
export interface ArenaAgentContext {
  turn: number
  /** Most recent actions submitted by this agent, newest last. */
  previousActions: Array<{
    turn: number
    action: ArenaAction
    reasoning: string
  }>
  /**
   * Optional archetype profile for behavior tuning. If unset modules should
   * use their built-in defaults; see `archetypes.ts` for the knob catalog.
   */
  archetype?: ArchetypeProfile
}

/**
 * Per-action candidate emitted by a module under the EV-scoring model.
 * Modules that opt in produce one candidate per legal action they care
 * about; the decision layer flattens every module's candidates and picks
 * the global argmax(utility). Legacy modules can keep emitting just
 * `suggestedAction` + `confidence` — the decision layer will fall back to
 * those when no candidates are present.
 *
 * Utility semantics:
 *   - `utility` is a unit-less scalar in roughly `[-∞, +∞]`, typically in
 *     `[-100, +100]` for actions scored via `scoreAttack/Move/Heal/Interact`
 *     in `modules/utility.ts`. Higher = better for this archetype in this
 *     situation; the components are broken out so tests can pin why.
 *   - `components.expected_damage_dealt` / `expected_damage_taken` are in
 *     absolute HP values (already rolled through hit probability + stats).
 *   - `components.strategic_bonus` aggregates finishing-blow, wave-bait,
 *     chest-greed, cowardice-commit, etc.; archetype knobs get folded in.
 *   - `components.risk_weight` echoes the archetype's risk tolerance so
 *     operators debugging logs can see WHY an action scored the way it did.
 */
export interface ArenaActionCandidate {
  action: ArenaAction
  reasoning: string
  moduleName?: string
  utility: number
  components: {
    expected_damage_dealt: number
    expected_damage_taken: number
    expected_heal: number
    strategic_bonus: number
    risk_weight: number
  }
}

/**
 * Recommendation emitted by an arena module. Mirrors the dungeon
 * `ModuleRecommendation` shape so a single planner can consume either.
 *
 * Under the EV decision model, modules now also populate `candidates[]` —
 * the decision layer flattens every module's candidates and picks
 * `argmax(utility)`. `suggestedAction` + `confidence` are preserved for
 * backward compatibility and as the fallback path when no candidates are
 * emitted (the decision layer treats them as a single candidate with
 * `utility = confidence`).
 */
export interface ArenaModuleRecommendation {
  moduleName?: string
  suggestedAction?: ArenaAction
  reasoning: string
  confidence: number
  context?: Record<string, unknown>
  /**
   * Optional per-action EV candidates. When present, the decision layer
   * prefers `argmax(utility)` across all candidates from all modules.
   */
  candidates?: ArenaActionCandidate[]
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

export function createArenaAgentContext(
  options: { archetype?: ArchetypeProfile } = {},
): ArenaAgentContext {
  return {
    turn: 0,
    previousActions: [],
    ...(options.archetype ? { archetype: options.archetype } : {}),
  }
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
        const candidates = rec.candidates?.map((c) => ({
          ...c,
          moduleName: c.moduleName ?? mod.name,
        }))
        return {
          ...rec,
          moduleName: mod.name,
          ...(candidates ? { candidates } : {}),
        }
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

/**
 * Flatten every `candidates[]` across recommendations into a single
 * list, preserving module attribution. Recommendations that only set
 * `suggestedAction` + `confidence` (legacy) are projected into a single
 * synthetic candidate so the argmax layer can compare them with real
 * EV candidates.
 *
 * The legacy projection scales confidence into utility space via
 * `confidence * LEGACY_UTILITY_SCALE` so a 0.9-confidence legacy
 * recommendation beats a mediocre EV utility of ~5, but a strong
 * EV-scored finisher (utility 60+) still wins.
 */
export const LEGACY_UTILITY_SCALE = 30

export function collectAllCandidates(
  recommendations: readonly ArenaModuleRecommendation[],
): ArenaActionCandidate[] {
  const out: ArenaActionCandidate[] = []
  for (const rec of recommendations) {
    if (rec.candidates && rec.candidates.length > 0) {
      for (const c of rec.candidates) {
        out.push({
          ...c,
          moduleName: c.moduleName ?? rec.moduleName,
        })
      }
      continue
    }
    if (rec.suggestedAction) {
      out.push({
        action: rec.suggestedAction,
        reasoning: rec.reasoning,
        moduleName: rec.moduleName,
        utility: rec.confidence * LEGACY_UTILITY_SCALE,
        components: {
          expected_damage_dealt: 0,
          expected_damage_taken: 0,
          expected_heal: 0,
          strategic_bonus: rec.confidence * LEGACY_UTILITY_SCALE,
          risk_weight: 1,
        },
      })
    }
  }
  return out
}

/**
 * Return the argmax-utility candidate across all recommendations, or
 * `null` if nothing fired. Tiebreak rules (deterministic):
 *   1. Higher utility wins.
 *   2. On exact ties, prefer the candidate from a higher-priority module
 *      (modules are already sorted descending by priority in the
 *      registry), which is equivalent to preferring the earlier
 *      recommendation.
 *   3. Final tiebreak on action JSON string so the agent is reproducible.
 */
export function pickTopEvCandidate(
  recommendations: readonly ArenaModuleRecommendation[],
): ArenaActionCandidate | null {
  const candidates = collectAllCandidates(recommendations)
  if (candidates.length === 0) return null
  let best: ArenaActionCandidate | null = null
  for (const c of candidates) {
    if (best === null) {
      best = c
      continue
    }
    if (c.utility > best.utility) {
      best = c
      continue
    }
    if (c.utility === best.utility) {
      // Final stable tiebreak: JSON-stringified action, ascending.
      const a = JSON.stringify(c.action)
      const b = JSON.stringify(best.action)
      if (a < b) best = c
    }
  }
  return best
}
