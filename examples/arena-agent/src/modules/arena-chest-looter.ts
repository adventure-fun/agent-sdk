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
 * Chest positions come from the live observation
 * (`ArenaObservation.chest_positions`, populated server-side from
 * `state.map.chest_positions`). No constructor-time wiring required —
 * the module works out-of-the-box on any arena map.
 *
 * Bump-to-interact parity: the module tries to `interact` as soon as it
 * is within Chebyshev ≤ 1 of a live chest/loot drop, matching
 * `computeArenaLegalActions` and the dungeon pickup semantics.
 */
export class ArenaChestLooterModule implements ArenaAgentModule {
  readonly name = "arena-chest-looter"
  readonly priority = 80

  analyze(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    const greed = context.archetype?.chestGreedMultiplier ?? 1
    // Prefer live drops (chests that have already been opened and spawned
    // death-drop piles) over raw chest spawn tiles — the pile is the
    // actual loot. If no drops remain, fall back to the static chest
    // tiles for early-game pathing.
    const dropTargets = observation.death_drops.map((d) => d.position)
    const chestTargets = observation.chest_positions ?? []
    const targets = dropTargets.length > 0 ? dropTargets : chestTargets
    if (targets.length === 0) {
      return { reasoning: "No chests or loot piles on the map.", confidence: 0 }
    }

    const moves = observation.legal_actions.filter(
      (a): a is MoveAction => a.type === "move",
    )
    const interactActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "interact" }> => a.type === "interact",
    )

    const you = observation.you
    const hostilesByPosition = observation.entities.filter(
      (e) => e.id !== you.id && e.alive && !e.stealth,
    )

    // Bump-to-interact short-circuit: if the engine already emits an
    // interact action (i.e. a drop is within Chebyshev ≤ 1) just take it.
    // Matches the same 0.85 confidence the former "standing on the tile"
    // path used so it still beats the 0.80 module-first threshold.
    if (interactActions.length > 0) {
      const interact = interactActions[0]!
      return {
        suggestedAction: interact,
        reasoning: `Loot pile within reach — picking up pile ${interact.target_id}.`,
        confidence: clampConfidence(0.85 * greed),
      }
    }

    if (moves.length === 0) {
      return { reasoning: "No legal move actions — deferring to combat.", confidence: 0 }
    }

    const reachableTargets = targets.filter((target) => {
      const hostileAdjacent = hostilesByPosition.some(
        (h) => h.id !== you.id && chebyshev(h.position, target) <= 1,
      )
      return !hostileAdjacent
    })
    if (reachableTargets.length === 0) {
      return { reasoning: "Every chest / pile has a camper adjacent.", confidence: 0 }
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

    const target = reachableTargets
      .map((pos) => ({ pos, dist: chebyshev(you.position, pos) }))
      .sort((a, b) => a.dist - b.dist)[0]!

    // If we're already adjacent (Chebyshev ≤ 1) but no `interact` action
    // is legal, there must be no drop at that chest yet — keep the
    // recommendation low confidence so the LLM can pick combat instead.
    if (target.dist <= 1) {
      return {
        reasoning: `Already adjacent to target (${target.pos.x},${target.pos.y}) with no active pile.`,
        confidence: 0.3,
      }
    }

    const toward = chooseMoveToward(moves, you.position, target.pos)
    if (!toward) {
      return { reasoning: "No legal move reduces distance to chest.", confidence: 0 }
    }
    return {
      suggestedAction: toward,
      reasoning: `Pathing to loot at (${target.pos.x},${target.pos.y}) — ${target.dist} tiles away.`,
      confidence: clampConfidence(0.55 * greed),
      context: { chest: target.pos },
    }
  }
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 0.99) return 0.99
  return n
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
