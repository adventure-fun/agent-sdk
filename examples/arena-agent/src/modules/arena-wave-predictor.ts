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
import { buildUtilityContext, scoreMoveCandidate } from "./utility.js"
import { getArchetypeProfile } from "./archetypes.js"

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
 * Wave-bait positioning module — EV scored. When the next NPC wave is
 * within 2 turns, emits move candidates that reposition us between the
 * nearest spawn point and the closest opponent, with a strategic bonus
 * scaled by aggression (aggressive bots are more willing to take the
 * bait risk).
 */
export class ArenaWavePredictorModule implements ArenaAgentModule {
  readonly name = "arena-wave-predictor"
  readonly priority = 70

  analyze(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    const spawnPoints = observation.spawn_points ?? []
    if (spawnPoints.length === 0) {
      return { reasoning: "No spawn points on the map.", confidence: 0 }
    }
    if (observation.next_wave_turn === null) {
      return { reasoning: "No wave scheduled.", confidence: 0 }
    }
    const turnsUntilWave = observation.next_wave_turn - observation.turn
    if (turnsUntilWave > 2 || turnsUntilWave < 0) {
      return { reasoning: `Wave not imminent (${turnsUntilWave} turns away).`, confidence: 0 }
    }

    const archetype = context.archetype ?? getArchetypeProfile("balanced")
    const utilCtx = buildUtilityContext(observation, archetype)
    const you = observation.you

    const opponents = observation.entities.filter(
      (e) => e.id !== you.id && e.alive && !e.stealth && e.kind === "player",
    )
    if (opponents.length === 0) {
      return { reasoning: "No player opponents to bait wave toward.", confidence: 0 }
    }

    const target = opponents
      .map((o) => ({ o, d: manhattan(you.position, o.position) }))
      .sort((a, b) => a.d - b.d)[0]!.o

    const moves = observation.legal_actions.filter(
      (a): a is MoveAction => a.type === "move",
    )
    if (moves.length === 0) {
      return { reasoning: "No legal move to reposition.", confidence: 0 }
    }

    const spawnNearTarget = [...spawnPoints]
      .map((s) => ({ s, d: manhattan(s, target.position) }))
      .sort((a, b) => a.d - b.d)[0]!.s

    const candidates: ArenaActionCandidate[] = []
    for (const move of moves) {
      const delta = DIRECTION_DELTAS[move.direction]
      const next = { x: you.position.x + delta.dx, y: you.position.y + delta.dy }
      const before = chebyshev(you.position, target.position)
      const after = chebyshev(next, target.position)
      const gain = before - after
      // Wave-bait bonus: moving toward target gets a bonus proportional
      // to aggression; turnsUntilWave urgency amplifies it.
      const baitMagnitude = (3 - turnsUntilWave) * 4 * (0.4 + archetype.aggression)
      const strategicBonus = gain * baitMagnitude
      candidates.push(
        scoreMoveCandidate(utilCtx, move, {
          target: target.position,
          strategicBonus,
          reasoning: `Wave-bait ${move.direction} — bait ${target.name} into spawn (${spawnNearTarget.x},${spawnNearTarget.y})`,
        }),
      )
    }

    const top = [...candidates].sort((a, b) => b.utility - a.utility)[0]!
    return {
      suggestedAction: top.action,
      reasoning: top.reasoning,
      confidence: 0.5,
      candidates,
      context: { target_opponent: target.id, spawn_point: spawnNearTarget },
    }
  }
}
