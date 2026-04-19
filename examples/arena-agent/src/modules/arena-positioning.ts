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
import { chebyshev, manhattan } from "./base.js"
import { rankThreats } from "./arena-threat-model.js"
import { buildUtilityContext, scoreMoveCandidate } from "./utility.js"
import { getArchetypeProfile } from "./archetypes.js"

type MoveAction = Extract<Action, { type: "move" }>

/**
 * Positioning module — contributes EV-scored move candidates for two
 * strategic intents that are independent from the approach module:
 *
 *   1. Break range from a losing exchange: if the top threat is within 2
 *      tiles and we're losing on HP ratio, candidates that INCREASE
 *      distance get a positive strategic bonus (scaled by archetype
 *      fleeDistanceBonus).
 *
 *   2. Grace / wave center-pull: during grace or within 2 turns of a wave
 *      spawn, moves toward the map center get a small strategic bonus so
 *      bots don't get pinned against an edge.
 */
export class ArenaPositioningModule implements ArenaAgentModule {
  readonly name = "arena-positioning"
  readonly priority = 85

  analyze(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    const moves = observation.legal_actions.filter(isMoveAction)
    if (moves.length === 0) {
      return { reasoning: "No legal move actions available.", confidence: 0 }
    }

    const archetype = context.archetype ?? getArchetypeProfile("balanced")
    const utilCtx = buildUtilityContext(observation, archetype)
    const { you, grid } = observation
    const center = {
      x: Math.floor((grid[0]?.length ?? 0) / 2),
      y: Math.floor(grid.length / 2),
    }

    const threats = rankThreats(observation)
    const topThreat = threats[0]

    const waveIncoming =
      observation.next_wave_turn !== null &&
      observation.next_wave_turn - observation.turn <= 2
    const graceOrWave = observation.phase === "grace" || waveIncoming

    // Determine if we should flee the top threat.
    let fleeTarget: { x: number; y: number } | null = null
    if (topThreat && topThreat.entity.kind === "player") {
      const myHpRatio = you.hp.current / Math.max(1, you.hp.max)
      const theirHpRatio =
        topThreat.entity.hp.current / Math.max(1, topThreat.entity.hp.max)
      const tooClose = manhattan(you.position, topThreat.entity.position) <= 2
      if (tooClose && myHpRatio < theirHpRatio) {
        fleeTarget = topThreat.entity.position
      }
    }

    const candidates: ArenaActionCandidate[] = []
    for (const move of moves) {
      const delta = DIRECTION_DELTAS[move.direction]
      const next = { x: you.position.x + delta.dx, y: you.position.y + delta.dy }

      let strategicBonus = 0
      let reasoning = `Positioning ${move.direction}`

      if (fleeTarget) {
        const before = chebyshev(you.position, fleeTarget)
        const after = chebyshev(next, fleeTarget)
        // Moving away adds strategic value; moving closer subtracts.
        const distDelta = after - before
        const fleeMagnitude = 10 + (archetype.fleeDistanceBonus ?? 0) * 2
        strategicBonus += distDelta * fleeMagnitude
        reasoning = `Break range from top threat via ${move.direction}`
      }

      if (graceOrWave) {
        const before = chebyshev(you.position, center)
        const after = chebyshev(next, center)
        strategicBonus += (before - after) * 4
      }

      const scored = scoreMoveCandidate(utilCtx, move, {
        strategicBonus,
        reasoning,
      })
      candidates.push(scored)
    }

    const top = [...candidates].sort((a, b) => b.utility - a.utility)[0]!

    return {
      suggestedAction: top.action,
      reasoning: top.reasoning,
      confidence: fleeTarget ? 0.55 : graceOrWave ? 0.5 : 0.3,
      candidates,
      context: {
        flee_target: fleeTarget,
        grace_or_wave: graceOrWave,
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

function isMoveAction(action: Action): action is MoveAction {
  return action.type === "move"
}
