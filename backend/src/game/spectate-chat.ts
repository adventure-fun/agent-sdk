import type { SanitizedChatMessage } from "@adventure-fun/schemas"
import { loadRecentChat } from "./chat-log.js"

export interface SpectateChatSocketLike {
  send(payload: string): void
  close(): void
}

interface Room {
  clients: Set<SpectateChatSocketLike>
  recentChat: SanitizedChatMessage[]
  rateLimits: Map<string, number>
  /** Resolves when chat_log has been queried for this room. Populated lazily
   *  on the first addClient; subsequent connects share the same promise. */
  rehydratePromise: Promise<void> | null
}

const CHAT_HISTORY_SIZE = 50

/**
 * Per-character spectate chat rooms.
 * Each character has an isolated chat room that spectators watching that character
 * can read and authenticated players can post to.
 */
export class SpectateChatManager {
  private rooms = new Map<string, Room>()

  private getOrCreateRoom(characterId: string): Room {
    let room = this.rooms.get(characterId)
    if (!room) {
      room = {
        clients: new Set(),
        recentChat: [],
        rateLimits: new Map(),
        rehydratePromise: null,
      }
      this.rooms.set(characterId, room)
    }
    return room
  }

  private ensureRehydrated(room: Room, characterId: string): Promise<void> {
    if (room.rehydratePromise) return room.rehydratePromise
    room.rehydratePromise = loadRecentChat("spectate", characterId, CHAT_HISTORY_SIZE)
      .then((messages) => {
        // Merge rather than replace so concurrent broadcasts during the
        // rehydrate aren't dropped.
        const existing = new Set(room.recentChat.map((m) => m.timestamp))
        const fresh = messages.filter((m) => !existing.has(m.timestamp))
        room.recentChat = [...fresh, ...room.recentChat].slice(-CHAT_HISTORY_SIZE)
      })
      .catch((err) => {
        console.warn("[spectate-chat] rehydrate failed for", characterId, err)
      })
    return room.rehydratePromise
  }

  async addClient(characterId: string, ws: SpectateChatSocketLike): Promise<void> {
    const room = this.getOrCreateRoom(characterId)
    await this.ensureRehydrated(room, characterId)
    room.clients.add(ws)
    if (room.recentChat.length > 0) {
      ws.send(JSON.stringify({ type: "spectate_chat_history", data: room.recentChat }))
    }
  }

  removeClient(characterId: string, ws: SpectateChatSocketLike): void {
    const room = this.rooms.get(characterId)
    if (!room) return
    room.clients.delete(ws)
    // Keep the room around so history persists for reconnects within the same session
  }

  broadcastChat(characterId: string, message: SanitizedChatMessage): void {
    const room = this.getOrCreateRoom(characterId)
    room.recentChat.push(message)
    if (room.recentChat.length > CHAT_HISTORY_SIZE) {
      room.recentChat = room.recentChat.slice(-CHAT_HISTORY_SIZE)
    }
    const payload = JSON.stringify({ type: "spectate_chat", data: message })
    for (const client of room.clients) {
      try { client.send(payload) } catch { /* dead socket */ }
    }
  }

  checkRateLimit(characterId: string, senderCharacterId: string, windowMs: number): boolean {
    const room = this.getOrCreateRoom(characterId)
    const now = Date.now()
    const lastSent = room.rateLimits.get(senderCharacterId) ?? 0
    if (now - lastSent < windowMs) return false
    room.rateLimits.set(senderCharacterId, now)
    return true
  }

  getClientCount(characterId: string): number {
    return this.rooms.get(characterId)?.clients.size ?? 0
  }

  /** Clear the room entirely — call when the session ends. */
  clearRoom(characterId: string): void {
    this.rooms.delete(characterId)
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let instance: SpectateChatManager | null = null

export function getSpectateChatManager(): SpectateChatManager {
  if (!instance) instance = new SpectateChatManager()
  return instance
}
