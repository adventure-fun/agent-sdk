import type { Observation } from "../protocol.js"
import type { AgentContext, AgentModule, ModuleRecommendation } from "./index.js"

const DEFAULT_HP_EXTRACT_THRESHOLD = 0.2
const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

export class PortalModule implements AgentModule {
  readonly name = "portal"
  readonly priority = 90

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    const hpRatio = observation.character.hp.current / observation.character.hp.max
    const extractThreshold = context.config.decision?.emergencyHpPercent ?? DEFAULT_HP_EXTRACT_THRESHOLD
    const realmCompleted = COMPLETED_STATUSES.has(observation.realm_info.status)
    const portalLegal = observation.legal_actions.some((a) => a.type === "use_portal")
    const retreatLegal = observation.legal_actions.some((a) => a.type === "retreat")
    const pendingLoot = hasPendingLoot(observation)

    if (portalLegal && hpRatio <= extractThreshold) {
      return {
        suggestedAction: { type: "use_portal" },
        reasoning: `HP critically low (${Math.round(hpRatio * 100)}%), extracting for survival.`,
        confidence: 0.95,
        context: { hpRatio, realmCompleted },
      }
    }

    if (portalLegal && realmCompleted && !pendingLoot) {
      return {
        suggestedAction: { type: "use_portal" },
        reasoning: "Realm completed, extracting with full rewards.",
        confidence: 0.95,
        context: { hpRatio, realmCompleted },
      }
    }

    if (retreatLegal && hpRatio <= extractThreshold) {
      return {
        suggestedAction: { type: "retreat" },
        reasoning: `HP critically low (${Math.round(hpRatio * 100)}%) and no portal — retreating.`,
        confidence: 0.85,
        context: { hpRatio, realmCompleted },
      }
    }

    return {
      reasoning: "No extraction needed.",
      confidence: 0,
    }
  }
}

function hasPendingLoot(observation: Observation): boolean {
  return (
    observation.legal_actions.some((action) => action.type === "pickup")
    || observation.visible_entities.some((entity) => entity.type === "item")
  )
}
