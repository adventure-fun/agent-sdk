import {
  bfsDistance,
  bfsStep,
  type Action,
  type AgentContext,
  type AgentModule,
  type ModuleRecommendation,
  type Observation,
} from "../../../../src/index.js"
import type { ClassProfileRegistry } from "../classes/profile.js"

const MAX_BFS_DISTANCE = 10
const MIN_HP_FRACTION_FOR_APPROACH = 0.5

/**
 * Priority 76 — sits above LootPrioritizer (75) but below default TrapHandling (85) so the
 * default trap handler still runs for non-disarm classes and provides its move-to-avoid
 * fallback. For disarm-class characters, this module actively walks toward visible traps to
 * disarm them.
 *
 * Behaviour per `ClassProfile.trapBehavior`:
 *   - "disarm": if disarm_trap is legal, do it (0.92). Otherwise BFS-route toward the closest
 *     visible trap (0.78) as long as HP is healthy. Quiet otherwise.
 *   - "avoid": module is quiet; default TrapHandlingModule handles it.
 */
export class ClassAwareTrapModule implements AgentModule {
  readonly name = "class-aware-trap"
  readonly priority = 76

  constructor(private readonly profiles: ClassProfileRegistry) {}

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    const profile = this.profiles.get(observation.character.class)
    if (profile.trapBehavior !== "disarm") {
      return idle(`${observation.character.class} avoids traps; default handler takes over.`)
    }

    if (observation.visible_entities.some((e) => e.type === "enemy")) {
      return idle("Enemies visible; defer to combat.")
    }

    const hpRatio = observation.character.hp.current / Math.max(observation.character.hp.max, 1)
    if (hpRatio < MIN_HP_FRACTION_FOR_APPROACH) {
      return idle("HP too low to approach traps; defer to default handler.")
    }

    // Disarm legal right now? Take it.
    const disarm = observation.legal_actions.find(
      (a): a is Extract<Action, { type: "disarm_trap" }> => a.type === "disarm_trap",
    )
    if (disarm) {
      return {
        suggestedAction: disarm,
        reasoning: "Rogue disarming adjacent trap for XP/loot.",
        confidence: 0.92,
      }
    }

    // Route toward closest visible trap.
    const visibleTraps = observation.visible_entities.filter((e) => e.type === "trap_visible")
    if (visibleTraps.length === 0) {
      return idle("No visible traps to route toward.")
    }

    let best: {
      id: string
      distance: number
      step: Extract<Action, { type: "move" }>
      name: string
    } | null = null
    for (const trap of visibleTraps) {
      const distance = bfsDistance(observation, context, trap.position)
      if (distance === null || distance > MAX_BFS_DISTANCE) continue
      if (best && distance >= best.distance) continue
      const step = bfsStep(observation, context, trap.position)
      if (!step) continue
      best = { id: trap.id, distance, step, name: trap.name }
    }

    if (!best) return idle("No reachable trap within BFS budget.")

    return {
      suggestedAction: best.step,
      reasoning: `Routing toward trap ${best.name} to disarm (${best.distance} tiles, step ${best.step.direction}).`,
      confidence: 0.78,
      context: { trapId: best.id, distance: best.distance },
    }
  }
}

function idle(reason: string): ModuleRecommendation {
  return { reasoning: reason, confidence: 0 }
}
