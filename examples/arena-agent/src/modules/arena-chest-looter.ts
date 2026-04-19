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
import { chebyshev } from "./base.js"
import {
  buildUtilityContext,
  scoreInteractCandidate,
  scoreMoveCandidate,
} from "./utility.js"
import { getArchetypeProfile } from "./archetypes.js"

type MoveAction = Extract<Action, { type: "move" }>
type InteractAction = Extract<Action, { type: "interact" }>

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
 * Chest-looter module — EV scored. Contributes two kinds of candidates:
 *
 *   - Interact candidates for every legal `interact` action, scored via
 *     `scoreInteractCandidate` (greed-weighted, item-count-weighted,
 *     camper-penalty).
 *   - Move candidates heading toward the nearest SAFE loot pile,
 *     scored via `scoreMoveCandidate({ target, strategicBonus })` with
 *     `strategicBonus = 10 * archetype.greed / max(1, distance)`.
 *
 * Safety: targets whose adjacent tiles contain a hostile are excluded,
 * and in round > 5 we also require at least 3 tiles of breathing room
 * (still configurable via greed — high-greed archetypes ignore this).
 */
export class ArenaChestLooterModule implements ArenaAgentModule {
  readonly name = "arena-chest-looter"
  readonly priority = 80

  analyze(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    const archetype = context.archetype ?? getArchetypeProfile("balanced")
    const utilCtx = buildUtilityContext(observation, archetype)
    const you = observation.you

    const dropTargets = observation.death_drops.map((d) => d)
    const chestTargets = observation.chest_positions ?? []
    if (dropTargets.length === 0 && chestTargets.length === 0) {
      return { reasoning: "No chests or loot piles on the map.", confidence: 0 }
    }

    const hostiles = observation.entities.filter(
      (e) => e.id !== you.id && e.alive && !e.stealth,
    )

    const interactActions = observation.legal_actions.filter(
      (a): a is InteractAction => a.type === "interact",
    )
    const moves = observation.legal_actions.filter(
      (a): a is MoveAction => a.type === "move",
    )

    const candidates: ArenaActionCandidate[] = []

    // Interact candidates (bump-to-interact short-circuit).
    for (const action of interactActions) {
      const drop = dropTargets.find((d) => {
        // The engine surfaces death drops keyed by source_player; match
        // against target_id which should map to the pile id in legal
        // actions. Fall back to assuming the nearest pile if no direct
        // match (keeps behavior reasonable for future drop shapes).
        return d.source_player === action.target_id
      })
      const itemCount = drop ? drop.items.length : 1
      const hostileAdjacent = drop
        ? hostiles.some((h) => chebyshev(h.position, drop.position) <= 1)
        : false
      candidates.push(
        scoreInteractCandidate(utilCtx, action, { itemCount, hostileAdjacent }),
      )
    }

    // Move-toward candidates for any safe loot tile.
    const lootPositions = dropTargets.length > 0
      ? dropTargets.map((d) => ({ pos: d.position, items: d.items.length }))
      : chestTargets.map((pos) => ({ pos, items: 1 }))

    const safeTargets = lootPositions.filter(({ pos }) => {
      const hostileAdjacent = hostiles.some((h) => chebyshev(h.position, pos) <= 1)
      if (hostileAdjacent) return false
      // Late-game danger gate, softened by greed.
      if (observation.round > 5) {
        const dangerRadius = Math.max(1, Math.ceil(3 / archetype.greed))
        const tooClose = hostiles.some(
          (h) => chebyshev(h.position, you.position) < dangerRadius,
        )
        if (tooClose) return false
      }
      return true
    })

    // Pick the nearest safe target for the approach-toward bonus.
    const nearestSafe = safeTargets
      .map(({ pos, items }) => ({ pos, items, dist: chebyshev(you.position, pos) }))
      .sort((a, b) => a.dist - b.dist)[0]

    if (nearestSafe && moves.length > 0) {
      for (const move of moves) {
        const delta = DIRECTION_DELTAS[move.direction]
        const next = { x: you.position.x + delta.dx, y: you.position.y + delta.dy }
        const before = chebyshev(you.position, nearestSafe.pos)
        const after = chebyshev(next, nearestSafe.pos)
        const gain = before - after
        // Greed-weighted strategic bonus, scaled by item count.
        const magnitude = 6 * archetype.greed + nearestSafe.items * archetype.greed
        const strategicBonus = gain * magnitude
        const scored = scoreMoveCandidate(utilCtx, move, {
          target: nearestSafe.pos,
          strategicBonus,
          reasoning: `Loot path ${move.direction} → (${nearestSafe.pos.x},${nearestSafe.pos.y}) (greed=${archetype.greed.toFixed(2)})`,
        })
        candidates.push(scored)
      }
    }

    if (candidates.length === 0) {
      return { reasoning: "No safe loot candidates.", confidence: 0 }
    }

    const top = [...candidates].sort((a, b) => b.utility - a.utility)[0]!
    // Interact is a "sure thing" pickup — surface high confidence so the
    // legacy confidence-based consumers also prefer it over a pathing move.
    const confidence = top.action.type === "interact" ? 0.85 : 0.5
    return {
      suggestedAction: top.action,
      reasoning: top.reasoning,
      confidence,
      candidates,
    }
  }
}
