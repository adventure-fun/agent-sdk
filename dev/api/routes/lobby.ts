import { Hono } from "hono"
import { getItem, ITEMS, type InventoryItem } from "../../engine/index.js"
import { requireAuth } from "../auth.js"
import {
  appendLobbyMessage,
  broadcastLobbyMessage,
  getActiveSession,
  getCharacterByAccountId,
  getLastChatTimestamp,
  setLastChatTimestamp,
  updateCharacter,
  type DevCharacter,
  type SessionPayload,
} from "../store.js"

export const lobbyRoutes = new Hono()

const CHAT_RATE_LIMIT_MS = 5_000
const MAX_CHAT_LENGTH = 240
type LobbyEquipSlot = keyof DevCharacter["equipment"]
const EQUIP_SLOTS: LobbyEquipSlot[] = ["weapon", "armor", "helm", "hands", "accessory"]

function buildChatMessage(session: SessionPayload, message: string) {
  const character = getCharacterByAccountId(session.account_id)
  return {
    character_name: character?.name ?? session.wallet_address.slice(0, 8),
    character_class: character?.class ?? "rogue",
    player_type: session.player_type,
    message,
    timestamp: Date.now(),
  }
}

function requireLivingCharacter(session: SessionPayload) {
  const character = getCharacterByAccountId(session.account_id)
  if (!character || character.status !== "alive") {
    return null
  }

  return character
}

function createInventoryItem(templateId: string, ownerId: string, quantity = 1): InventoryItem {
  const template = getItem(templateId)
  return {
    id: crypto.randomUUID(),
    template_id: template.id,
    name: template.name,
    quantity,
    modifiers: { ...(template.stats ?? {}) },
    owner_type: "character",
    owner_id: ownerId,
    slot: null,
  }
}

function combineInventory(character: DevCharacter): InventoryItem[] {
  return [
    ...character.inventory.map((item) => ({ ...item })),
    ...Object.values(character.equipment)
      .filter((item): item is InventoryItem => item !== null)
      .map((item) => ({ ...item })),
  ]
}

function recomputeCharacterStats(character: DevCharacter): void {
  const effective = { ...character.stats }
  for (const item of Object.values(character.equipment)) {
    if (!item) {
      continue
    }

    for (const [key, value] of Object.entries(item.modifiers)) {
      if (key in effective) {
        effective[key as keyof typeof effective] += value
      }
    }
  }

  character.effective_stats = effective
  character.hp_max = effective.hp
  character.hp_current = Math.min(character.hp_current, character.hp_max)
}

function canMutateLobby(character: DevCharacter) {
  return !getActiveSession(character.id)
}

lobbyRoutes.get("/shops", (c) => {
  const items = (Object.values(ITEMS) as Array<ReturnType<typeof getItem>>)
    .filter((item) => item.buy_price > 0)
    .sort((left, right) => {
      if (left.type !== right.type) return left.type.localeCompare(right.type)
      if (left.rarity !== right.rarity) return left.rarity.localeCompare(right.rarity)
      return left.name.localeCompare(right.name)
    })

  return c.json({
    sections: [
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
    ],
    featured: [],
  })
})

lobbyRoutes.get("/shop/inventory", requireAuth, (c) => {
  const session = c.get("session")
  const character = requireLivingCharacter(session)
  if (!character) {
    return c.json({ error: "No living character" }, 404)
  }

  return c.json({
    gold: character.gold,
    inventory: combineInventory(character),
  })
})

lobbyRoutes.post("/shop/buy", requireAuth, async (c) => {
  const session = c.get("session")
  const character = requireLivingCharacter(session)
  if (!character) {
    return c.json({ error: "No living character" }, 404)
  }
  if (!canMutateLobby(character)) {
    return c.json({ error: "Leave the dungeon before shopping." }, 409)
  }

  const body = await c.req.json<{ item_id?: string; quantity?: number }>()
  const itemId = body.item_id?.trim()
  const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 1)))
  if (!itemId) {
    return c.json({ error: "item_id is required" }, 400)
  }

  let template
  try {
    template = getItem(itemId)
  } catch {
    return c.json({ error: "Unknown shop item." }, 400)
  }

  if (template.buy_price <= 0) {
    return c.json({ error: "This item cannot be purchased from the lobby shop." }, 400)
  }
  if (template.class_restriction && template.class_restriction !== character.class) {
    return c.json({ error: `${template.name} is only sold to ${template.class_restriction}s.` }, 400)
  }

  const totalPrice = template.buy_price * quantity
  if (character.gold < totalPrice) {
    return c.json({ error: "Not enough gold." }, 400)
  }

  character.gold -= totalPrice
  const stackable = template.stack_limit > 1
  const existingStack = stackable
    ? character.inventory.find((item) => !item.slot && item.template_id === template.id)
    : null
  if (existingStack) {
    existingStack.quantity += quantity
  } else {
    character.inventory.push(createInventoryItem(template.id, character.id, quantity))
  }

  updateCharacter(character)
  return c.json({
    gold: character.gold,
    item: combineInventory(character).find((item) => item.template_id === template.id && !item.slot),
    message: `Purchased ${quantity}x ${template.name}.`,
  })
})

lobbyRoutes.post("/shop/sell", requireAuth, async (c) => {
  const session = c.get("session")
  const character = requireLivingCharacter(session)
  if (!character) {
    return c.json({ error: "No living character" }, 404)
  }
  if (!canMutateLobby(character)) {
    return c.json({ error: "Leave the dungeon before shopping." }, 409)
  }

  const body = await c.req.json<{ item_id?: string; quantity?: number }>()
  const itemId = body.item_id?.trim()
  if (!itemId) {
    return c.json({ error: "item_id is required" }, 400)
  }

  const item = character.inventory.find((entry) => entry.id === itemId)
  if (!item) {
    return c.json({ error: "Item not found in your inventory." }, 404)
  }

  const quantity = Math.min(item.quantity, Math.max(1, Math.floor(Number(body.quantity ?? 1))))
  let template
  try {
    template = getItem(item.template_id)
  } catch {
    return c.json({ error: "Unknown item template." }, 400)
  }

  if (template.sell_price <= 0) {
    return c.json({ error: "This item cannot be sold." }, 400)
  }

  item.quantity -= quantity
  if (item.quantity <= 0) {
    character.inventory = character.inventory.filter((entry) => entry.id !== item.id)
  }
  character.gold += template.sell_price * quantity
  updateCharacter(character)

  return c.json({
    gold: character.gold,
    sold: {
      item_id: item.id,
      template_id: item.template_id,
      quantity,
      total_gold: template.sell_price * quantity,
    },
    message: `Sold ${quantity}x ${template.name}.`,
  })
})

lobbyRoutes.post("/equip", requireAuth, async (c) => {
  const session = c.get("session")
  const character = requireLivingCharacter(session)
  if (!character) {
    return c.json({ error: "No living character" }, 404)
  }
  if (!canMutateLobby(character)) {
    return c.json({ error: "Leave the dungeon before changing equipment." }, 409)
  }

  const body = await c.req.json<{ item_id?: string }>()
  const itemId = body.item_id?.trim()
  if (!itemId) {
    return c.json({ error: "item_id is required" }, 400)
  }

  const inventoryIndex = character.inventory.findIndex((item) => item.id === itemId)
  const item = inventoryIndex >= 0 ? character.inventory[inventoryIndex] : null
  if (!item) {
    return c.json({ error: "Item not found in your inventory." }, 404)
  }

  let template
  try {
    template = getItem(item.template_id)
  } catch {
    return c.json({ error: "Unknown item template." }, 400)
  }

  if (template.type !== "equipment" || !template.equip_slot || !EQUIP_SLOTS.includes(template.equip_slot)) {
    return c.json({ error: "Item cannot be equipped." }, 400)
  }

  if (template.class_restriction && template.class_restriction !== character.class) {
    return c.json({ error: `${template.name} is only usable by ${template.class_restriction}s.` }, 400)
  }

  const slot = template.equip_slot as LobbyEquipSlot
  const equipped = character.equipment[slot]
  character.inventory.splice(inventoryIndex, 1)
  if (equipped) {
    character.inventory.push({ ...equipped, slot: null })
  }
  character.equipment[slot] = { ...item, slot }
  recomputeCharacterStats(character)
  updateCharacter(character)

  return c.json({
    inventory: combineInventory(character),
    message: `Equipped ${template.name}.`,
  })
})

lobbyRoutes.post("/unequip", requireAuth, async (c) => {
  const session = c.get("session")
  const character = requireLivingCharacter(session)
  if (!character) {
    return c.json({ error: "No living character" }, 404)
  }
  if (!canMutateLobby(character)) {
    return c.json({ error: "Leave the dungeon before changing equipment." }, 409)
  }

  const body = await c.req.json<{ slot?: LobbyEquipSlot }>()
  const slot = body.slot
  if (!slot || !EQUIP_SLOTS.includes(slot)) {
    return c.json({ error: "slot is required" }, 400)
  }

  const equipped = character.equipment[slot]
  if (!equipped) {
    return c.json({ error: "Nothing is equipped in that slot." }, 400)
  }

  character.equipment[slot] = null
  character.inventory.push({ ...equipped, slot: null })
  recomputeCharacterStats(character)
  updateCharacter(character)

  return c.json({
    inventory: combineInventory(character),
    message: `Unequipped ${equipped.name}.`,
  })
})

lobbyRoutes.post("/use-consumable", requireAuth, async (c) => {
  const session = c.get("session")
  const character = requireLivingCharacter(session)
  if (!character) {
    return c.json({ error: "No living character" }, 404)
  }
  if (!canMutateLobby(character)) {
    return c.json({ error: "Leave the dungeon first." }, 409)
  }

  const body = await c.req.json<{ item_id?: string }>()
  const itemId = body.item_id?.trim()
  if (!itemId) {
    return c.json({ error: "item_id is required" }, 400)
  }

  const item = character.inventory.find((entry) => entry.id === itemId)
  if (!item) {
    return c.json({ error: "Item not found in your inventory." }, 404)
  }

  let template
  try {
    template = getItem(item.template_id)
  } catch {
    return c.json({ error: "Unknown item template." }, 400)
  }

  for (const effect of template.effects ?? []) {
    if (effect.type === "heal-hp") {
      character.hp_current = Math.min(character.hp_max, character.hp_current + (effect.magnitude ?? 0))
    }
    if (effect.type === "restore-resource") {
      character.resource_current = Math.min(
        character.resource_max,
        character.resource_current + (effect.magnitude ?? 0),
      )
    }
  }

  item.quantity -= 1
  if (item.quantity <= 0) {
    character.inventory = character.inventory.filter((entry) => entry.id !== item.id)
  }
  updateCharacter(character)

  return c.json({ message: `Used ${template.name}.` })
})

lobbyRoutes.post("/discard", requireAuth, async (c) => {
  const session = c.get("session")
  const character = requireLivingCharacter(session)
  if (!character) {
    return c.json({ error: "No living character" }, 404)
  }
  if (!canMutateLobby(character)) {
    return c.json({ error: "Leave the dungeon before discarding items." }, 409)
  }

  const body = await c.req.json<{ item_id?: string }>()
  const itemId = body.item_id?.trim()
  if (!itemId) {
    return c.json({ error: "item_id is required" }, 400)
  }

  const item = character.inventory.find((entry) => entry.id === itemId)
  if (!item) {
    return c.json({ error: "Item not found in your inventory." }, 404)
  }

  character.inventory = character.inventory.filter((entry) => entry.id !== item.id)
  updateCharacter(character)

  return c.json({ message: `Discarded ${item.name}.` })
})

lobbyRoutes.post("/inn/rest", requireAuth, (c) => {
  const session = c.get("session")
  const character = requireLivingCharacter(session)
  if (!character) {
    return c.json({ error: "No living character" }, 404)
  }
  if (!canMutateLobby(character)) {
    return c.json({ error: "Leave the dungeon before resting." }, 409)
  }

  character.hp_current = character.hp_max
  character.resource_current = character.resource_max
  updateCharacter(character)

  return c.json({
    hp_current: character.hp_current,
    hp_max: character.hp_max,
    resource_current: character.resource_current,
    resource_max: character.resource_max,
    message: "Rested at the inn.",
  })
})

lobbyRoutes.post("/chat", requireAuth, async (c) => {
  const body = await c.req.json<{ message?: string }>()
  const session = c.get("session")
  const character = getCharacterByAccountId(session.account_id)
  if (!character || character.status !== "alive") {
    return c.json({ error: "No living character" }, 404)
  }

  const message = body.message?.trim()
  if (!message) {
    return c.json({ error: "Message is required" }, 400)
  }
  if (message.length > MAX_CHAT_LENGTH) {
    return c.json({ error: `Message must be <= ${MAX_CHAT_LENGTH} characters` }, 400)
  }

  const now = Date.now()
  const lastSentAt = getLastChatTimestamp(character.id)
  if (now - lastSentAt < CHAT_RATE_LIMIT_MS) {
    return c.json({ error: "Chat is rate limited" }, 429)
  }

  setLastChatTimestamp(character.id, now)
  const sanitized = buildChatMessage(session, message)
  appendLobbyMessage(sanitized)
  broadcastLobbyMessage({ type: "lobby_chat", data: sanitized })
  return c.json({ ok: true })
})
