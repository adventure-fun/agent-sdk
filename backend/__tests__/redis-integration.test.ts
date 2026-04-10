import { describe, expect, it, beforeEach } from "bun:test"
import type {
  LobbyEvent,
  SanitizedChatMessage,
  LeaderboardDelta,
  Observation,
} from "@adventure-fun/schemas"
import { RedisPubSub, CHANNELS } from "../src/redis/pubsub.js"
import {
  publishSpectatorUpdate,
  publishLobbyActivity,
  publishLeaderboardDelta,
  publishChatMessage,
  validateChatMessage,
} from "../src/redis/publishers.js"

// ── Mock helpers ──────────────────────────────────────────────────────────────

function createMockPubSub() {
  const published: Array<{ channel: string; message: string }> = []
  const subscriptions = new Map<string, Set<(msg: string) => void>>()

  const pubsub: RedisPubSub = {
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
  } as unknown as RedisPubSub

  return { pubsub, published, subscriptions }
}

function createMinimalObservation(): Observation {
  return {
    turn: 5,
    character: {
      id: "char-1",
      class: "rogue",
      level: 3,
      xp: 200,
      xp_to_next_level: 100,
      skill_points: 0,
      hp: { current: 15, max: 25 },
      resource: { type: "energy", current: 8, max: 12 },
      buffs: [],
      debuffs: [],
      cooldowns: {},
      abilities: [],
      base_stats: { hp: 25, attack: 8, defense: 5, accuracy: 10, evasion: 12, speed: 11 },
      effective_stats: { hp: 25, attack: 8, defense: 5, accuracy: 10, evasion: 12, speed: 11 },
      skill_tree: {},
    },
    inventory: [],
    equipment: { weapon: null, armor: null, helm: null, hands: null, accessory: null },
    gold: 50,
    position: { floor: 1, room_id: "room-1", tile: { x: 2, y: 3 } },
    visible_tiles: [],
    visible_entities: [],
    recent_events: [],
    room_text: "A dark corridor.",
    legal_actions: [],
    known_map: {
      total_floors: 2,
      current_floor: 1,
      discovered_tiles: [],
      rooms_visited: [],
    },
    realm_info: {
      template_id: "sunken-crypt",
      template_name: "Sunken Crypt",
      current_floor: 1,
      total_floors: 2,
      status: "active",
    },
  } as unknown as Observation
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("12.1 — Spectator Redis broadcast", () => {
  it("publishes spectator observations to the correct channel", async () => {
    const { pubsub, published } = createMockPubSub()
    const obs = createMinimalObservation()

    await publishSpectatorUpdate(pubsub, "char-1", obs)

    expect(published).toHaveLength(1)
    expect(published[0]!.channel).toBe("spectator:char-1")

    const parsed = JSON.parse(published[0]!.message)
    expect(parsed.type).toBe("spectator_observation")
    expect(parsed.characterId).toBe("char-1")
    expect(parsed.data.turn).toBe(5)
  })

  it("subscribers on spectator channel receive turn updates", async () => {
    const { pubsub } = createMockPubSub()
    const obs = createMinimalObservation()

    const received: string[] = []
    await pubsub.subscribe(CHANNELS.spectator("char-1"), (msg) => received.push(msg))

    await publishSpectatorUpdate(pubsub, "char-1", obs)

    expect(received).toHaveLength(1)
    const parsed = JSON.parse(received[0]!)
    expect(parsed.type).toBe("spectator_observation")
  })
})

describe("12.1 — Lobby activity events", () => {
  it("publishes notable events to lobby:activity", async () => {
    const { pubsub, published } = createMockPubSub()
    const event: LobbyEvent = {
      type: "death",
      characterName: "Sir Brave",
      characterClass: "knight",
      detail: "Slain by the Crypt Boss",
      timestamp: 1712700000000,
    }

    await publishLobbyActivity(pubsub, event)

    expect(published).toHaveLength(1)
    expect(published[0]!.channel).toBe("lobby:activity")
    const parsed = JSON.parse(published[0]!.message) as LobbyEvent
    expect(parsed.type).toBe("death")
    expect(parsed.characterName).toBe("Sir Brave")
  })

  it("publishes multiple notable events in sequence", async () => {
    const { pubsub, published } = createMockPubSub()

    await publishLobbyActivity(pubsub, {
      type: "boss_kill",
      characterName: "Shadow",
      characterClass: "rogue",
      detail: "Defeated the Lich",
      timestamp: Date.now(),
    })
    await publishLobbyActivity(pubsub, {
      type: "extraction",
      characterName: "Arrow",
      characterClass: "archer",
      detail: "Extracted with 300 gold",
      timestamp: Date.now(),
    })

    expect(published).toHaveLength(2)
    expect(published.map((p) => JSON.parse(p.message).type)).toEqual([
      "boss_kill",
      "extraction",
    ])
  })
})

describe("12.1 — Leaderboard deltas", () => {
  it("publishes leaderboard delta to leaderboard:updates", async () => {
    const { pubsub, published } = createMockPubSub()
    const delta: LeaderboardDelta = {
      characterId: "char-42",
      xp: 1500,
      level: 8,
      deepestFloor: 4,
    }

    await publishLeaderboardDelta(pubsub, delta)

    expect(published).toHaveLength(1)
    expect(published[0]!.channel).toBe("leaderboard:updates")
    const parsed = JSON.parse(published[0]!.message) as LeaderboardDelta
    expect(parsed.characterId).toBe("char-42")
    expect(parsed.xp).toBe(1500)
  })
})

describe("12.1 — Chat message validation and publishing", () => {
  it("validates a well-formed chat message", () => {
    const result = validateChatMessage("Hello, adventurers!")
    expect(result.valid).toBe(true)
    expect(result.sanitized).toBe("Hello, adventurers!")
  })

  it("rejects an empty message", () => {
    const result = validateChatMessage("")
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it("rejects a message that is too long", () => {
    const result = validateChatMessage("x".repeat(501))
    expect(result.valid).toBe(false)
    expect(result.error).toContain("too long")
  })

  it("trims whitespace from messages", () => {
    const result = validateChatMessage("  hello  ")
    expect(result.valid).toBe(true)
    expect(result.sanitized).toBe("hello")
  })

  it("rejects whitespace-only messages", () => {
    const result = validateChatMessage("   ")
    expect(result.valid).toBe(false)
  })

  it("publishes a sanitized chat message to lobby:chat", async () => {
    const { pubsub, published } = createMockPubSub()
    const chatMsg: SanitizedChatMessage = {
      character_name: "Arrow",
      character_class: "archer",
      player_type: "human",
      message: "Anyone want to team up?",
      timestamp: Date.now(),
    }

    await publishChatMessage(pubsub, chatMsg)

    expect(published).toHaveLength(1)
    expect(published[0]!.channel).toBe("lobby:chat")
    const parsed = JSON.parse(published[0]!.message) as SanitizedChatMessage
    expect(parsed.character_name).toBe("Arrow")
    expect(parsed.message).toBe("Anyone want to team up?")
  })
})
