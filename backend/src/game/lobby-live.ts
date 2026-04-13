import type {
  LobbyEvent,
  SanitizedChatMessage,
  LeaderboardDelta,
} from "@adventure-fun/schemas"
import { RedisPubSub, CHANNELS } from "../redis/pubsub.js"
import { loadRecentChat } from "./chat-log.js"

export interface LobbySocketLike {
  send(payload: string): void
  close(): void
}

const CHAT_HISTORY_SIZE = 50

export class LobbyLiveManager {
  private clients = new Set<LobbySocketLike>()
  private chatRateLimits = new Map<string, number>()
  private recentChat: SanitizedChatMessage[] = []
  private rehydratePromise: Promise<void> | null = null
  private pubsub: RedisPubSub | null = null
  private chatHandler: ((msg: string) => void) | null = null
  private activityHandler: ((msg: string) => void) | null = null
  private leaderboardHandler: ((msg: string) => void) | null = null

  get clientCount(): number {
    return this.clients.size
  }

  /** Rehydrate the in-memory buffer from chat_log. Called lazily from
   *  addClient on the first connect so the DB query only runs when someone
   *  is actually looking at the chat. Subsequent connects wait on the same
   *  promise and get instant-return once it resolves. */
  private ensureRehydrated(): Promise<void> {
    if (this.rehydratePromise) return this.rehydratePromise
    this.rehydratePromise = loadRecentChat("lobby", null, CHAT_HISTORY_SIZE)
      .then((messages) => {
        // Merge with anything that arrived during the rehydrate instead of
        // overwriting, so concurrent broadcasts aren't lost from the buffer.
        const existing = new Set(this.recentChat.map((m) => m.timestamp))
        const fresh = messages.filter((m) => !existing.has(m.timestamp))
        this.recentChat = [...fresh, ...this.recentChat].slice(-CHAT_HISTORY_SIZE)
      })
      .catch((err) => {
        console.warn("[lobby-live] chat rehydrate failed, serving empty buffer", err)
      })
    return this.rehydratePromise
  }

  async addClient(ws: LobbySocketLike): Promise<void> {
    await this.ensureRehydrated()
    this.clients.add(ws)
    // Send chat backlog so late-joiners see recent messages
    if (this.recentChat.length > 0) {
      ws.send(JSON.stringify({ type: "lobby_chat_history", data: this.recentChat }))
    }
  }

  removeClient(ws: LobbySocketLike): void {
    this.clients.delete(ws)
  }

  broadcastActivity(event: LobbyEvent): void {
    const payload = JSON.stringify({ type: "lobby_activity", data: event })
    this.broadcast(payload)
  }

  broadcastChat(message: SanitizedChatMessage): void {
    this.recentChat.push(message)
    if (this.recentChat.length > CHAT_HISTORY_SIZE) {
      this.recentChat = this.recentChat.slice(-CHAT_HISTORY_SIZE)
    }
    const payload = JSON.stringify({ type: "lobby_chat", data: message })
    this.broadcast(payload)
  }

  broadcastLeaderboardDelta(delta: LeaderboardDelta): void {
    const payload = JSON.stringify({ type: "leaderboard_update", data: delta })
    this.broadcast(payload)
  }

  checkChatRateLimit(characterId: string, windowMs: number): boolean {
    const now = Date.now()
    const lastSent = this.chatRateLimits.get(characterId) ?? 0
    if (now - lastSent < windowMs) return false
    this.chatRateLimits.set(characterId, now)
    return true
  }

  connectPubSub(pubsub: RedisPubSub): void {
    this.pubsub = pubsub

    this.chatHandler = (msg: string) => {
      try {
        const data = JSON.parse(msg) as SanitizedChatMessage
        this.broadcastChat(data)
      } catch { /* ignore malformed */ }
    }

    this.activityHandler = (msg: string) => {
      try {
        const data = JSON.parse(msg) as LobbyEvent
        this.broadcastActivity(data)
      } catch { /* ignore malformed */ }
    }

    this.leaderboardHandler = (msg: string) => {
      try {
        const data = JSON.parse(msg) as LeaderboardDelta
        this.broadcastLeaderboardDelta(data)
      } catch { /* ignore malformed */ }
    }

    pubsub.subscribe(CHANNELS.LOBBY_CHAT, this.chatHandler)
    pubsub.subscribe(CHANNELS.LOBBY_ACTIVITY, this.activityHandler)
    pubsub.subscribe(CHANNELS.LEADERBOARD_UPDATES, this.leaderboardHandler)
  }

  disconnectPubSub(): void {
    if (!this.pubsub) return
    if (this.chatHandler) this.pubsub.unsubscribe(CHANNELS.LOBBY_CHAT, this.chatHandler)
    if (this.activityHandler) this.pubsub.unsubscribe(CHANNELS.LOBBY_ACTIVITY, this.activityHandler)
    if (this.leaderboardHandler) this.pubsub.unsubscribe(CHANNELS.LEADERBOARD_UPDATES, this.leaderboardHandler)
    this.pubsub = null
  }

  private broadcast(payload: string): void {
    for (const client of this.clients) {
      try {
        client.send(payload)
      } catch { /* dead socket — cleaned up on close */ }
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let lobbyManagerInstance: LobbyLiveManager | null = null

export function getLobbyManager(): LobbyLiveManager {
  if (!lobbyManagerInstance) {
    lobbyManagerInstance = new LobbyLiveManager()
  }
  return lobbyManagerInstance
}
