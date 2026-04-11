import type { Action, Entity, EquipSlot, InventorySlot, Observation } from "../protocol.js"
import type { AgentContext, AgentModule, ModuleRecommendation } from "./index.js"

const RARITY_SCORE: Record<string, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
}

const EQUIP_SLOTS: EquipSlot[] = ["weapon", "armor", "helm", "hands", "accessory"]

export class InventoryModule implements AgentModule {
  readonly name = "inventory"
  readonly priority = 50

  analyze(observation: Observation, _context: AgentContext): ModuleRecommendation {
    const equipResult = this.checkEquipUpgrades(observation)
    if (equipResult) return equipResult

    const inventoryFull = observation.inventory_slots_used >= observation.inventory_capacity

    if (inventoryFull) {
      const dropResult = this.checkDropForUpgrade(observation)
      if (dropResult) return dropResult
    }

    const pickupResult = this.checkPickups(observation)
    if (pickupResult) return pickupResult

    return { reasoning: "No inventory actions needed.", confidence: 0 }
  }

  private checkEquipUpgrades(observation: Observation): ModuleRecommendation | null {
    const equipActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "equip" }> => a.type === "equip",
    )
    if (equipActions.length === 0) return null

    for (const action of equipActions) {
      const invItem = observation.inventory.find((i) => i.item_id === action.item_id)
      if (!invItem) continue

      const slot = guessSlot(invItem)
      if (!slot) continue

      const equipped = observation.equipment[slot]
      if (!equipped || itemValue(invItem.modifiers) > itemValue(equipped.modifiers)) {
        return {
          suggestedAction: action,
          reasoning: `Equipping ${invItem.name} (upgrade for ${slot} slot).`,
          confidence: equipped ? 0.7 : 0.65,
        }
      }
    }

    return null
  }

  private checkPickups(observation: Observation): ModuleRecommendation | null {
    const pickupActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "pickup" }> => a.type === "pickup",
    )
    if (pickupActions.length === 0) return null

    if (observation.inventory_slots_used >= observation.inventory_capacity) return null

    const ranked = rankPickupsByRarity(pickupActions, observation.visible_entities)
    const best = ranked[0]
    if (!best) return null

    return {
      suggestedAction: best,
      reasoning: `Picking up item${observation.visible_entities.find((e) => e.id === best.item_id)?.name ? ` (${observation.visible_entities.find((e) => e.id === best.item_id)!.name})` : ""}.`,
      confidence: 0.3,
    }
  }

  private checkDropForUpgrade(observation: Observation): ModuleRecommendation | null {
    const dropActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "drop" }> => a.type === "drop",
    )
    if (dropActions.length === 0) return null

    const hasPickupAvailable = observation.legal_actions.some((a) => a.type === "pickup")
    if (!hasPickupAvailable) return null

    let lowestValue = Infinity
    let lowestAction: Extract<Action, { type: "drop" }> | undefined

    for (const action of dropActions) {
      const invItem = observation.inventory.find((i) => i.item_id === action.item_id)
      if (!invItem) continue
      const value = itemValue(invItem.modifiers)
      if (value < lowestValue) {
        lowestValue = value
        lowestAction = action
      }
    }

    if (!lowestAction) return null

    return {
      suggestedAction: lowestAction,
      reasoning: "Dropping lowest-value item to make room for pickup.",
      confidence: 0.35,
    }
  }
}

function itemValue(modifiers: Record<string, number>): number {
  return Object.values(modifiers).reduce((sum, v) => sum + Math.abs(v), 0)
}

function guessSlot(item: InventorySlot): EquipSlot | null {
  if (item.modifiers["attack"] !== undefined && item.modifiers["attack"] > 0) return "weapon"
  if (item.modifiers["defense"] !== undefined && item.modifiers["defense"] > 0) return "armor"
  for (const slot of EQUIP_SLOTS) {
    if (item.name.toLowerCase().includes(slot)) return slot
  }
  return null
}

function rankPickupsByRarity(
  pickups: Array<Extract<Action, { type: "pickup" }>>,
  entities: Entity[],
): Array<Extract<Action, { type: "pickup" }>> {
  return [...pickups].sort((a, b) => {
    const entityA = entities.find((e) => e.id === a.item_id)
    const entityB = entities.find((e) => e.id === b.item_id)
    const scoreA = RARITY_SCORE[entityA?.rarity ?? "common"] ?? 1
    const scoreB = RARITY_SCORE[entityB?.rarity ?? "common"] ?? 1
    return scoreB - scoreA
  })
}
