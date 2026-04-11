import { ITEMS, getItem } from "@adventure-fun/engine"
import {
  getInventoryCapacity,
  type CharacterClass,
  type EquipSlot,
  type InventoryItem,
  type ItemEffect,
  type ItemTemplate,
} from "@adventure-fun/schemas"

export interface LobbyCharacterRecord {
  id: string
  class: CharacterClass
  gold: number
  hp_current: number
  hp_max: number
  resource_current: number
  resource_max: number
}

export interface LobbyInventoryRecord {
  id: string
  template_id: string
  quantity: number
  owner_type: string
  owner_id: string
  slot?: string | null
  modifiers?: Record<string, number>
}

export interface ShopCatalogSection {
  id: "consumable" | "equipment"
  label: string
  items: ItemTemplate[]
}

export function getShopCatalog(): ShopCatalogSection[] {
  const items = Object.values(ITEMS)
    .filter((item) => item.buy_price > 0)
    .sort((left, right) => {
      if (left.type !== right.type) return left.type.localeCompare(right.type)
      if (left.rarity !== right.rarity) return left.rarity.localeCompare(right.rarity)
      return left.name.localeCompare(right.name)
    })

  return [
    {
      id: "consumable",
      label: "Consumables",
      items: items.filter((item) => item.type === "consumable"),
    },
    {
      id: "equipment",
      label: "Equipment",
      items: items.filter((item) => item.type === "equipment"),
    },
  ]
}

export function parseShopQuantity(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? "1"), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return parsed
}

function usedInventorySlots(items: LobbyInventoryRecord[]): number {
  return items.filter((item) => !item.slot).length
}

export const VALID_EQUIP_SLOTS: ReadonlySet<EquipSlot> = new Set([
  "weapon",
  "armor",
  "helm",
  "hands",
  "accessory",
])

function findStackTarget(
  items: LobbyInventoryRecord[],
  templateId: string,
  stackLimit: number,
): LobbyInventoryRecord | null {
  return items.find(
    (item) => !item.slot && item.template_id === templateId && item.quantity < stackLimit,
  ) ?? null
}

export function toInventoryResponse(
  row: LobbyInventoryRecord,
  template: ItemTemplate,
): InventoryItem {
  return {
    id: row.id,
    template_id: row.template_id,
    name: template.name,
    quantity: row.quantity,
    modifiers: row.modifiers ?? {},
    owner_type: row.owner_type as InventoryItem["owner_type"],
    owner_id: row.owner_id,
    slot: (row.slot as InventoryItem["slot"]) ?? null,
  }
}

export function validateBuyItem(
  character: LobbyCharacterRecord,
  inventory: LobbyInventoryRecord[],
  itemId: string,
  quantity: number,
):
  | { ok: true; template: ItemTemplate; quantity: number; totalPrice: number; stackTarget: LobbyInventoryRecord | null }
  | { ok: false; error: string } {
  let template: ItemTemplate
  try {
    template = getItem(itemId)
  } catch {
    return { ok: false, error: "Unknown shop item." }
  }

  if (template.buy_price <= 0) {
    return { ok: false, error: "This item cannot be purchased from the lobby shop." }
  }
  if (quantity > template.stack_limit) {
    return { ok: false, error: `You can only buy up to ${template.stack_limit} at a time.` }
  }
  if (template.class_restriction && template.class_restriction !== character.class) {
    return {
      ok: false,
      error: `${template.name} is only sold to ${template.class_restriction}s.`,
    }
  }

  const totalPrice = template.buy_price * quantity
  if (character.gold < totalPrice) {
    return { ok: false, error: "Not enough gold." }
  }

  const stackTarget = findStackTarget(inventory, itemId, template.stack_limit)
  const canFitIntoExistingStack = stackTarget
    ? stackTarget.quantity + quantity <= template.stack_limit
    : false

  if (!canFitIntoExistingStack && usedInventorySlots(inventory) >= getInventoryCapacity()) {
    return { ok: false, error: "Inventory full." }
  }

  return {
    ok: true,
    template,
    quantity,
    totalPrice,
    stackTarget: canFitIntoExistingStack ? stackTarget : null,
  }
}

export function validateSellItem(
  inventory: LobbyInventoryRecord[],
  itemId: string,
  quantity: number,
):
  | { ok: true; row: LobbyInventoryRecord; template: ItemTemplate; quantity: number; totalGold: number }
  | { ok: false; error: string } {
  const row = inventory.find((item) => item.id === itemId)
  if (!row) {
    return { ok: false, error: "Item not found in your inventory." }
  }
  if (row.slot) {
    return { ok: false, error: "Unequip this item before selling it." }
  }
  if (quantity > row.quantity) {
    return { ok: false, error: "You do not have that many to sell." }
  }

  let template: ItemTemplate
  try {
    template = getItem(row.template_id)
  } catch {
    return { ok: false, error: "Unknown item template." }
  }
  if (template.sell_price <= 0) {
    return { ok: false, error: "This item cannot be sold." }
  }

  return {
    ok: true,
    row,
    template,
    quantity,
    totalGold: template.sell_price * quantity,
  }
}

export function validateLobbyEquip(
  character: LobbyCharacterRecord,
  inventory: LobbyInventoryRecord[],
  itemId: string,
):
  | {
    ok: true
    row: LobbyInventoryRecord
    template: ItemTemplate
    slot: EquipSlot
    equippedRow: LobbyInventoryRecord | null
  }
  | { ok: false; error: string } {
  const row = inventory.find((item) => item.id === itemId)
  if (!row) {
    return { ok: false, error: "Item not found in your inventory." }
  }
  if (row.slot) {
    return { ok: false, error: "That item is already equipped." }
  }

  let template: ItemTemplate
  try {
    template = getItem(row.template_id)
  } catch {
    return { ok: false, error: "Unknown item template." }
  }

  if (template.type !== "equipment" || !template.equip_slot) {
    return { ok: false, error: "That item cannot be equipped." }
  }
  if (template.class_restriction && template.class_restriction !== character.class) {
    return {
      ok: false,
      error: `${template.name} can only be equipped by ${template.class_restriction}s.`,
    }
  }

  const equippedRow = inventory.find((item) => item.slot === template.equip_slot) ?? null
  return {
    ok: true,
    row,
    template,
    slot: template.equip_slot,
    equippedRow,
  }
}

export function validateLobbyUnequip(
  inventory: LobbyInventoryRecord[],
  slot: EquipSlot,
):
  | { ok: true; row: LobbyInventoryRecord; template: ItemTemplate }
  | { ok: false; error: string } {
  const row = inventory.find((item) => item.slot === slot)
  if (!row) {
    return { ok: false, error: "Nothing is equipped in that slot." }
  }
  if (usedInventorySlots(inventory) >= getInventoryCapacity()) {
    return { ok: false, error: "Inventory full." }
  }

  let template: ItemTemplate
  try {
    template = getItem(row.template_id)
  } catch {
    return { ok: false, error: "Unknown item template." }
  }

  return { ok: true, row, template }
}

export function computeEquipmentHpBonus(inventoryRows: LobbyInventoryRecord[]): number {
  let bonus = 0
  for (const row of inventoryRows) {
    if (!row.slot) continue
    try {
      const template = getItem(row.template_id)
      bonus += template.stats?.hp ?? 0
    } catch { /* skip */ }
  }
  return bonus
}

const LOBBY_USABLE_EFFECTS = new Set(["heal-hp", "restore-resource"])

export function validateLobbyUseConsumable(
  character: LobbyCharacterRecord,
  inventory: LobbyInventoryRecord[],
  itemId: string,
  equipmentHpBonus: number,
):
  | { ok: true; row: LobbyInventoryRecord; template: ItemTemplate; effect: ItemEffect }
  | { ok: false; error: string } {
  const row = inventory.find((item) => item.id === itemId)
  if (!row) return { ok: false, error: "Item not found in your inventory." }
  if (row.slot) return { ok: false, error: "Cannot use an equipped item." }

  let template: ItemTemplate
  try {
    template = getItem(row.template_id)
  } catch {
    return { ok: false, error: "Unknown item template." }
  }

  if (template.type !== "consumable" || !template.effects?.length) {
    return { ok: false, error: "This item cannot be used." }
  }

  const effect = template.effects.find((e) => LOBBY_USABLE_EFFECTS.has(e.type))
  if (!effect) {
    return { ok: false, error: "This item can only be used inside a dungeon." }
  }

  const effectiveHpMax = character.hp_max + equipmentHpBonus
  if (effect.type === "heal-hp" && character.hp_current >= effectiveHpMax) {
    return { ok: false, error: "Already at full HP." }
  }
  if (effect.type === "restore-resource" && character.resource_current >= character.resource_max) {
    return { ok: false, error: "Resource already full." }
  }

  return { ok: true, row, template, effect }
}
