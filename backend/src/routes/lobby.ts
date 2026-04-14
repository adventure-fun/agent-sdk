import { Hono } from "hono"
import { db } from "../db/client.js"
import { requireAuth } from "../auth/middleware.js"
import { hasLockedRealm } from "../game/active-sessions.js"
import { getRequestedNetworks, isActionFree, logPayment, return402, verifyAndSettle } from "../payments/x402.js"
import { getPubSub } from "../redis/pubsub.js"
import { publishChatMessage, validateChatMessage } from "../redis/publishers.js"
import { getLobbyManager } from "../game/lobby-live.js"
import { persistChatMessage } from "../game/chat-log.js"
import type { EquipSlot, ItemTemplate, SanitizedChatMessage } from "@adventure-fun/schemas"
import { getItem } from "@adventure-fun/engine"
import {
  getShopCatalog,
  parseShopQuantity,
  toInventoryResponse,
  validateBuyItem,
  validateLobbyEquip,
  validateLobbyUnequip,
  validateSellItem,
  validateLobbyUseConsumable,
  computeEffectiveHpMax,
  VALID_EQUIP_SLOTS,
  type LobbyCharacterRecord,
  type LobbyInventoryRecord,
} from "./lobby-helpers.js"

const lobby = new Hono()

async function loadActiveCharacter(accountId: string) {
  return db
    .from("characters")
    .select("id, class, gold, hp_current, hp_max, resource_current, resource_max, perks")
    .eq("account_id", accountId)
    .eq("status", "alive")
    .maybeSingle()
}

async function loadInventory(characterId: string) {
  return db
    .from("inventory_items")
    .select("id, template_id, quantity, owner_type, owner_id, slot, modifiers")
    .eq("owner_type", "character")
    .eq("owner_id", characterId)
}

function serializeInventory(rows: LobbyInventoryRecord[]) {
  const items = rows.map((row) => {
    let template: ItemTemplate | undefined
    try {
      template = getItem(row.template_id)
    } catch {
      // unknown template — fall through
    }
    if (template) return toInventoryResponse(row, template)

    return {
      id: row.id,
      template_id: row.template_id,
      name: row.template_id,
      quantity: row.quantity,
      modifiers: row.modifiers ?? {},
      owner_type: row.owner_type as "character",
      owner_id: row.owner_id,
      slot: (row.slot as null | "weapon" | "armor" | "helm" | "hands" | "accessory") ?? null,
    }
  })

  // Merge unequipped items with the same template_id into single stacks
  const merged: typeof items = []
  const seen = new Map<string, (typeof items)[number]>()
  for (const item of items) {
    if (item.slot) {
      merged.push(item)
      continue
    }
    const existing = seen.get(item.template_id)
    if (existing) {
      existing.quantity += item.quantity
    } else {
      seen.set(item.template_id, item)
      merged.push(item)
    }
  }
  return merged
}

// GET /lobby/shops
lobby.get("/shops", async (c) => {
  const sections = getShopCatalog()
  return c.json({
    sections,
    featured: sections.flatMap((section) => section.items).slice(0, 6),
  })
})

// GET /lobby/shop/inventory
lobby.get("/shop/inventory", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const { data: character, error: characterError } = await loadActiveCharacter(account_id)
  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)

  const { data: inventoryRows, error: inventoryError } = await loadInventory(character.id)
  if (inventoryError) return c.json({ error: inventoryError.message }, 500)

  return c.json({
    gold: character.gold,
    inventory: serializeInventory((inventoryRows ?? []) as LobbyInventoryRecord[]),
  })
})

// POST /lobby/shop/buy
lobby.post("/shop/buy", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const body = await c.req.json<{ item_id?: string; quantity?: number }>()
  const itemId = body.item_id?.trim()
  if (!itemId) return c.json({ error: "item_id is required" }, 400)

  const { data: character, error: characterError } = await loadActiveCharacter(account_id)
  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)
  if (await hasLockedRealm(character.id)) {
    return c.json({ error: "Leave the dungeon before shopping." }, 409)
  }

  const { data: inventoryRows, error: inventoryError } = await loadInventory(character.id)
  if (inventoryError) return c.json({ error: inventoryError.message }, 500)

  const quantity = parseShopQuantity(body.quantity)
  const validation = validateBuyItem(
    character as LobbyCharacterRecord,
    (inventoryRows ?? []) as LobbyInventoryRecord[],
    itemId,
    quantity,
  )
  if (!validation.ok) return c.json({ error: validation.error }, 400)

  const nextGold = character.gold - validation.totalPrice
  let persistedRow: LobbyInventoryRecord | null = null

  if (validation.stackTarget) {
    const { data: updatedRow, error } = await db
      .from("inventory_items")
      .update({ quantity: validation.stackTarget.quantity + validation.quantity })
      .eq("id", validation.stackTarget.id)
      .select("id, template_id, quantity, owner_type, owner_id, slot, modifiers")
      .single()

    if (error) return c.json({ error: error.message }, 500)
    persistedRow = updatedRow as LobbyInventoryRecord
  } else {
    const { data: insertedRow, error } = await db
      .from("inventory_items")
      .insert({
        character_id: character.id,
        owner_type: "character",
        owner_id: character.id,
        template_id: validation.template.id,
        quantity: validation.quantity,
        modifiers: {},
        slot: null,
      })
      .select("id, template_id, quantity, owner_type, owner_id, slot, modifiers")
      .single()

    if (error) return c.json({ error: error.message }, 500)
    persistedRow = insertedRow as LobbyInventoryRecord
  }

  const { error: goldError } = await db
    .from("characters")
    .update({ gold: nextGold })
    .eq("id", character.id)

  if (goldError) return c.json({ error: goldError.message }, 500)

  return c.json({
    gold: nextGold,
    item: toInventoryResponse(persistedRow, validation.template),
    message: `Purchased ${validation.quantity} ${validation.template.name}${validation.quantity === 1 ? "" : "s"}.`,
  })
})

// POST /lobby/shop/sell
lobby.post("/shop/sell", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const body = await c.req.json<{ item_id?: string; quantity?: number }>()
  const itemId = body.item_id?.trim()
  if (!itemId) return c.json({ error: "item_id is required" }, 400)

  const { data: character, error: characterError } = await loadActiveCharacter(account_id)
  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)
  if (await hasLockedRealm(character.id)) {
    return c.json({ error: "Leave the dungeon before shopping." }, 409)
  }

  const { data: inventoryRows, error: inventoryError } = await loadInventory(character.id)
  if (inventoryError) return c.json({ error: inventoryError.message }, 500)

  const quantity = parseShopQuantity(body.quantity)
  const validation = validateSellItem(
    (inventoryRows ?? []) as LobbyInventoryRecord[],
    itemId,
    quantity,
  )
  if (!validation.ok) return c.json({ error: validation.error }, 400)

  if (validation.quantity === validation.row.quantity) {
    const { error } = await db.from("inventory_items").delete().eq("id", validation.row.id)
    if (error) return c.json({ error: error.message }, 500)
  } else {
    const { error } = await db
      .from("inventory_items")
      .update({ quantity: validation.row.quantity - validation.quantity })
      .eq("id", validation.row.id)
    if (error) return c.json({ error: error.message }, 500)
  }

  const nextGold = character.gold + validation.totalGold
  const { error: goldError } = await db
    .from("characters")
    .update({ gold: nextGold })
    .eq("id", character.id)

  if (goldError) return c.json({ error: goldError.message }, 500)

  return c.json({
    gold: nextGold,
    sold: {
      item_id: validation.row.id,
      template_id: validation.template.id,
      quantity: validation.quantity,
      total_gold: validation.totalGold,
    },
    message: `Sold ${validation.quantity} ${validation.template.name}${validation.quantity === 1 ? "" : "s"}.`,
  })
})

// POST /lobby/equip
lobby.post("/equip", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const body = await c.req.json<{ item_id?: string }>()
  const itemId = body.item_id?.trim()
  if (!itemId) return c.json({ error: "item_id is required" }, 400)

  const { data: character, error: characterError } = await loadActiveCharacter(account_id)
  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)
  if (await hasLockedRealm(character.id)) {
    return c.json({ error: "Leave the dungeon before changing equipment." }, 409)
  }

  const { data: inventoryRows, error: inventoryError } = await loadInventory(character.id)
  if (inventoryError) return c.json({ error: inventoryError.message }, 500)

  const inventory = (inventoryRows ?? []) as LobbyInventoryRecord[]
  const validation = validateLobbyEquip(character as LobbyCharacterRecord, inventory, itemId)
  if (!validation.ok) return c.json({ error: validation.error }, 400)

  if (validation.equippedRow) {
    const { error } = await db
      .from("inventory_items")
      .update({ slot: null })
      .eq("id", validation.equippedRow.id)
    if (error) return c.json({ error: error.message }, 500)
  }

  const { error: equipError } = await db
    .from("inventory_items")
    .update({ slot: validation.slot })
    .eq("id", validation.row.id)
  if (equipError) return c.json({ error: equipError.message }, 500)

  const updatedInventory = inventory.map((row) => {
    if (validation.equippedRow && row.id === validation.equippedRow.id) {
      return { ...row, slot: null }
    }
    if (row.id === validation.row.id) {
      return { ...row, slot: validation.slot }
    }
    return row
  })

  // Cap hp_current if it now exceeds the effective max (base + equipment + perks)
  const effectiveMax = computeEffectiveHpMax(character as LobbyCharacterRecord, updatedInventory)
  if (character.hp_current > effectiveMax) {
    await db.from("characters").update({ hp_current: effectiveMax }).eq("id", character.id)
  }

  return c.json({
    inventory: serializeInventory(updatedInventory),
    message: `Equipped ${validation.template.name}.`,
  })
})

// POST /lobby/unequip
lobby.post("/unequip", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const body = await c.req.json<{ slot?: string }>()
  const slot = body.slot?.trim()
  if (!slot || !VALID_EQUIP_SLOTS.has(slot as EquipSlot)) {
    return c.json({ error: "slot is required" }, 400)
  }

  const { data: character, error: characterError } = await loadActiveCharacter(account_id)
  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)
  if (await hasLockedRealm(character.id)) {
    return c.json({ error: "Leave the dungeon before changing equipment." }, 409)
  }

  const { data: inventoryRows, error: inventoryError } = await loadInventory(character.id)
  if (inventoryError) return c.json({ error: inventoryError.message }, 500)

  const inventory = (inventoryRows ?? []) as LobbyInventoryRecord[]
  const validation = validateLobbyUnequip(inventory, slot as EquipSlot)
  if (!validation.ok) return c.json({ error: validation.error }, 400)

  const { error: unequipError } = await db
    .from("inventory_items")
    .update({ slot: null })
    .eq("id", validation.row.id)
  if (unequipError) return c.json({ error: unequipError.message }, 500)

  const updatedInventory = inventory.map((row) =>
    row.id === validation.row.id ? { ...row, slot: null } : row,
  )

  // Cap hp_current if it now exceeds the effective max (base + equipment + perks)
  const effectiveMax = computeEffectiveHpMax(character as LobbyCharacterRecord, updatedInventory)
  if (character.hp_current > effectiveMax) {
    await db.from("characters").update({ hp_current: effectiveMax }).eq("id", character.id)
  }

  return c.json({
    inventory: serializeInventory(updatedInventory),
    message: `Unequipped ${validation.template.name}.`,
  })
})

// POST /lobby/use-consumable — use a potion or similar from the lobby
lobby.post("/use-consumable", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const body = await c.req.json<{ item_id?: string }>()
  const itemId = body.item_id?.trim()
  if (!itemId) return c.json({ error: "item_id is required" }, 400)

  const { data: character, error: characterError } = await loadActiveCharacter(account_id)
  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)
  if (await hasLockedRealm(character.id)) {
    return c.json({ error: "Leave the dungeon first." }, 409)
  }

  const { data: inventoryRows, error: inventoryError } = await loadInventory(character.id)
  if (inventoryError) return c.json({ error: inventoryError.message }, 500)

  const inventory = (inventoryRows ?? []) as LobbyInventoryRecord[]
  const effectiveHpMax = computeEffectiveHpMax(character as LobbyCharacterRecord, inventory)
  const validation = validateLobbyUseConsumable(
    character as LobbyCharacterRecord,
    inventory,
    itemId,
    effectiveHpMax,
  )
  if (!validation.ok) return c.json({ error: validation.error }, 400)

  const { row, template, effect } = validation

  // Apply effect
  if (effect.type === "heal-hp") {
    const heal = Math.min(effect.magnitude ?? 0, effectiveHpMax - character.hp_current)
    await db.from("characters")
      .update({ hp_current: character.hp_current + heal })
      .eq("id", character.id)
  } else if (effect.type === "restore-resource") {
    const restore = Math.min(effect.magnitude ?? 0, character.resource_max - character.resource_current)
    await db.from("characters")
      .update({ resource_current: character.resource_current + restore })
      .eq("id", character.id)
  }

  // Consume item
  if (row.quantity > 1) {
    await db.from("inventory_items")
      .update({ quantity: row.quantity - 1 })
      .eq("id", row.id)
  } else {
    await db.from("inventory_items").delete().eq("id", row.id)
  }

  return c.json({
    message: `Used ${template.name}.`,
  })
})

// POST /lobby/discard — drop an item from inventory
lobby.post("/discard", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const body = await c.req.json<{ item_id?: string }>()
  const itemId = body.item_id?.trim()
  if (!itemId) return c.json({ error: "item_id is required" }, 400)

  const { data: character, error: characterError } = await loadActiveCharacter(account_id)
  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)
  if (await hasLockedRealm(character.id)) {
    return c.json({ error: "Leave the dungeon before discarding items." }, 409)
  }

  const { data: inventoryRows, error: inventoryError } = await loadInventory(character.id)
  if (inventoryError) return c.json({ error: inventoryError.message }, 500)

  const row = (inventoryRows ?? []).find((item) => item.id === itemId)
  if (!row) return c.json({ error: "Item not found in your inventory." }, 400)
  if (row.slot) return c.json({ error: "Unequip this item before discarding it." }, 400)

  const { error: deleteError } = await db.from("inventory_items").delete().eq("id", row.id)
  if (deleteError) return c.json({ error: deleteError.message }, 500)

  let itemName = row.template_id
  try { itemName = getItem(row.template_id).name } catch { /* keep template_id */ }

  return c.json({
    message: `Discarded ${itemName}.`,
  })
})

// POST /lobby/inn/rest — x402 gated
lobby.post("/inn/rest", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const { data: character, error: characterError } = await loadActiveCharacter(account_id)
  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)
  if (await hasLockedRealm(character.id)) {
    return c.json({ error: "Leave the dungeon before resting." }, 409)
  }

  // Compute effective HP max including equipment AND perk bonuses
  const { data: inventoryRows } = await loadInventory(character.id)
  const innInventory = (inventoryRows ?? []) as LobbyInventoryRecord[]
  const effectiveHpMax = computeEffectiveHpMax(character as LobbyCharacterRecord, innInventory)

  if (
    character.hp_current >= effectiveHpMax
    && character.resource_current >= character.resource_max
  ) {
    return c.json({ error: "You are already fully rested." }, 409)
  }

  const networks = getRequestedNetworks(c)
  let settledPayment: Awaited<ReturnType<typeof verifyAndSettle>> = null
  if (!isActionFree("inn_rest")) {
    settledPayment = await verifyAndSettle(c, "inn_rest", networks)
    if (!settledPayment) {
      return return402(c, "inn_rest", networks)
    }
  }

  const { data: updatedCharacter, error } = await db
    .from("characters")
    .update({
      hp_current: effectiveHpMax,
      resource_current: character.resource_max,
    })
    .eq("id", character.id)
    .select("hp_current, hp_max, resource_current, resource_max")
    .single()

  if (error) return c.json({ error: error.message }, 500)

  if (settledPayment) {
    Object.entries(settledPayment.headers).forEach(([key, value]) => c.header(key, value))
    await logPayment(account_id, settledPayment)
  }

  return c.json({
    ...updatedCharacter,
    message: "You rest at the inn and feel restored.",
  })
})

// POST /lobby/chat — send a chat message to the lobby
const CHAT_RATE_LIMIT_MS =
  Number(process.env["LOBBY_CHAT_RATE_LIMIT_SECONDS"] ?? 5) * 1000

lobby.post("/chat", requireAuth, async (c) => {
  const { account_id } = c.get("session")

  const { data: character } = await db
    .from("characters")
    .select("id, name, class, accounts(player_type)")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (!character) return c.json({ error: "No living character" }, 404)

  const body = await c.req.json<{ message?: unknown }>()
  const validation = validateChatMessage(body.message)
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400)
  }

  const manager = getLobbyManager()
  if (!manager.checkChatRateLimit(character.id, CHAT_RATE_LIMIT_MS)) {
    return c.json({ error: "Chat rate limited. Wait a few seconds." }, 429)
  }

  const account = (character as Record<string, unknown>).accounts as
    | Record<string, unknown>
    | null

  const chatMsg: SanitizedChatMessage = {
    character_id: character.id,
    character_name: character.name,
    character_class: character.class,
    player_type: (account?.player_type as string) ?? "human",
    message: validation.sanitized,
    timestamp: Date.now(),
  }

  // Persist first so a DB failure blocks delivery — we never want in-memory
  // ghosts that nobody else can rehydrate after a restart.
  const persisted = await persistChatMessage(account_id, "lobby", null, chatMsg)
  if (!persisted.ok) {
    return c.json({ error: "Failed to store message" }, 500)
  }

  // Publish to Redis for cross-instance delivery (the subscriber will broadcast locally).
  // If Redis is unavailable, broadcast directly so single-instance still works.
  const pubsub = getPubSub()
  if (pubsub) {
    await publishChatMessage(pubsub, chatMsg)
  } else {
    manager.broadcastChat(chatMsg)
  }

  return c.json({ ok: true })
})

export { lobby as lobbyRoutes }
