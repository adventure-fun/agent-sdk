import { Hono } from "hono"
import type { ActiveSpectateListResponse, SanitizedChatMessage } from "@adventure-fun/schemas"
import { getActiveSession, listSpectatableSessions } from "../game/active-sessions.js"
import { getSpectateChatManager } from "../game/spectate-chat.js"
import { getLobbyManager } from "../game/lobby-live.js"
import { persistChatMessage } from "../game/chat-log.js"
import { requireAuth } from "../auth/middleware.js"
import { db } from "../db/client.js"
import { validateChatMessage, publishChatMessage } from "../redis/publishers.js"
import { getPubSub } from "../redis/pubsub.js"

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

  // Look up the target character's active session to attach watching context.
  // This powers the badge shown when the message is mirrored to global chat.
  let spectateContext: SanitizedChatMessage["spectate_context"] | undefined
  const targetSession = getActiveSession(targetCharacterId)
  if (targetSession) {
    try {
      const obs = targetSession.getSpectatorObservation()
      spectateContext = {
        watching_character_name: obs.character.name || "unknown",
        realm_name: obs.realm_info.template_name,
      }
    } catch {
      // If obs build fails, mirror without context
    }
  }

  const chatMsg: SanitizedChatMessage = {
    character_name: senderCharacter.name,
    character_class: senderCharacter.class,
    player_type: (account?.player_type as string) ?? "human",
    message: validation.sanitized,
    timestamp: Date.now(),
    ...(spectateContext ? { spectate_context: spectateContext } : {}),
  }

  // Persist once per delivery target. The rehydrate query is scoped by
  // (room_type, room_key), so a spectate message that is ALSO mirrored to
  // the lobby needs a row in each room or the other will look empty after
  // a cold start. Storage cost is one extra row per mirrored message.
  const spectatePersist = await persistChatMessage(
    account_id, "spectate", targetCharacterId, chatMsg,
  )
  if (!spectatePersist.ok) {
    return c.json({ error: "Failed to store message" }, 500)
  }
  const lobbyPersist = await persistChatMessage(account_id, "lobby", null, chatMsg)
  if (!lobbyPersist.ok) {
    return c.json({ error: "Failed to store message" }, 500)
  }

  // 1) Broadcast to the per-player spectate chat room
  manager.broadcastChat(targetCharacterId, chatMsg)

  // 2) Mirror to the global lobby chat so everyone sees it with context
  const pubsub = getPubSub()
  if (pubsub) {
    await publishChatMessage(pubsub, chatMsg)
  } else {
    getLobbyManager().broadcastChat(chatMsg)
  }

  return c.json({ ok: true })
})

export { spectate as spectateRoutes }
