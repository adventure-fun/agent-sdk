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
 * Wave-bait positioning module. When the next NPC wave is within 2 turns,
 * moves in the direction that brings us closer to the opponent while keeping
 * the nearest spawn point on the opposite side of the opponent — NPCs that
 * spawn at the opponent's edge will path toward the nearest target and will
 * hit the opponent first, not us.
 *
 * Geometry:
 *   - Identify the spawn point farthest from us (nearest to the opponent we
 *     want to bait).
 *   - Choose the legal move that minimizes the chebyshev distance to that
 *     opponent, i.e. place ourselves between the opponent and their side of
 *     the map.
 *
 * Spawn points live on `ArenaMap.spawn_points`, which is not in the
 * observation, so the runner plumbs them in via constructor.
 */
export class ArenaWavePredictorModule implements ArenaAgentModule {
  readonly name = "arena-wave-predictor"
  readonly priority = 70
  private readonly spawnPoints: ReadonlyArray<{ x: number; y: number }>

  constructor(spawnPoints: ReadonlyArray<{ x: number; y: number }> = []) {
    this.spawnPoints = spawnPoints
  }

  analyze(
    observation: ArenaObservation,
    _context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    if (this.spawnPoints.length === 0) {
      return { reasoning: "No spawn points configured.", confidence: 0 }
    }
    if (observation.next_wave_turn === null) {
      return { reasoning: "No wave scheduled.", confidence: 0 }
    }
    const turnsUntilWave = observation.next_wave_turn - observation.turn
    if (turnsUntilWave > 2 || turnsUntilWave < 0) {
      return { reasoning: `Wave not imminent (${turnsUntilWave} turns away).`, confidence: 0 }
    }

    const you = observation.you
    const opponents = observation.entities.filter(
      (e) => e.id !== you.id && e.alive && !e.stealth && e.kind === "player",
    )
    if (opponents.length === 0) {
      return { reasoning: "No player opponents to bait wave toward.", confidence: 0 }
    }

    // Target opponent = closest player. Baiting a far-away player is
    // unlikely to land since wave NPCs typically go after the nearest
    // target to their spawn tile.
    const target = opponents
      .map((o) => ({ o, d: manhattan(you.position, o.position) }))
      .sort((a, b) => a.d - b.d)[0]!.o

    const moves = observation.legal_actions.filter(
      (a): a is MoveAction => a.type === "move",
    )
    if (moves.length === 0) {
      return { reasoning: "No legal move to reposition.", confidence: 0 }
    }

    // Pick the spawn nearest to the target opponent — that's the spawn
    // whose NPCs will approach the opponent first as we slide alongside.
    const spawnNearTarget = [...this.spawnPoints]
      .map((s) => ({ s, d: manhattan(s, target.position) }))
      .sort((a, b) => a.d - b.d)[0]!.s

    // Best move = the one that minimizes distance to the target opponent
    // WHILE keeping us on the opposite side of them from that spawn point.
    // In practice: move toward the target. If the target is between us and
    // the spawn, we'll pull past them on the next turn.
    let best: MoveAction | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const move of moves) {
      const delta = DIRECTION_DELTAS[move.direction]
      const next = { x: you.position.x + delta.dx, y: you.position.y + delta.dy }
      const score = chebyshev(next, target.position)
      if (score < bestScore) {
        bestScore = score
        best = move
      }
    }
    if (!best) {
      return { reasoning: "No move reduces distance to target opponent.", confidence: 0 }
    }

    return {
      suggestedAction: best,
      reasoning:
        `Wave arrives in ${turnsUntilWave}t — sliding toward ${target.name} so the wave ` +
        `spawning at (${spawnNearTarget.x},${spawnNearTarget.y}) pressures them first.`,
      confidence: 0.55,
      context: { target_opponent: target.id, spawn_point: spawnNearTarget },
    }
  }
}
