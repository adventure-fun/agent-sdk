import type {
  Action,
  ArenaEntity,
  ArenaObservation,
} from "../../../../src/index.js"
import type {
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "./base.js"
import { rankThreats } from "./arena-threat-model.js"

/**
 * PvP-first combat module. Picks an attack from `obs.legal_actions` using this
 * order of preference:
 *
 *   1. Finish any player target whose current HP fits under our effective
 *      attack in a single hit (picked off `rankThreats` with `finishable`).
 *   2. Attack the highest-threat player target we have a legal attack against.
 *   3. Only if no player attack is legal, attack the highest-threat NPC.
 *   4. Otherwise defer (low confidence, no suggestion) so the positioning
 *      module can move.
 *
 * All targeting is consistent with the engine's `computeArenaLegalActions` —
 * we never invent a range or ability, we only filter the legal set.
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
    const confidenceBoost = context.archetype?.combatConfidenceBoost ?? 0

    const byId = new Map(observation.entities.map((e) => [e.id, e]))
    const legalByTarget = new Map<string, AttackAction[]>()
    for (const action of attackActions) {
      const list = legalByTarget.get(action.target_id) ?? []
      list.push(action)
      legalByTarget.set(action.target_id, list)
    }

    const threats = rankThreats(observation)
    const threatIndex = new Map(
      threats.map((t, i) => [t.entity.id, { entry: t, rank: i }]),
    )

    const playerFinishes = threats.filter(
      (t) => t.finishable && t.entity.kind === "player" && legalByTarget.has(t.entity.id),
    )
    if (playerFinishes.length > 0) {
      const pick = playerFinishes[0]!
      const action = chooseBestAttackAction(legalByTarget.get(pick.entity.id)!, pick.entity)
      return {
        suggestedAction: action,
        reasoning: `Finishing ${pick.entity.name} at ${pick.entity.hp.current} HP.`,
        confidence: clamp01(0.97 + confidenceBoost),
        context: { target_id: pick.entity.id, finishable: true },
      }
    }

    const legalPlayerTargets = threats.filter(
      (t) => t.entity.kind === "player" && legalByTarget.has(t.entity.id),
    )
    if (legalPlayerTargets.length > 0) {
      const pick = legalPlayerTargets[0]!
      const action = chooseBestAttackAction(legalByTarget.get(pick.entity.id)!, pick.entity)
      return {
        suggestedAction: action,
        reasoning: `Engaging ${pick.entity.name} (highest player threat in range).`,
        confidence: clamp01(0.85 + confidenceBoost),
        context: { target_id: pick.entity.id, finishable: false },
      }
    }

    const legalNpcTargets = threats.filter(
      (t) => t.entity.kind === "npc" && legalByTarget.has(t.entity.id),
    )
    if (legalNpcTargets.length > 0) {
      const pick = legalNpcTargets[0]!
      const action = chooseBestAttackAction(legalByTarget.get(pick.entity.id)!, pick.entity)
      return {
        suggestedAction: action,
        reasoning: `No player in attack range; clearing NPC ${pick.entity.name}.`,
        confidence: clamp01(0.65 + confidenceBoost),
        context: { target_id: pick.entity.id, npc: true },
      }
    }

    void byId
    void threatIndex
    return { reasoning: "Attack targets exist but no ranked target was resolved.", confidence: 0 }
  }
}

type AttackAction = Extract<Action, { type: "attack" }>

function isAttackAction(action: Action): action is AttackAction {
  return action.type === "attack"
}

/**
 * Among the legal `attack` actions against a single target, prefer the one
 * carrying an `ability_id` over a bare basic attack. If multiple abilities are
 * available, pick the first encountered (the engine emits them in definition
 * order, which is stable for a given content bundle).
 */
function chooseBestAttackAction(
  candidates: AttackAction[],
  _target: ArenaEntity,
): AttackAction {
  const withAbility = candidates.find((a) => a.ability_id)
  return withAbility ?? candidates[0]!
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}
