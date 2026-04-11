import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { Action, InventoryItem, ItemTemplate, Observation } from "@adventure-fun/schemas"
import { DungeonEquipmentPanel, GearManagementPanel } from "./page"

const itemTemplateMap: Record<string, ItemTemplate> = {
  "iron-sword": {
    id: "iron-sword",
    name: "Iron Sword",
    description: "Reliable blade.",
    type: "equipment",
    rarity: "common",
    equip_slot: "weapon",
    stats: { attack: 6, accuracy: 2 },
    effects: [],
    stack_limit: 1,
    sell_price: 12,
    buy_price: 30,
  },
  "rusty-dagger": {
    id: "rusty-dagger",
    name: "Rusty Dagger",
    description: "Old but sharp.",
    type: "equipment",
    rarity: "common",
    equip_slot: "weapon",
    stats: { attack: 2 },
    effects: [],
    stack_limit: 1,
    sell_price: 6,
    buy_price: 15,
  },
  "wooden-shield": {
    id: "wooden-shield",
    name: "Wooden Shield",
    description: "Knight-only shield.",
    type: "equipment",
    rarity: "common",
    equip_slot: "armor",
    stats: { defense: 6, evasion: -2 },
    effects: [],
    stack_limit: 1,
    sell_price: 10,
    buy_price: 22,
    class_restriction: "knight",
  },
  "health-potion": {
    id: "health-potion",
    name: "Health Potion",
    description: "Recover HP.",
    type: "consumable",
    rarity: "common",
    stats: {},
    effects: [],
    stack_limit: 5,
    sell_price: 3,
    buy_price: 8,
  },
}

describe("Group 5 equipment UI", () => {
  it("renders hub gear management controls with class restriction messaging", () => {
    const inventory: InventoryItem[] = [
      {
        id: "equipped-weapon",
        template_id: "rusty-dagger",
        name: "Rusty Dagger",
        quantity: 1,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-1",
        slot: "weapon",
      },
      {
        id: "bag-sword",
        template_id: "iron-sword",
        name: "Iron Sword",
        quantity: 1,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-1",
        slot: null,
      },
      {
        id: "bag-shield",
        template_id: "wooden-shield",
        name: "Wooden Shield",
        quantity: 1,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-1",
        slot: null,
      },
    ]

    const html = renderToStaticMarkup(
      <GearManagementPanel
        inventory={inventory}
        itemTemplateMap={itemTemplateMap}
        characterClass="mage"
        isLoading={false}
        onEquip={async () => {}}
        onUnequip={async () => {}}
      />,
    )

    expect(html).toContain("Equipment and Inventory")
    expect(html).toContain("Bag Gear")
    expect(html).toContain("Unequip")
    expect(html).toContain("Equip")
    expect(html).toContain("knight only")
    expect(html).toContain("Weapon: Iron Sword (+6 Attack · +2 Accuracy) replaces Rusty Dagger (+2 Attack)")
  })

  it("renders dungeon equip and unequip controls with stat summaries", () => {
    const inventory: Observation["inventory"] = [
      {
        item_id: "bag-sword",
        template_id: "iron-sword",
        name: "Iron Sword",
        quantity: 1,
        modifiers: {},
      },
      {
        item_id: "bag-potion",
        template_id: "health-potion",
        name: "Health Potion",
        quantity: 1,
        modifiers: {},
      },
    ]

    const equipment: Observation["equipment"] = {
      weapon: {
        id: "equipped-weapon",
        template_id: "rusty-dagger",
        name: "Rusty Dagger",
        quantity: 1,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-1",
        slot: "weapon",
      },
      armor: null,
      helm: null,
      hands: null,
      accessory: null,
    }

    const equipAction = { type: "equip", item_id: "bag-sword" } as Extract<Action, { type: "equip" }>
    const unequipAction = { type: "unequip", slot: "weapon" } as Extract<Action, { type: "unequip" }>

    const html = renderToStaticMarkup(
      <DungeonEquipmentPanel
        inventory={inventory}
        equipment={equipment}
        itemTemplateMap={itemTemplateMap}
        inventorySlotsUsed={2}
        inventoryCapacity={10}
        newItemIds={new Set(["bag-sword"])}
        equipActionByItemId={new Map([["bag-sword", equipAction]])}
        unequipActionBySlot={new Map([["weapon", unequipAction]])}
        waitingForResponse={false}
        onAction={() => {}}
      />,
    )

    expect(html).toContain("Equipment")
    expect(html).toContain("Inventory (2/10)")
    expect(html).toContain("Rusty Dagger")
    expect(html).toContain("Iron Sword x1")
    expect(html).toContain("New")
    expect(html).toContain("+6 Attack · +2 Accuracy")
    expect(html).toContain("Equip")
    expect(html).toContain("Unequip")
    expect(html).toContain("Weapon: Iron Sword (+6 Attack · +2 Accuracy) replaces Rusty Dagger (+2 Attack)")
  })
})
