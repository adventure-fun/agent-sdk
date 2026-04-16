import { describe, expect, it } from "bun:test"
import { AutoEquipModule, guessSlotExpanded } from "../src/modules/auto-equip.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  enemy,
  equipAction,
  inventoryItem,
  inventorySlot,
} from "../../../tests/helpers/mock-observation.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

describe("guessSlotExpanded", () => {
  it("recognizes rings/amulets/necklaces/talismans/charms as accessory", () => {
    for (const name of [
      "Tomb Ring",
      "Silver Amulet",
      "Ancient Necklace",
      "Obsidian Pendant",
      "Talisman of Warding",
      "Lucky Charm",
      "Silver Earring",
      "Woven Bracelet",
      "Explorer's Trinket",
      "Polished Medallion",
    ]) {
      const slot = guessSlotExpanded(inventorySlot({ name, modifiers: { hp: 5 } }))
      expect(slot).toBe("accessory")
    }
  })

  it("recognizes helms/hoods/crowns/hats as helm", () => {
    for (const name of ["Iron Helm", "Shadow Hood", "Leather Cap", "Bone Crown", "Jester Hat", "Steel Helmet"]) {
      const slot = guessSlotExpanded(inventorySlot({ name, modifiers: { hp: 3 } }))
      expect(slot).toBe("helm")
    }
  })

  it("recognizes gloves/gauntlets/bracers as hands", () => {
    for (const name of ["Leather Gloves", "Iron Gauntlets", "Bone Bracers", "Woolen Mittens"]) {
      const slot = guessSlotExpanded(inventorySlot({ name, modifiers: { defense: 1 } }))
      expect(slot).toBe("hands")
    }
  })

  it("recognizes common weapon names even without attack modifier", () => {
    for (const name of ["Rusted Sword", "Iron Dagger", "Oak Staff", "Yew Bow", "Battle Axe"]) {
      const slot = guessSlotExpanded(inventorySlot({ name, modifiers: {} }))
      expect(slot).toBe("weapon")
    }
  })

  it("falls back to modifier detection for unknown names", () => {
    // A generic "Artifact" with positive attack → weapon.
    expect(
      guessSlotExpanded(inventorySlot({ name: "Artifact", modifiers: { attack: 5 } })),
    ).toBe("weapon")
    // A generic "Shard" with positive defense → armor.
    expect(
      guessSlotExpanded(inventorySlot({ name: "Shard", modifiers: { defense: 3 } })),
    ).toBe("armor")
  })

  it("returns null for items with no recognizable pattern and no combat modifiers", () => {
    expect(
      guessSlotExpanded(inventorySlot({ name: "Mystery Orb", modifiers: { hp: 2 } })),
    ).toBeNull()
  })
})

describe("AutoEquipModule", () => {
  const module = new AutoEquipModule()

  it("has the correct name and priority", () => {
    expect(module.name).toBe("auto-equip")
    expect(module.priority).toBe(77)
  })

  it("equips a Tomb Ring into an empty accessory slot", () => {
    const obs = buildObservation({
      inventory: [
        inventorySlot({
          item_id: "inv-tomb-ring",
          template_id: "tomb-ring",
          name: "Tomb Ring",
          modifiers: { hp: 5, evasion: 2 },
        }),
      ],
      legal_actions: [equipAction("inv-tomb-ring")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "equip", item_id: "inv-tomb-ring" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.85)
    expect(result.reasoning).toContain("accessory")
  })

  it("equips a stronger accessory over a weaker one", () => {
    const obs = buildObservation({
      equipment: {
        weapon: null,
        armor: null,
        helm: null,
        hands: null,
        accessory: inventoryItem({
          id: "inv-old-ring",
          name: "Copper Ring",
          modifiers: { hp: 2 },
          slot: "accessory",
        }),
      },
      inventory: [
        inventorySlot({
          item_id: "inv-tomb-ring",
          template_id: "tomb-ring",
          name: "Tomb Ring",
          modifiers: { hp: 6, evasion: 3 },
        }),
      ],
      legal_actions: [equipAction("inv-tomb-ring")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "equip", item_id: "inv-tomb-ring" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("does NOT equip a strictly weaker accessory", () => {
    const obs = buildObservation({
      equipment: {
        weapon: null,
        armor: null,
        helm: null,
        hands: null,
        accessory: inventoryItem({
          id: "inv-epic-ring",
          name: "Sapphire Ring",
          modifiers: { hp: 10, evasion: 5 },
          slot: "accessory",
        }),
      },
      inventory: [
        inventorySlot({
          item_id: "inv-weak-ring",
          template_id: "tin-ring",
          name: "Tin Ring",
          modifiers: { hp: 1 },
        }),
      ],
      legal_actions: [equipAction("inv-weak-ring")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("picks the biggest upgrade across multiple legal equips", () => {
    const obs = buildObservation({
      equipment: {
        weapon: inventoryItem({
          id: "inv-old-sword",
          name: "Iron Sword",
          modifiers: { attack: 3 },
          slot: "weapon",
        }),
        armor: null,
        helm: null,
        hands: null,
        accessory: null,
      },
      inventory: [
        inventorySlot({
          item_id: "inv-tomb-ring",
          template_id: "tomb-ring",
          name: "Tomb Ring",
          modifiers: { hp: 3 },
        }),
        inventorySlot({
          item_id: "inv-mythril-sword",
          template_id: "mythril-sword",
          name: "Mythril Sword",
          modifiers: { attack: 12 },
        }),
      ],
      legal_actions: [equipAction("inv-tomb-ring"), equipAction("inv-mythril-sword")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    // Mythril sword: +12 - 3 = +9 delta. Tomb ring: +3 - 0 = +3 delta. Sword wins.
    expect(result.suggestedAction).toEqual({ type: "equip", item_id: "inv-mythril-sword" })
  })

  it("skips items with no recognizable slot", () => {
    const obs = buildObservation({
      inventory: [
        inventorySlot({
          item_id: "inv-mystery",
          template_id: "mystery-orb",
          name: "Mystery Orb",
          modifiers: { hp: 5 },
        }),
      ],
      legal_actions: [equipAction("inv-mystery")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when enemies are visible", () => {
    const obs = buildObservation({
      visible_entities: [enemy("e1")],
      inventory: [
        inventorySlot({
          item_id: "inv-tomb-ring",
          template_id: "tomb-ring",
          name: "Tomb Ring",
          modifiers: { hp: 5 },
        }),
      ],
      legal_actions: [equipAction("inv-tomb-ring")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when the realm is cleared", () => {
    const obs = buildObservation({
      realm_info: { status: "realm_cleared" },
      inventory: [
        inventorySlot({
          item_id: "inv-tomb-ring",
          template_id: "tomb-ring",
          name: "Tomb Ring",
          modifiers: { hp: 5 },
        }),
      ],
      legal_actions: [equipAction("inv-tomb-ring")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })
})
