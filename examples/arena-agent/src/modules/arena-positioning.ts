import type {
  Action,
  ArenaObservation,
} from "../../../../src/index.js"
import type {
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "./base.js"
import { chebyshev, manhattan } from "./base.js"
import { rankThreats } from "./arena-threat-model.js"

type Direction = "up" | "down" | "left" | "right"
type MoveAction = Extract<Action, { type: "move" }>

const DIRECTION_DELTAS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

/**
 * Movement-only fallback module. `arena-combat` owns attacks; this module
 * picks between "move toward center" (grace phase or imminent wave) and
 * "break range from a dangerous nearby opponent". Never chooses to wait —
 * if neither heuristic fires, returns no suggestion and lets the tactical
 * LLM decide.
 */
export class ArenaPositioningModule implements ArenaAgentModule {
  readonly name = "arena-positioning"
  readonly priority = 85

  analyze(
    observation: ArenaObservation,
    _context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    const moves = observation.legal_actions.filter(isMoveAction)
    if (moves.length === 0) {
      return { reasoning: "No legal move actions available.", confidence: 0 }
    }

    const { you, grid } = observation
    const center = {
      x: Math.floor((grid[0]?.length ?? 0) / 2),
      y: Math.floor(grid.length / 2),
    }

    // Heuristic 1 — break range if losing a nearby exchange. "Losing" = our
    // HP ratio is below the highest-threat opponent's HP ratio AND they're
    // within 2 tiles (the engine's PvP ability range ceiling).
    const threats = rankThreats(observation)
    const topThreat = threats[0]
    if (topThreat) {
      const myHpRatio = you.hp.current / Math.max(1, you.hp.max)
      const theirHpRatio =
        topThreat.entity.hp.current / Math.max(1, topThreat.entity.hp.max)
      const tooClose = manhattan(you.position, topThreat.entity.position) <= 2
      if (tooClose && myHpRatio < theirHpRatio && topThreat.entity.kind === "player") {
        const away = chooseMoveAway(moves, you.position, topThreat.entity.position)
        if (away) {
          return {
            suggestedAction: away,
            reasoning:
              `Breaking range from ${topThreat.entity.name} — HP ratio ${myHpRatio.toFixed(2)} ` +
              `vs ${theirHpRatio.toFixed(2)}.`,
            confidence: 0.8,
            context: { broke_from: topThreat.entity.id },
          }
        }
      }
    }

    // Heuristic 2 — wave imminent (within 2 turns) or still in grace: close
    // to center so we're not pinned against an edge when the wave spawns.
    const waveIncoming =
      observation.next_wave_turn !== null &&
      observation.next_wave_turn - observation.turn <= 2
    if (observation.phase === "grace" || waveIncoming) {
      const toward = chooseMoveToward(moves, you.position, center)
      if (toward) {
        return {
          suggestedAction: toward,
          reasoning:
            observation.phase === "grace"
              ? "Grace phase — moving toward map center."
              : `Wave incoming (turn ${observation.next_wave_turn}) — moving to center.`,
          confidence: 0.7,
          context: { target: "center" },
        }
      }
    }

    return { reasoning: "No positioning heuristic fired.", confidence: 0 }
  }
}

function isMoveAction(action: Action): action is MoveAction {
  return action.type === "move"
}

function chooseMoveToward(
  moves: MoveAction[],
  from: { x: number; y: number },
  to: { x: number; y: number },
): MoveAction | null {
  let best: MoveAction | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const move of moves) {
    const delta = DIRECTION_DELTAS[move.direction]
    const next = { x: from.x + delta.dx, y: from.y + delta.dy }
    const score = chebyshev(next, to)
    if (score < bestScore) {
      bestScore = score
      best = move
    }
  }
  return best
}

function chooseMoveAway(
  moves: MoveAction[],
  from: { x: number; y: number },
  threat: { x: number; y: number },
): MoveAction | null {
  let best: MoveAction | null = null
  let bestScore = -1
  for (const move of moves) {
    const delta = DIRECTION_DELTAS[move.direction]
    const next = { x: from.x + delta.dx, y: from.y + delta.dy }
    const score = chebyshev(next, threat)
    if (score > bestScore) {
      bestScore = score
      best = move
    }
  }
  return best
}
