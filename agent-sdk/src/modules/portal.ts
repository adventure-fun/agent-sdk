import { hasActionableLootBlockingPostClearExtraction } from "../extraction-loot-gate.js"
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
    const pendingLoot = hasActionableLootBlockingPostClearExtraction(observation)

    const survivalMode = hpRatio <= extractThreshold
    const loopStuck = context.mapMemory.loopEdgeBans?.[observation.position.room_id] !== undefined
    const urgentExit = survivalMode || (loopStuck && hpRatio <= 0.45)
    const completionExtract = realmCompleted && !pendingLoot

    if (!urgentExit && !completionExtract) {
      return { reasoning: "No extraction needed.", confidence: 0 }
    }

    // Prefer the floor-1 entrance walk-out when legal (matches engine: same extraction outcome,
    // preserves portal scrolls / portal-active state for later).
    if (retreatLegal) {
      if (urgentExit) {
        return {
          suggestedAction: { type: "retreat" },
          reasoning: `HP critically low (${Math.round(hpRatio * 100)}%); exiting via the dungeon entrance.`,
          confidence: 0.95,
          context: { hpRatio, realmCompleted },
        }
      }
      return {
        suggestedAction: { type: "retreat" },
        reasoning:
          "Realm objective met; exiting through the first-floor entrance (preferred — no portal resource spent).",
        confidence: 0.95,
        context: { hpRatio, realmCompleted },
      }
    }

    if (portalLegal && urgentExit) {
      return {
        suggestedAction: { type: "use_portal" },
        reasoning: `HP critically low (${Math.round(hpRatio * 100)}%); extracting via portal (not at entrance).`,
        confidence: 0.95,
        context: { hpRatio, realmCompleted },
      }
    }

    // Boss/realm clear with healthy HP: walk to floor-1 `entrance_room_id` and `retreat` before
    // spending a portal. ExplorationModule handles routing; we intentionally defer `use_portal`.
    if (portalLegal && completionExtract) {
      return {
        reasoning:
          "Realm objective met; navigate to the floor-1 entrance room (realm_info.entrance_room_id) and use retreat — avoid portals until you are there unless HP becomes critical.",
        confidence: 0,
        context: { hpRatio, realmCompleted, entrance_room_id: observation.realm_info.entrance_room_id },
      }
    }

    return {
      reasoning: "Extraction needed but no legal retreat or portal.",
      confidence: 0,
    }
  }
}
