import { describe, expect, it } from "bun:test"
import {
  itemValueFromModifiers,
  planBudgetActions,
  reserveTarget,
} from "../src/lobby/gearing-planner.js"
import { rogueProfile } from "../src/classes/rogue.js"
import type {
  InventoryItem,
  LobbyState,
  ShopCatalogItem,
  ShopCatalogResponse,
} from "../../../src/index.js"

function makeShops(items: ShopCatalogItem[]): ShopCatalogResponse {
  return {
    sections: [{ id: "main", label: "General", items }],
    featured: [],
  }
}

function makeState(overrides: Partial<LobbyState>): LobbyState {
  return {
    character: {
      id: "char-1",
      class: "rogue",
      name: "Test",
      level: 3,
      gold: 500,
      hp_current: 30,
      hp_max: 30,
      resource_current: 100,
      resource_max: 100,
      ...overrides.character,
    },
    inventoryGold: overrides.inventoryGold ?? 500,
    inventory: overrides.inventory ?? [],
    shops: overrides.shops ?? makeShops([]),
    itemTemplates: overrides.itemTemplates ?? [],
  }
}

function inv(
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  return {
    id: overrides.id ?? "inv-1",
    template_id: overrides.template_id ?? "iron-sword",
    name: overrides.name ?? "Iron Sword",
    quantity: overrides.quantity ?? 1,
    modifiers: overrides.modifiers ?? { attack: 3 },
    owner_type: "character",
    owner_id: "char-1",
    slot: overrides.slot ?? null,
  }
}

describe("BudgetPlanner helpers", () => {
  it("reserveTarget scales with level", () => {
    expect(reserveTarget(1)).toBe(50)
    expect(reserveTarget(5)).toBe(200)
    expect(reserveTarget(10)).toBe(400)
  })

  it("itemValueFromModifiers sums absolute values", () => {
    expect(itemValueFromModifiers({ attack: 5, defense: -3 })).toBe(8)
    expect(itemValueFromModifiers(null)).toBe(0)
  })
})

describe("planBudgetActions (rogue)", () => {
  it("buys class consumables when inventory is below the target", () => {
    const shops = makeShops([
      {
        id: "lockpick",
        name: "Lockpick",
        type: "consumable",
        rarity: "common",
        buy_price: 20,
        sell_price: 5,
      },
    ])
    const state = makeState({ shops, inventoryGold: 500 })
    const actions = planBudgetActions({ state, profile: rogueProfile, world: null })

    const lockpickBuy = actions.find(
      (a) => a.type === "buy" && a.item.id === "lockpick",
    )
    expect(lockpickBuy).toBeDefined()
  })

  it("does not buy consumables the agent already has enough of", () => {
    const shops = makeShops([
      {
        id: "lockpick",
        name: "Lockpick",
        type: "consumable",
        rarity: "common",
        buy_price: 20,
      },
    ])
    const state = makeState({
      shops,
      inventory: [inv({ name: "Lockpick", quantity: 3, slot: null, modifiers: {} })],
    })
    const actions = planBudgetActions({ state, profile: rogueProfile, world: null })
    const lockpickBuy = actions.find(
      (a) => a.type === "buy" && a.item.id === "lockpick",
    )
    expect(lockpickBuy).toBeUndefined()
  })

  it("buys a tier-up weapon when the equipped item is below the minimum", () => {
    const shops = makeShops([
      {
        id: "steel-dagger",
        name: "Steel Dagger",
        type: "equipment",
        rarity: "uncommon",
        equip_slot: "weapon",
        buy_price: 120,
        stats: { attack: 10 },
      },
    ])
    const state = makeState({
      shops,
      inventoryGold: 500,
      inventory: [inv({ id: "inv-1", name: "Iron Dagger", modifiers: { attack: 4 }, slot: "weapon" })],
    })
    const actions = planBudgetActions({ state, profile: rogueProfile, world: null })
    const tierUp = actions.find((a) => a.type === "buy" && a.item.id === "steel-dagger")
    expect(tierUp).toBeDefined()
  })

  it("skips tier-up when gold cannot cover reserve + price", () => {
    const shops = makeShops([
      {
        id: "steel-dagger",
        name: "Steel Dagger",
        type: "equipment",
        rarity: "uncommon",
        equip_slot: "weapon",
        buy_price: 120,
        stats: { attack: 10 },
      },
    ])
    // Level 3 reserve = 120. Gold = 200. Gold - reserve = 80 < 120 → skip.
    const state = makeState({
      shops,
      inventoryGold: 200,
      inventory: [inv({ id: "inv-1", name: "Iron Dagger", modifiers: { attack: 4 }, slot: "weapon" })],
    })
    const actions = planBudgetActions({ state, profile: rogueProfile, world: null })
    const tierUp = actions.find((a) => a.type === "buy" && a.item.id === "steel-dagger")
    expect(tierUp).toBeUndefined()
  })

  it("skips items that are class-restricted to a different class", () => {
    const shops = makeShops([
      {
        id: "holy-mace",
        name: "Holy Mace",
        type: "equipment",
        rarity: "rare",
        equip_slot: "weapon",
        buy_price: 100,
        class_restriction: "knight",
        stats: { attack: 15 },
      },
    ])
    const state = makeState({
      shops,
      inventoryGold: 500,
      inventory: [inv({ id: "inv-1", modifiers: { attack: 4 }, slot: "weapon" })],
    })
    const actions = planBudgetActions({ state, profile: rogueProfile, world: null })
    const wrongClass = actions.find((a) => a.type === "buy" && a.item.id === "holy-mace")
    expect(wrongClass).toBeUndefined()
  })

  it("picks the highest-stat weapon among multiple affordable upgrades", () => {
    const shops = makeShops([
      {
        id: "steel-dagger",
        name: "Steel Dagger",
        type: "equipment",
        rarity: "uncommon",
        equip_slot: "weapon",
        buy_price: 100,
        stats: { attack: 8 },
      },
      {
        id: "mythril-dagger",
        name: "Mythril Dagger",
        type: "equipment",
        rarity: "rare",
        equip_slot: "weapon",
        buy_price: 180,
        stats: { attack: 14 },
      },
    ])
    const state = makeState({
      shops,
      inventoryGold: 500,
      inventory: [inv({ id: "inv-1", modifiers: { attack: 4 }, slot: "weapon" })],
    })
    const actions = planBudgetActions({ state, profile: rogueProfile, world: null })
    const tierUps = actions.filter(
      (a) => a.type === "buy" && a.item.equip_slot === "weapon",
    )
    expect(tierUps.length).toBe(1)
    expect(tierUps[0]!.type).toBe("buy")
    if (tierUps[0]!.type === "buy") {
      expect(tierUps[0]!.item.id).toBe("mythril-dagger")
    }
  })
})
