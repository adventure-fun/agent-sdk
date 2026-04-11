import { describe, expect, it } from "bun:test"
import { InventoryModule } from "../../../src/modules/inventory.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  equipAction,
  pickupAction,
  dropAction,
  inventorySlot,
  inventoryItem,
} from "../../helpers/mock-observation.js"

const config = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function ctx() {
  return createAgentContext(config)
}

describe("InventoryModule", () => {
  const module = new InventoryModule()

  it("has correct name and priority", () => {
    expect(module.name).toBe("inventory")
    expect(module.priority).toBe(50)
  })

  it("recommends equipping a better weapon from inventory", () => {
    const obs = buildObservation({
      inventory: [
        inventorySlot({
          item_id: "inv-sword",
          template_id: "great-sword",
          name: "Great Sword",
          modifiers: { attack: 10 },
        }),
      ],
      equipment: {
        weapon: inventoryItem({
          id: "eq-sword",
          template_id: "rusty-sword",
          name: "Rusty Sword",
          modifiers: { attack: 2 },
          slot: "weapon",
        }),
        armor: null,
        helm: null,
        hands: null,
        accessory: null,
      },
      legal_actions: [equipAction("inv-sword")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "equip", item_id: "inv-sword" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.6)
  })

  it("recommends picking up items when pickup is legal and inventory has space", () => {
    const obs = buildObservation({
      inventory_slots_used: 3,
      inventory_capacity: 10,
      legal_actions: [pickupAction("floor-item-1")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "pickup", item_id: "floor-item-1" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.2)
  })

  it("recommends dropping lowest-value item when inventory is full and pickup available", () => {
    const obs = buildObservation({
      inventory: [
        inventorySlot({ item_id: "junk", name: "Rusty Nail", modifiers: {} }),
        inventorySlot({ item_id: "good", name: "Gold Ring", modifiers: { defense: 5 } }),
      ],
      inventory_slots_used: 10,
      inventory_capacity: 10,
      legal_actions: [
        pickupAction("floor-item"),
        dropAction("junk"),
        dropAction("good"),
      ],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "drop", item_id: "junk" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.3)
  })

  it("returns no recommendation when nothing relevant is legal", () => {
    const obs = buildObservation({
      legal_actions: [{ type: "move", direction: "up" }, { type: "wait" }],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("prioritizes rare pickups over common ones", () => {
    const obs = buildObservation({
      visible_entities: [
        { id: "common-item", type: "item", name: "Stick", position: { x: 1, y: 1 }, rarity: "common" },
        { id: "rare-item", type: "item", name: "Magic Wand", position: { x: 2, y: 2 }, rarity: "rare" },
      ],
      inventory_slots_used: 3,
      inventory_capacity: 10,
      legal_actions: [pickupAction("common-item"), pickupAction("rare-item")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "pickup", item_id: "rare-item" })
  })
})
