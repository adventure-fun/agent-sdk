import type {
  Action,
  ArenaObservation,
} from "../../../../src/index.js"
import type {
  ArenaActionCandidate,
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "./base.js"
import {
  buildUtilityContext,
  scoreMoveCandidate,
} from "./utility.js"
import { chebyshev, manhattan } from "./base.js"
import { getArchetypeProfile } from "./archetypes.js"

type MoveAction = Extract<Action, { type: "move" }>

/**
 * Approach module — closes the gap to the weakest player opponent whenever
 * no attack is legal yet. This is the primary driver of "bots actually
 * engage" behavior: without it, positioning alone only kicks in during
 * grace/wave windows, and deterministic bots drift on the map.
 *
 * Design:
 *   - Only emits candidates when there's no LEGAL attack yet (if combat
 *     is already in reach, ArenaCombatModule takes over).
 *   - Targets the weakest living PLAYER opponent inside
 *     `archetype.approachDistanceMax`. Falls back to nearest NPC when
 *     no player is within range (prevents aggressive bots from
 *     idling in an NPC-only phase).
 *   - Emits one candidate per legal `move` action; each scored with
 *     `scoreMoveCandidate({ target, strategicBonus })` so the decision
 *     layer can pick the argmax across approach + positioning + chest +
 *     wave candidates.
 *   - `strategicBonus` scales with `archetype.aggression` so aggressive
 *     bots commit harder to approach moves.
 */
export class ArenaApproachModule implements ArenaAgentModule {
  readonly name = "arena-approach"
  readonly priority = 78

  analyze(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    const archetype = context.archetype ?? getArchetypeProfile("balanced")
    const utilCtx = buildUtilityContext(observation, archetype)

    const moves = observation.legal_actions.filter(isMoveAction)
    if (moves.length === 0) {
      return { reasoning: "No legal move actions.", confidence: 0 }
    }

    const hasLegalAttack = observation.legal_actions.some((a) => a.type === "attack")
    if (hasLegalAttack) {
      // Combat owns this turn; approach doesn't contribute candidates.
      return { reasoning: "Attacks legal — deferring to combat.", confidence: 0 }
    }

    const maxDist = archetype.approachDistanceMax
    const you = observation.you

    const playerTargets = utilCtx.playerOpponentsByDistance.filter(
      (e) => chebyshev(you.position, e.position) <= maxDist,
    )
    const npcTargets = utilCtx.opponentsByDistance.filter(
      (e) => e.kind === "npc" && chebyshev(you.position, e.position) <= maxDist,
    )

    let target: { x: number; y: number } | null = null
    let reason = ""

    if (playerTargets.length > 0) {
      // Target weakest player in range — finishing them yields the biggest
      // placement bump. Ties broken by distance (closer is easier to commit).
      const weakest = [...playerTargets].sort((a, b) => {
        if (a.hp.current !== b.hp.current) return a.hp.current - b.hp.current
        return (
          manhattan(you.position, a.position) - manhattan(you.position, b.position)
        )
      })[0]!
      target = weakest.position
      reason = `Approaching weakest player ${weakest.name} (HP ${weakest.hp.current})`
    } else if (npcTargets.length > 0) {
      const nearestNpc = npcTargets[0]!
      target = nearestNpc.position
      reason = `Approaching nearest NPC ${nearestNpc.name}`
    } else {
      return {
        reasoning: `No opponent within approach range ${maxDist}.`,
        confidence: 0,
      }
    }

    const aggressionBonus = 5 * archetype.aggression

    const candidates: ArenaActionCandidate[] = []
    for (const move of moves) {
      const scored = scoreMoveCandidate(utilCtx, move, {
        target,
        strategicBonus: aggressionBonus,
        reasoning: `${reason} via ${move.direction}`,
      })
      candidates.push(scored)
    }

    const top = [...candidates].sort((a, b) => b.utility - a.utility)[0]!
    return {
      suggestedAction: top.action,
      reasoning: top.reasoning,
      confidence: 0.6,
      candidates,
      context: { approach_target: target },
    }
  }
}

function isMoveAction(action: Action): action is MoveAction {
  return action.type === "move"
}
