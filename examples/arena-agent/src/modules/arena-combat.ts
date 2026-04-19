import type {
  Action,
  ArenaEntity,
  ArenaObservation,
} from "../../../../src/index.js"
import type {
  ArenaActionCandidate,
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "./base.js"
import { rankThreats } from "./arena-threat-model.js"
import {
  buildUtilityContext,
  scoreAttackCandidate,
} from "./utility.js"
import { getArchetypeProfile } from "./archetypes.js"

/**
 * PvP-first combat module, EV-scored. Instead of returning a single
 * hand-picked suggestion, emits one candidate per legal attack action
 * with a utility that combines:
 *
 *   - Expected damage dealt (hit chance × expected damage).
 *   - Kill bonus when the attack would finish the target.
 *   - PvP preference (aggression-weighted).
 *   - NPC penalty when player targets are available.
 *   - Risk: expected incoming damage × archetype.riskWeight.
 *
 * The decision layer argmaxes across ALL module candidates, so this module
 * no longer needs to return a "top pick" — it just contributes options.
 * `suggestedAction` + `confidence` are still populated for backward
 * compatibility with callers that ignore `candidates[]`.
 */
export class ArenaCombatModule implements ArenaAgentModule {
  readonly name = "arena-combat"
  readonly priority = 92

  analyze(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    const attackActions = observation.legal_actions.filter(isAttackAction)
    if (attackActions.length === 0) {
      return { reasoning: "No legal attack targets.", confidence: 0 }
    }

    const archetype = context.archetype ?? getArchetypeProfile("balanced")
    const utilCtx = buildUtilityContext(observation, archetype)

    const byId = new Map(observation.entities.map((e) => [e.id, e]))
    const candidates: ArenaActionCandidate[] = []
    for (const action of attackActions) {
      const target = byId.get(action.target_id)
      if (!target || !target.alive) continue
      const scored = scoreAttackCandidate(utilCtx, action, target)
      candidates.push(scored)
    }
    if (candidates.length === 0) {
      return { reasoning: "No attackable live targets.", confidence: 0 }
    }

    // Pick the top candidate for the legacy suggestedAction path, so
    // callers ignoring candidates[] still see a sane pick.
    const top = [...candidates].sort((a, b) => b.utility - a.utility)[0]!
    const confidenceBoost = archetype.combatConfidenceBoost ?? 0
    const confidence = clamp01(0.75 + confidenceBoost)

    // Surface the threat ranking in context for debugging.
    const threats = rankThreats(observation)
    const threatIndex = new Map(
      threats.map((t, i) => [t.entity.id, { entry: t, rank: i }]),
    )
    void threatIndex

    return {
      suggestedAction: top.action,
      reasoning: `EV pick: ${top.reasoning} (utility ${top.utility.toFixed(2)})`,
      confidence,
      candidates,
      context: { top_utility: top.utility },
    }
  }
}

type AttackAction = Extract<Action, { type: "attack" }>

function isAttackAction(action: Action): action is AttackAction {
  return action.type === "attack"
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

// Re-export for downstream helpers
export type { ArenaEntity }
