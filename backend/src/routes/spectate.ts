import { Hono } from "hono"
import type { ActiveSpectateListResponse, SanitizedChatMessage } from "@adventure-fun/schemas"
import { listSpectatableSessions } from "../game/active-sessions.js"
import { getSpectateChatManager } from "../game/spectate-chat.js"
import { requireAuth } from "../auth/middleware.js"
import { db } from "../db/client.js"
import { validateChatMessage } from "../redis/publishers.js"

const spectate = new Hono()

// GET /spectate/active — public, no auth
spectate.get("/active", (c) => {
  const body: ActiveSpectateListResponse = { sessions: listSpectatableSessions() }
  return c.json(body)
})

// POST /spectate/:characterId/chat — send a chat message to a character's spectator room
const CHAT_RATE_LIMIT_MS =
  Number(process.env["SPECTATE_CHAT_RATE_LIMIT_SECONDS"] ?? 5) * 1000

spectate.post("/:characterId/chat", requireAuth, async (c) => {
  const { characterId: targetCharacterId } = c.req.param()
  const { account_id } = c.get("session")

  const { data: senderCharacter } = await db
    .from("characters")
    .select("id, name, class, accounts(player_type)")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (!senderCharacter) return c.json({ error: "No living character" }, 404)

  const body = await c.req.json<{ message?: unknown }>()
  const validation = validateChatMessage(body.message)
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400)
  }

  const manager = getSpectateChatManager()
  if (!manager.checkRateLimit(targetCharacterId, senderCharacter.id, CHAT_RATE_LIMIT_MS)) {
    return c.json({ error: "Chat rate limited. Wait a few seconds." }, 429)
  }

  const account = (senderCharacter as Record<string, unknown>).accounts as
    | Record<string, unknown>
    | null

  const chatMsg: SanitizedChatMessage = {
    character_name: senderCharacter.name,
    character_class: senderCharacter.class,
    player_type: (account?.player_type as string) ?? "human",
    message: validation.sanitized,
    timestamp: Date.now(),
  }

  manager.broadcastChat(targetCharacterId, chatMsg)

  return c.json({ ok: true })
})

export { spectate as spectateRoutes }
