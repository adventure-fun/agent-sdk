import { describe, expect, it, beforeEach, mock } from "bun:test"
import type {
  LobbyEvent,
  SanitizedChatMessage,
  LeaderboardDelta,
} from "@adventure-fun/schemas"

// chat-log imports db/client which throws at import time without env vars.
// Stub it before we dynamically import lobby-live so the transitive require
// never touches the real db client. We're testing the in-memory broadcast
// and rehydrate logic, not the DB round-trip.
mock.module("../src/game/chat-log.js", () => ({
  persistChatMessage: async () => ({ ok: true }),
  loadRecentChat: async () => [],
}))

const lobbyLiveModule = await import("../src/game/lobby-live.js")
const { LobbyLiveManager } = lobbyLiveModule
type LobbySocketLike = import("../src/game/lobby-live.js").LobbySocketLike

import { RedisPubSub, CHANNELS } from "../src/redis/pubsub.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockSocket(): LobbySocketLike & { sent: string[]; isClosed: boolean } {
  const sent: string[] = []
  return {
    sent,
    isClosed: false,
    send(payload: string) {
      sent.push(payload)
    },
    close() {
      this.isClosed = true
    },
  }
}

function createFakePubSub() {
  const published: Array<{ channel: string; message: string }> = []
  const subscriptions = new Map<string, Set<(msg: string) => void>>()

  const pubsub = {
    async subscribe(channel: string, handler: (msg: string) => void) {
      let handlers = subscriptions.get(channel)
      if (!handlers) {
        handlers = new Set()
        subscriptions.set(channel, handlers)
      }
      handlers.add(handler)
    },
    async unsubscribe(channel: string, handler: (msg: string) => void) {
      subscriptions.get(channel)?.delete(handler)
      if (subscriptions.get(channel)?.size === 0) subscriptions.delete(channel)
    },
    async publish(channel: string, message: string) {
      published.push({ channel, message })
      const handlers = subscriptions.get(channel)
      if (handlers) {
        for (const handler of handlers) handler(message)
      }
      return true
    },
    get channelCount() {
      return subscriptions.size
    },
    shutdown() {
      subscriptions.clear()
    },
  }

  return { pubsub: pubsub as unknown as RedisPubSub, published, subscriptions }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("12.1 — Lobby live manager", () => {
  it("registers and tracks connected clients", async () => {
    const manager = new LobbyLiveManager()
    const ws = createMockSocket()

    await manager.addClient(ws)
    expect(manager.clientCount).toBe(1)

    manager.removeClient(ws)
    expect(manager.clientCount).toBe(0)
  })

  it("broadcasts activity events to all connected clients", async () => {
    const manager = new LobbyLiveManager()
    const ws1 = createMockSocket()
    const ws2 = createMockSocket()
    await manager.addClient(ws1)
    await manager.addClient(ws2)

    const event: LobbyEvent = {
      type: "death",
      characterName: "Knight",
      characterClass: "knight",
      detail: "Killed",
      timestamp: Date.now(),
    }
    manager.broadcastActivity(event)

    expect(ws1.sent).toHaveLength(1)
    expect(ws2.sent).toHaveLength(1)
    const parsed = JSON.parse(ws1.sent[0]!)
    expect(parsed).toEqual({ type: "lobby_activity", data: event })
  })

  it("broadcasts chat messages to all connected clients", async () => {
    const manager = new LobbyLiveManager()
    const ws = createMockSocket()
    await manager.addClient(ws)

    const chatMsg: SanitizedChatMessage = {
      character_name: "Mage",
      character_class: "mage",
      player_type: "human",
      message: "Hello!",
      timestamp: Date.now(),
    }
    manager.broadcastChat(chatMsg)

    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: "lobby_chat", data: chatMsg })
  })

  it("broadcasts leaderboard deltas to all connected clients", async () => {
    const manager = new LobbyLiveManager()
    const ws = createMockSocket()
    await manager.addClient(ws)

    const delta: LeaderboardDelta = {
      characterId: "char-1",
      xp: 500,
      level: 5,
      deepestFloor: 3,
    }
    manager.broadcastLeaderboardDelta(delta)

    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: "leaderboard_update", data: delta })
  })

  it("does not send to removed clients", async () => {
    const manager = new LobbyLiveManager()
    const ws = createMockSocket()
    await manager.addClient(ws)
    manager.removeClient(ws)

    manager.broadcastActivity({
      type: "death",
      characterName: "A",
      characterClass: "rogue",
      detail: "d",
      timestamp: 0,
    })

    expect(ws.sent).toHaveLength(0)
  })

  it("connects to Redis pub/sub and relays messages from other instances", async () => {
    const { pubsub, subscriptions } = createFakePubSub()
    const manager = new LobbyLiveManager()
    const ws = createMockSocket()
    await manager.addClient(ws)

    manager.connectPubSub(pubsub)

    expect(subscriptions.has(CHANNELS.LOBBY_CHAT)).toBe(true)
    expect(subscriptions.has(CHANNELS.LOBBY_ACTIVITY)).toBe(true)
    expect(subscriptions.has(CHANNELS.LEADERBOARD_UPDATES)).toBe(true)

    // Simulate message arriving via Redis (from another instance)
    const event: LobbyEvent = {
      type: "boss_kill",
      characterName: "Arrow",
      characterClass: "archer",
      detail: "Defeated the Lich",
      timestamp: Date.now(),
    }
    const handlers = subscriptions.get(CHANNELS.LOBBY_ACTIVITY)!
    for (const handler of handlers) handler(JSON.stringify(event))

    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: "lobby_activity", data: event })
  })

  it("handles chat rate limiting by character", () => {
    const manager = new LobbyLiveManager()
    const rateLimitMs = 100

    const allowed1 = manager.checkChatRateLimit("char-1", rateLimitMs)
    expect(allowed1).toBe(true)

    const allowed2 = manager.checkChatRateLimit("char-1", rateLimitMs)
    expect(allowed2).toBe(false)

    // Different character is not rate limited
    const allowed3 = manager.checkChatRateLimit("char-2", rateLimitMs)
    expect(allowed3).toBe(true)
  })
})
