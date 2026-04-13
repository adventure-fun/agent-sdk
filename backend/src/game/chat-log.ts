// Chat persistence helpers — Tier 2 storage for global lobby chat and
// per-character spectate chat rooms. Every chat message goes through here
// before being broadcast, and the in-memory ring buffers in LobbyLiveManager
// and SpectateChatManager get rehydrated from the DB on backend restart so
// clients that connect right after a deploy still see recent history.
//
// Why this exists:
//
// The in-memory ring buffers give us a zero-latency hot cache for the last
// 50 messages per room. They're perfect for the common case where a spectator
// joins a live room and wants the backlog the other spectators have been
// reading. What they don't do: survive a backend restart, outlive the room,
// or give us a moderation audit trail. chat_log fills those gaps.
//
// Reads always go through the ring buffer first. We only touch the DB on
// addClient for a brand-new room and on the cold-start rehydrate, so the
// write path is the hot path and we keep it small.

import type { SanitizedChatMessage } from "@adventure-fun/schemas"
import { db } from "../db/client.js"

export type ChatRoomType = "lobby" | "spectate"

interface ChatLogRow {
  account_id: string
  character_id: string | null
  character_name: string | null
  character_class: string | null
  player_type: "human" | "agent" | null
  raw_message: string
  filtered_message: string | null
  was_blocked: boolean | null
  block_reason: string | null
  room_type: ChatRoomType
  room_key: string | null
  spectate_context: unknown
  created_at: string
}

/** Persist a chat message to chat_log. Called from the chat POST endpoints
 *  before the message gets broadcast, so a DB write failure short-circuits
 *  delivery and we never have "in-memory ghosts" that nobody can rehydrate.
 *
 *  `accountId` is the sender — used by moderation tooling to find all
 *  messages from one account. For the lobby room, `roomKey` is null. For
 *  spectate rooms, `roomKey` is the characterId being watched.
 */
export async function persistChatMessage(
  accountId: string,
  roomType: ChatRoomType,
  roomKey: string | null,
  msg: SanitizedChatMessage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db.from("chat_log").insert({
    account_id: accountId,
    character_id: msg.character_id ?? null,
    character_name: msg.character_name,
    character_class: msg.character_class,
    player_type: msg.player_type,
    raw_message: msg.message,
    // We don't run content moderation yet — filtered_message mirrors raw
    // so a future policy change can diff the two columns and spot drift.
    filtered_message: msg.message,
    was_blocked: false,
    room_type: roomType,
    room_key: roomKey,
    spectate_context: msg.spectate_context ?? null,
  })

  if (error) {
    // Log but surface to caller so the POST endpoint can return 500.
    console.error("[chat-log] insert failed", { roomType, roomKey, error })
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** Load the N most recent messages for a given room, oldest-first so the
 *  ring buffer can append them in order and the frontend can render them
 *  without re-sorting. Returns an empty array on any error (cold rehydrate
 *  should never block a client from joining). */
export async function loadRecentChat(
  roomType: ChatRoomType,
  roomKey: string | null,
  limit = 50,
): Promise<SanitizedChatMessage[]> {
  let query = db
    .from("chat_log")
    .select("character_id, character_name, character_class, player_type, filtered_message, raw_message, spectate_context, created_at")
    .eq("room_type", roomType)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (roomKey === null) {
    query = query.is("room_key", null)
  } else {
    query = query.eq("room_key", roomKey)
  }

  const { data, error } = await query
  if (error) {
    console.error("[chat-log] rehydrate failed", { roomType, roomKey, error })
    return []
  }

  const rows = (data ?? []) as Array<Partial<ChatLogRow>>
  // Map DB rows -> SanitizedChatMessage. DB is newest-first; reverse so the
  // ring buffer keeps chronological order.
  const out: SanitizedChatMessage[] = []
  for (const row of rows) {
    if (!row.character_name || !row.character_class || !row.player_type) continue
    const message = row.filtered_message ?? row.raw_message
    if (!message) continue
    const ts = row.created_at ? new Date(row.created_at).getTime() : Date.now()
    const base: SanitizedChatMessage = {
      character_name: row.character_name,
      // character_class is an enum in the canonical schema; the DB stores it
      // as TEXT. The cast is safe because we only write valid values.
      character_class: row.character_class as SanitizedChatMessage["character_class"],
      player_type: row.player_type,
      message,
      timestamp: ts,
    }
    // character_id is optional (historical rows lack it — added in
    // migration 20260413210000 for issue #7). Only attach when present.
    if (row.character_id) {
      base.character_id = row.character_id
    }
    if (row.spectate_context) {
      base.spectate_context = row.spectate_context as SanitizedChatMessage["spectate_context"]
    }
    out.push(base)
  }
  return out.reverse()
}
