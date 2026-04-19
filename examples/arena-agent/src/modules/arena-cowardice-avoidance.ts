import type {
  Action,
  ArenaObservation,
  ProximityWarning,
} from "../../../../src/index.js"
import type {
  ArenaActionCandidate,
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "./base.js"
import { chebyshev } from "./base.js"
import {
  buildUtilityContext,
  scoreAttackCandidate,
  scoreMoveCandidate,
} from "./utility.js"
import { getArchetypeProfile } from "./archetypes.js"

type MoveAction = Extract<Action, { type: "move" }>
type AttackAction = Extract<Action, { type: "attack" }>

/**
 * Cowardice-avoidance module. Emits BOTH commit-to-attack and flee
 * candidates whenever a proximity warning involves `self`, letting the
 * EV decision layer pick between them based on archetype:
 *
 *   - Commit: every legal attack on a paired opponent gets a large
 *     strategic_bonus when `self` has HP-ratio advantage >=
 *     `archetype.commitHpAdvantageThreshold`. Cautious archetypes need
 *     a bigger edge; aggressive bots commit at near-parity.
 *   - Flee: every legal move gets a strategic bonus proportional to how
 *     much it increases Chebyshev distance to all paired opponents.
 *
 * When no proximity warning involves `self`, the module returns no
 * candidates and stays silent.
 */
export class ArenaCowardiceAvoidanceModule implements ArenaAgentModule {
  readonly name = "arena-cowardice-avoidance"
  readonly priority = 95

  analyze(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    const archetype = context.archetype ?? getArchetypeProfile("balanced")
    const you = observation.you
    const involving = observation.proximity_warnings.filter(
      (w) => w.player_a === you.id || w.player_b === you.id,
    )
    if (involving.length === 0) {
      return { reasoning: "No proximity warnings involve us.", confidence: 0 }
    }

    const opponentIds = involving.map((w) => partnerId(w, you.id))
    const opponents = observation.entities.filter(
      (e) => opponentIds.includes(e.id) && e.alive,
    )
    if (opponents.length === 0) {
      return { reasoning: "Paired opponents are no longer alive.", confidence: 0 }
    }

    const utilCtx = buildUtilityContext(observation, archetype)
    const turnsUntilDamage = worstTurnsUntilDamage(involving)
    const urgency = Math.max(2, 6 - turnsUntilDamage)

    const candidates: ArenaActionCandidate[] = []

    // Commit candidates: attack any paired opponent (above HP threshold).
    const attacks = observation.legal_actions.filter(
      (a): a is AttackAction => a.type === "attack",
    )
    const myHpRatio = you.hp.current / Math.max(1, you.hp.max)

    for (const opponent of opponents) {
      const attackable = attacks.filter((a) => a.target_id === opponent.id)
      if (attackable.length === 0) continue
      const theirHpRatio = opponent.hp.current / Math.max(1, opponent.hp.max)
      const hpAdvantage = myHpRatio - theirHpRatio
      const commitBonus =
        hpAdvantage >= archetype.commitHpAdvantageThreshold
          ? 15 * urgency * (0.5 + archetype.aggression)
          : 0
      for (const action of attackable) {
        const scored = scoreAttackCandidate(utilCtx, action, opponent)
        candidates.push({
          ...scored,
          utility: scored.utility + commitBonus,
          reasoning: `${scored.reasoning} (commit bonus ${commitBonus.toFixed(1)}, turns_until=${turnsUntilDamage})`,
          components: {
            ...scored.components,
            strategic_bonus: scored.components.strategic_bonus + commitBonus,
          },
        })
      }
    }

    // Flee candidates: any legal move gets strategic bonus proportional to
    // how much it increases summed distance to paired opponents.
    const moves = observation.legal_actions.filter(
      (a): a is MoveAction => a.type === "move",
    )
    for (const move of moves) {
      const delta = DIRECTION_DELTAS[move.direction]
      const next = { x: you.position.x + delta.dx, y: you.position.y + delta.dy }
      const currentSum = opponents.reduce(
        (sum, o) => sum + chebyshev(you.position, o.position),
        0,
      )
      const nextSum = opponents.reduce(
        (sum, o) => sum + chebyshev(next, o.position),
        0,
      )
      const gain = nextSum - currentSum
      const fleeMagnitude = 8 * urgency * (1 - archetype.aggression * 0.5)
      const strategicBonus = gain * fleeMagnitude
      const scored = scoreMoveCandidate(utilCtx, move, {
        strategicBonus,
        reasoning: `Flee paired opp (Δdist ${gain}, urgency ${urgency.toFixed(1)})`,
      })
      candidates.push(scored)
    }

    if (candidates.length === 0) {
      return {
        reasoning: "No attack or legal move resolves the pairing — deferring.",
        confidence: 0,
      }
    }

    const top = [...candidates].sort((a, b) => b.utility - a.utility)[0]!
    return {
      suggestedAction: top.action,
      reasoning: top.reasoning,
      confidence: 0.7,
      candidates,
      context: {
        pairing: opponentIds,
        turns_until_damage: turnsUntilDamage,
      },
    }
  }
}

const DIRECTION_DELTAS: Record<
  "up" | "down" | "left" | "right",
  { dx: number; dy: number }
> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

function partnerId(warning: ProximityWarning, selfId: string): string {
  return warning.player_a === selfId ? warning.player_b : warning.player_a
}

function worstTurnsUntilDamage(warnings: ProximityWarning[]): number {
  return warnings.reduce(
    (min, w) => (w.turns_until_damage < min ? w.turns_until_damage : min),
    Number.POSITIVE_INFINITY,
  )
}
