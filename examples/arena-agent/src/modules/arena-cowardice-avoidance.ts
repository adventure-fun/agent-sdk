import type {
  Action,
  ArenaObservation,
  ProximityWarning,
} from "../../../../src/index.js"
import type {
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "./base.js"
import { chebyshev } from "./base.js"

type MoveAction = Extract<Action, { type: "move" }>
type AttackAction = Extract<Action, { type: "attack" }>

const DIRECTION_DELTAS: Record<
  "up" | "down" | "left" | "right",
  { dx: number; dy: number }
> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

/**
 * Hard-priority module that ensures the proximity counter never actually
 * ticks to the damage threshold. Runs FIRST (priority 95) so it can override
 * every lower-priority module when the pairing is about to punish the agent.
 *
 * Rules:
 *   - Only fires when at least one `ProximityWarning` includes `you.id`.
 *   - Prefers `attack` against the paired opponent when the agent has clear
 *     HP advantage (>= 15 percentage-point gap) OR when the opponent is
 *     already finishable — committing to the exchange resets the counter.
 *   - Otherwise moves in the direction that maximizes Chebyshev distance to
 *     the paired opponent(s). Never submits `wait`, even if it is the only
 *     listed option — `wait` guarantees counter tick.
 *   - If no move is legal and no attack is available, defers (confidence 0)
 *     and lets the tactical LLM intervene.
 */
export class ArenaCowardiceAvoidanceModule implements ArenaAgentModule {
  readonly name = "arena-cowardice-avoidance"
  readonly priority = 95

  analyze(
    observation: ArenaObservation,
    _context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
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

    const attacks = observation.legal_actions.filter(
      (a): a is AttackAction => a.type === "attack",
    )

    const myHpRatio = you.hp.current / Math.max(1, you.hp.max)
    const myAttack = you.effective_stats?.attack ?? you.stats.attack

    for (const opponent of opponents) {
      const attackable = attacks.find((a) => a.target_id === opponent.id)
      if (!attackable) continue
      const theirHpRatio = opponent.hp.current / Math.max(1, opponent.hp.max)
      const finishable = opponent.hp.current <= myAttack
      const hpAdvantage = myHpRatio - theirHpRatio >= 0.15
      if (finishable || hpAdvantage) {
        return {
          suggestedAction: attackable,
          reasoning: finishable
            ? `Committing to finish ${opponent.name} — cowardice tick imminent.`
            : `HP advantage vs ${opponent.name} (${myHpRatio.toFixed(2)} vs ${theirHpRatio.toFixed(2)}) — attacking.`,
          confidence: 0.95,
          context: { committed_to: opponent.id, turns_until_damage: worstTurnsUntilDamage(involving) },
        }
      }
    }

    const moves = observation.legal_actions.filter(
      (a): a is MoveAction => a.type === "move",
    )
    if (moves.length > 0) {
      const away = chooseMoveAwayFromAll(moves, you.position, opponents.map((o) => o.position))
      if (away) {
        return {
          suggestedAction: away,
          reasoning:
            `Breaking range to avoid cowardice damage (turns_until=${worstTurnsUntilDamage(involving)}).`,
          confidence: 0.9,
          context: { fleeing_from: opponentIds },
        }
      }
    }

    return {
      reasoning: "No attack or legal move resolves the pairing — deferring.",
      confidence: 0,
    }
  }
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

function chooseMoveAwayFromAll(
  moves: MoveAction[],
  from: { x: number; y: number },
  threats: Array<{ x: number; y: number }>,
): MoveAction | null {
  if (threats.length === 0) return moves[0] ?? null
  let best: MoveAction | null = null
  let bestScore = -1
  for (const move of moves) {
    const delta = DIRECTION_DELTAS[move.direction]
    const next = { x: from.x + delta.dx, y: from.y + delta.dy }
    const score = threats.reduce((sum, t) => sum + chebyshev(next, t), 0)
    if (score > bestScore) {
      bestScore = score
      best = move
    }
  }
  return best
}
