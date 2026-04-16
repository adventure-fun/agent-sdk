import type { Action, Observation } from "../protocol.js"
import type { AgentContext, AgentModule, ModuleRecommendation } from "./index.js"

const TRAP_EVENT_TYPES = new Set(["trap_triggered", "trap_spotted", "trap_damage"])

export class TrapHandlingModule implements AgentModule {
  readonly name = "trap-handling"
  readonly priority = 75

  analyze(observation: Observation, _context: AgentContext): ModuleRecommendation {
    const visibleTraps = observation.visible_entities.filter((e) => e.type === "trap_visible")
    const recentTrapEvent = observation.recent_events.some((e) =>
      TRAP_EVENT_TYPES.has(e.type),
    )

    if (visibleTraps.length === 0 && !recentTrapEvent) {
      return { reasoning: "No traps detected.", confidence: 0 }
    }

    const disarmActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "disarm_trap" }> => a.type === "disarm_trap",
    )

    if (disarmActions.length > 0) {
      return {
        suggestedAction: disarmActions[0]!,
        reasoning: `Disarming trap${visibleTraps[0] ? ` (${visibleTraps[0].name})` : ""}.`,
        confidence: 0.8,
      }
    }

    const moveActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "move" }> => a.type === "move",
    )

    if (moveActions.length > 0) {
      const safestMove = moveActions[0]!
      return {
        suggestedAction: safestMove,
        reasoning: "trap detected but cannot disarm — moving to avoid.",
        confidence: recentTrapEvent ? 0.6 : 0.55,
      }
    }

    return {
      reasoning: "trap detected but no avoidance options available.",
      confidence: 0.2,
      context: { trapPresent: true },
    }
  }
}
