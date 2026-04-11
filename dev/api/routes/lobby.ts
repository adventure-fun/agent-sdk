import { Hono } from "hono"
import { requireAuth } from "../auth.js"
import { appendLobbyMessage, broadcastLobbyMessage, getCharacterByAccountId, getLastChatTimestamp, setLastChatTimestamp, type SessionPayload } from "../store.js"

export const lobbyRoutes = new Hono()

const CHAT_RATE_LIMIT_MS = 5_000
const MAX_CHAT_LENGTH = 240

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
