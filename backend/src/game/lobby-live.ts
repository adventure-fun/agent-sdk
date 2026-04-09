import type {
  LobbyEvent,
  SanitizedChatMessage,
  LeaderboardDelta,
} from "@adventure-fun/schemas"
import { RedisPubSub, CHANNELS } from "../redis/pubsub.js"

export interface LobbySocketLike {
  send(payload: string): void
  close(): void
}

export class LobbyLiveManager {
  private clients = new Set<LobbySocketLike>()
  private chatRateLimits = new Map<string, number>()
  private pubsub: RedisPubSub | null = null
  private chatHandler: ((msg: string) => void) | null = null
  private activityHandler: ((msg: string) => void) | null = null
  private leaderboardHandler: ((msg: string) => void) | null = null

  get clientCount(): number {
    return this.clients.size
  }

  addClient(ws: LobbySocketLike): void {
    this.clients.add(ws)
  }

  removeClient(ws: LobbySocketLike): void {
    this.clients.delete(ws)
  }

  broadcastActivity(event: LobbyEvent): void {
    const payload = JSON.stringify({ type: "lobby_activity", data: event })
    this.broadcast(payload)
  }

  broadcastChat(message: SanitizedChatMessage): void {
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
