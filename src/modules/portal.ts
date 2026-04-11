import type { Observation } from "../protocol.js"
import type { AgentContext, AgentModule, ModuleRecommendation } from "./index.js"

const HP_EXTRACT_THRESHOLD = 0.25
const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

export class PortalModule implements AgentModule {
  readonly name = "portal"
  readonly priority = 90

  analyze(observation: Observation, _context: AgentContext): ModuleRecommendation {
    const hpRatio = observation.character.hp.current / observation.character.hp.max
    const realmCompleted = COMPLETED_STATUSES.has(observation.realm_info.status)
    const portalLegal = observation.legal_actions.some((a) => a.type === "use_portal")
    const retreatLegal = observation.legal_actions.some((a) => a.type === "retreat")

    if (portalLegal && hpRatio <= HP_EXTRACT_THRESHOLD) {
      return {
        suggestedAction: { type: "use_portal" },
        reasoning: `HP critically low (${Math.round(hpRatio * 100)}%), extracting for survival.`,
        confidence: 0.95,
        context: { hpRatio, realmCompleted },
      }
    }

    if (portalLegal && realmCompleted) {
      return {
        suggestedAction: { type: "use_portal" },
        reasoning: "Realm completed, extracting with full rewards.",
        confidence: 0.95,
        context: { hpRatio, realmCompleted },
      }
    }

    if (retreatLegal && hpRatio <= HP_EXTRACT_THRESHOLD) {
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
