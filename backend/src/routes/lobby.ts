import { Hono } from "hono"
import { db } from "../db/client.js"
import { requireAuth } from "../auth/middleware.js"
import { hasActiveSession } from "../game/active-sessions.js"
import { getRequestedNetworks, logPayment, return402, verifyAndSettle } from "../payments/x402.js"
import { getPubSub } from "../redis/pubsub.js"
import { publishChatMessage, validateChatMessage } from "../redis/publishers.js"
import { getLobbyManager } from "../game/lobby-live.js"
import type { SanitizedChatMessage } from "@adventure-fun/schemas"
import {
  getShopCatalog,
  parseShopQuantity,
  toInventoryResponse,
  validateBuyItem,
  validateSellItem,
  type LobbyCharacterRecord,
  type LobbyInventoryRecord,
} from "./lobby-helpers.js"

const lobby = new Hono()

async function loadActiveCharacter(accountId: string) {
  return db
    .from("characters")
    .select("id, class, gold, hp_current, hp_max, resource_current, resource_max")
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
    inventory: ((inventoryRows ?? []) as LobbyInventoryRecord[]).map((row) => {
      const validation = validateSellItem([row], row.id, 1)
      if (validation.ok) return toInventoryResponse(row, validation.template)

      return {
        id: row.id,
        template_id: row.template_id,
        name: row.template_id,
        quantity: row.quantity,
        modifiers: row.modifiers ?? {},
        owner_type: row.owner_type as "character",
        owner_id: row.owner_id,
        slot: (row.slot as null | "weapon" | "armor" | "accessory" | "class-specific") ?? null,
      }
    }),
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
  if (hasActiveSession(character.id)) {
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
  if (hasActiveSession(character.id)) {
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

// POST /lobby/inn/rest — x402 gated
lobby.post("/inn/rest", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const { data: character, error: characterError } = await loadActiveCharacter(account_id)
  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)
  if (hasActiveSession(character.id)) {
    return c.json({ error: "Leave the dungeon before resting." }, 409)
  }
  if (
    character.hp_current >= character.hp_max
    && character.resource_current >= character.resource_max
  ) {
    return c.json({ error: "You are already fully rested." }, 409)
  }

  const networks = getRequestedNetworks(c)
  const settledPayment = await verifyAndSettle(c, "inn_rest", networks)
  if (!settledPayment) {
    return return402(c, "inn_rest", networks)
  }

  const { data: updatedCharacter, error } = await db
    .from("characters")
    .update({
      hp_current: character.hp_max,
      resource_current: character.resource_max,
    })
    .eq("id", character.id)
    .select("hp_current, hp_max, resource_current, resource_max")
    .single()

  if (error) return c.json({ error: error.message }, 500)

  Object.entries(settledPayment.headers).forEach(([key, value]) => c.header(key, value))
  await logPayment(account_id, settledPayment)

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
    character_name: character.name,
    character_class: character.class,
    player_type: (account?.player_type as string) ?? "human",
    message: validation.sanitized,
    timestamp: Date.now(),
  }

  // Broadcast locally
  manager.broadcastChat(chatMsg)

  // Publish to Redis for cross-instance delivery
  const pubsub = getPubSub()
  if (pubsub) {
    await publishChatMessage(pubsub, chatMsg)
  }

  return c.json({ ok: true })
})

export { lobby as lobbyRoutes }
