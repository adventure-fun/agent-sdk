import type { Action, Observation } from "../protocol.js"
import type { AgentContext, AgentModule, ModuleRecommendation } from "./index.js"

const HEAL_THRESHOLD = 0.5
const CRITICAL_THRESHOLD = 0.25

export class HealingModule implements AgentModule {
  readonly name = "healing"
  readonly priority = 85

  analyze(observation: Observation, _context: AgentContext): ModuleRecommendation {
    const { current, max } = observation.character.hp
    const hpRatio = current / max

    if (hpRatio > HEAL_THRESHOLD) {
      return { reasoning: "HP above healing threshold.", confidence: 0 }
    }

    const healActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "use_item" }> => a.type === "use_item",
    )

    const healingAction = findHealingAction(healActions, observation.inventory)

    if (!healingAction) {
      const isCritical = hpRatio <= CRITICAL_THRESHOLD
      return {
        reasoning: isCritical
          ? `HP critically low (${Math.round(hpRatio * 100)}%) but no healing items available.`
          : `HP below threshold (${Math.round(hpRatio * 100)}%) but no healing items available.`,
        confidence: 0,
        context: {
          criticalHP: isCritical,
          healingAvailable: false,
          hpRatio,
        },
      }
    }

    const confidence = computeHealConfidence(hpRatio)

    return {
      suggestedAction: healingAction,
      reasoning: `Healing at ${Math.round(hpRatio * 100)}% HP.`,
      confidence,
      context: { hpRatio, healingAvailable: true },
    }
  }
}

function findHealingAction(
  useItemActions: Array<Extract<Action, { type: "use_item" }>>,
  inventory: Observation["inventory"],
): Action | undefined {
  for (const action of useItemActions) {
    const invItem = inventory.find((i) => i.item_id === action.item_id)
    if (!invItem) continue
    const isHealing =
      invItem.modifiers["heal"] !== undefined ||
      invItem.name.toLowerCase().includes("heal") ||
      invItem.name.toLowerCase().includes("potion")
    if (isHealing) return action
  }
  return undefined
}

function computeHealConfidence(hpRatio: number): number {
  // 0.5 at 50% HP, scaling up to 0.95 near 0% HP
  // Use exponential scaling so low HP gets much higher confidence
  const normalized = Math.max(0, HEAL_THRESHOLD - hpRatio) / HEAL_THRESHOLD
  return 0.5 + (1 - (1 - normalized) ** 2) * 0.45
}
