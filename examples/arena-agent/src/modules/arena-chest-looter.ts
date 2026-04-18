import type {
  Action,
  ArenaObservation,
} from "../../../../src/index.js"
import type {
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "./base.js"
import { chebyshev } from "./base.js"

type MoveAction = Extract<Action, { type: "move" }>

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
 * Greedy chest-running module. Only acts in two windows:
 *
 *   (a) Early game (round ≤ 5), regardless of threat distance.
 *   (b) Late game (round > 5) only when NO hostile entity sits within 3
 *       Chebyshev tiles of the agent — i.e. we have breathing room.
 *
 * Either way, the nearest un-adjacent chest is picked; chests with a hostile
 * entity already adjacent are always excluded (running into a camper is a
 * loss). Pathfinding is a single-step greedy move — a full BFS is overkill
 * for the open arena maps we ship with, and the tactical LLM can correct
 * degenerate cases on subsequent turns.
 *
 * The arena observation doesn't carry a chest list directly (chests live on
 * the static `ArenaMap.chest_positions`), so the module accepts the list via
 * constructor. The `runArenaMatch` bootstrap will plumb it from map content.
 */
export class ArenaChestLooterModule implements ArenaAgentModule {
  readonly name = "arena-chest-looter"
  readonly priority = 80
  private readonly chestPositions: ReadonlyArray<{ x: number; y: number }>

  constructor(chestPositions: ReadonlyArray<{ x: number; y: number }> = []) {
    this.chestPositions = chestPositions
  }

  analyze(
    observation: ArenaObservation,
    _context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    if (this.chestPositions.length === 0) {
      return { reasoning: "No chest positions configured.", confidence: 0 }
    }

    const moves = observation.legal_actions.filter(
      (a): a is MoveAction => a.type === "move",
    )
    if (moves.length === 0) {
      return { reasoning: "No legal move actions — deferring to combat.", confidence: 0 }
    }

    const you = observation.you
    const hostilesByPosition = observation.entities.filter(
      (e) => e.id !== you.id && e.alive && !e.stealth,
    )

    const reachableChests = this.chestPositions.filter((chest) => {
      const hostileAdjacent = hostilesByPosition.some(
        (h) => chebyshev(h.position, chest) <= 1,
      )
      return !hostileAdjacent
    })
    if (reachableChests.length === 0) {
      return { reasoning: "Every chest has a camper adjacent.", confidence: 0 }
    }

    // Late game gate: require ≥4 tiles of breathing room.
    if (observation.round > 5) {
      const anyClose = hostilesByPosition.some(
        (h) => chebyshev(h.position, you.position) < 3,
      )
      if (anyClose) {
        return {
          reasoning: "Hostile within 3 tiles in round > 5 — too dangerous to loot.",
          confidence: 0,
        }
      }
    }

    const target = reachableChests
      .map((chest) => ({ chest, dist: chebyshev(you.position, chest) }))
      .sort((a, b) => a.dist - b.dist)[0]!
    if (target.dist === 0) {
      return {
        reasoning: "Standing on chest tile — tactical LLM can choose interact.",
        confidence: 0,
      }
    }

    const toward = chooseMoveToward(moves, you.position, target.chest)
    if (!toward) {
      return { reasoning: "No legal move reduces distance to chest.", confidence: 0 }
    }
    return {
      suggestedAction: toward,
      reasoning: `Pathing to chest at (${target.chest.x},${target.chest.y}) — ${target.dist} tiles away.`,
      confidence: 0.55,
      context: { chest: target.chest },
    }
  }
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
