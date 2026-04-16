import type {
  Action,
  AgentContext,
  AgentModule,
  ModuleRecommendation,
  Observation,
} from "../../../../src/index.js"

const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

const DEFAULT_ACTIVE_STUCK_THRESHOLD = 35
const DEFAULT_POSITION_STUCK_THRESHOLD = 8

/**
 * Priority 98 — above ExtractionRouter (97), below PortalModule (100).
 *
 * Fills a gap in the SDK's default stuck-handling: the built-in auto-portal safety valve
 * (exploration.ts:131) only fires when `realm_info.status` is `boss_cleared` or
 * `realm_cleared`. During active play — e.g. the tactical LLM is convinced "the door is at
 * (6,3)" but the agent cannot reach that tile and spends 30+ turns pingponging inside a
 * dead-end room — the SDK has no escape. Plans exhaust on every turn, the tactical LLM gets
 * called over and over, and eventually OpenRouter rate-limits us into a cascade failure.
 *
 * This module watches two SDK-maintained counters:
 *   - `mapMemory.turnsWithoutNewRoom` — turns since entering a new room (any floor)
 *   - `mapMemory.turnsWithoutPositionChange` — turns since the agent's tile position changed
 *
 * When either counter exceeds its threshold during active play, emit (in order of preference):
 *   1. `use_portal` — consume a portal scroll to exit the realm (confidence 0.95)
 *   2. `retreat` — free retreat when we happen to be at the entrance (confidence 0.95)
 *
 * When neither is legal, idle — let combat/healing/exploration keep the agent alive and rely
 * on the empty-extraction streak detector in BaseAgent to eventually bail.
 */
export class StuckEscapeModule implements AgentModule {
  readonly name = "stuck-escape"
  readonly priority = 98

  constructor(
    private readonly options: {
      activeStuckThreshold?: number
      positionStuckThreshold?: number
    } = {},
  ) {}

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    if (COMPLETED_STATUSES.has(observation.realm_info.status)) {
      return idle("Realm cleared; defer to ExtractionRouter / SDK homing.")
    }
    if (observation.visible_entities.some((e) => e.type === "enemy")) {
      return idle("Enemies visible; defer to combat.")
    }

    const turnsWithoutNewRoom = context.mapMemory.turnsWithoutNewRoom ?? 0
    const turnsWithoutPositionChange = context.mapMemory.turnsWithoutPositionChange ?? 0

    const activeThreshold =
      this.options.activeStuckThreshold ?? DEFAULT_ACTIVE_STUCK_THRESHOLD
    const positionThreshold =
      this.options.positionStuckThreshold ?? DEFAULT_POSITION_STUCK_THRESHOLD

    const stuckByRoom = turnsWithoutNewRoom >= activeThreshold
    const stuckByPosition = turnsWithoutPositionChange >= positionThreshold
    if (!stuckByRoom && !stuckByPosition) {
      return idle(
        `Not stuck (roomStuck=${turnsWithoutNewRoom}/${activeThreshold}, posStuck=${turnsWithoutPositionChange}/${positionThreshold}).`,
      )
    }

    const reasonDetail = stuckByRoom
      ? `${turnsWithoutNewRoom} turns without entering a new room`
      : `${turnsWithoutPositionChange} turns without tile movement`

    const portal = observation.legal_actions.find(
      (a): a is Extract<Action, { type: "use_portal" }> => a.type === "use_portal",
    )
    if (portal) {
      return {
        suggestedAction: portal,
        reasoning: `Stuck escape: ${reasonDetail} during active play — consuming portal scroll to exit the realm.`,
        confidence: 0.95,
        context: {
          phase: "stuck-escape",
          mode: "portal",
          turnsWithoutNewRoom,
          turnsWithoutPositionChange,
        },
      }
    }

    const retreat = observation.legal_actions.find(
      (a): a is Extract<Action, { type: "retreat" }> => a.type === "retreat",
    )
    if (retreat) {
      return {
        suggestedAction: retreat,
        reasoning: `Stuck escape: ${reasonDetail} during active play — retreating to lobby (retreat is legal from this tile).`,
        confidence: 0.95,
        context: {
          phase: "stuck-escape",
          mode: "retreat",
          turnsWithoutNewRoom,
          turnsWithoutPositionChange,
        },
      }
    }

    return idle(
      `Stuck (${reasonDetail}) but neither use_portal nor retreat is legal. Deferring; SDK empty-extraction detector will abort after enough failed runs.`,
    )
  }
}

function idle(reason: string): ModuleRecommendation {
  return { reasoning: reason, confidence: 0 }
}
