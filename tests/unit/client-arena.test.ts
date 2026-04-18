import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { GameClient, type ArenaSessionHandlers } from "../../src/client.js"
import type { ArenaObservation, ArenaServerMessage } from "../../src/protocol.js"

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static autoOpen = false
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  url: string
  protocols?: string | string[]
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  sent: string[] = []
  readyState = 0
  CONNECTING = 0
  OPEN = 1
  CLOSING = 2
  CLOSED = 3

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    MockWebSocket.instances.push(this)
    if (MockWebSocket.autoOpen) {
      queueMicrotask(() => this.fireOpen())
    }
  }

  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.readyState = 3
    queueMicrotask(() => this.fireClose(1000, "client closed"))
  }
  fireOpen(): void {
    this.readyState = 1
    this.onopen?.(new Event("open"))
  }
  fireClose(code: number, reason: string): void {
    this.readyState = 3
    const event = { code, reason, wasClean: false } as unknown as CloseEvent
    this.onclose?.(event)
  }
  fireMessage(message: ArenaServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent)
  }
}

const ORIGINAL_WS = globalThis.WebSocket
const ORIGINAL_FETCH = globalThis.fetch

function installMocks(): void {
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
  // Stub /auth/ws-ticket → 404 so openArenaSocket uses the subprotocol path.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })) as typeof globalThis.fetch
}

function makeClient(): GameClient {
  return new GameClient(
    "https://api.example.com",
    "wss://api.example.com",
    { token: "session-token", expires_at: Date.now() + 60_000 },
  )
}

function observationMsg(matchId: string, turn: number): ArenaServerMessage {
  const observation = {
    match_id: matchId,
    round: 1,
    turn,
    phase: "grace",
    map_id: "arena-pit",
    grid: [],
    entities: [],
    you: {
      id: "you",
      kind: "player",
      name: "Alice",
      position: { x: 7, y: 7 },
      hp: { current: 100, max: 100 },
      stats: { hp: 100, attack: 12, defense: 5, accuracy: 13, evasion: 14, speed: 15 },
      effective_stats: { hp: 100, attack: 12, defense: 5, accuracy: 13, evasion: 14, speed: 15 },
      active_effects: [],
      abilities: [],
      cooldowns: {},
      alive: true,
    },
    turn_order: ["you"],
    next_wave_turn: null,
    proximity_warnings: [],
    recent_events: [],
    legal_actions: [{ type: "wait" }],
    death_drops: [],
  } as unknown as ArenaObservation
  return { type: "observation", data: observation }
}

describe("GameClient arena WebSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    MockWebSocket.autoOpen = true
    installMocks()
  })

  afterEach(() => {
    globalThis.WebSocket = ORIGINAL_WS
    globalThis.fetch = ORIGINAL_FETCH
  })

  it("opens the arena WS at /arena/match/:id/play and resolves connectArenaMatch", async () => {
    const client = makeClient()
    const handlers: ArenaSessionHandlers = {}
    await client.connectArenaMatch("match-42", handlers)

    expect(MockWebSocket.instances).toHaveLength(1)
    const ws = MockWebSocket.instances[0]!
    expect(ws.url).toContain("/arena/match/match-42/play")
    expect(ws.protocols).toEqual(["Bearer", "session-token"])
  })

  it("routes arena server messages to their handlers", async () => {
    const client = makeClient()
    const obs: ArenaObservation[] = []
    const turns: Array<{ entity_id: string; timeout_ms: number }> = []
    const deaths: unknown[] = []
    const ends: unknown[] = []
    const errors: unknown[] = []

    await client.connectArenaMatch("match-1", {
      onObservation: (o) => obs.push(o),
      onYourTurn: (d) => turns.push(d),
      onArenaDeath: (d) => deaths.push(d),
      onArenaMatchEnd: (d) => ends.push(d),
      onError: (e) => errors.push(e),
    })

    const ws = MockWebSocket.instances[0]!
    ws.fireMessage(observationMsg("match-1", 5))
    ws.fireMessage({ type: "your_turn", data: { entity_id: "you", timeout_ms: 10_000 } })
    ws.fireMessage({
      type: "arena_death",
      data: { entity_id: "bob", killer_entity_id: "you", turn: 6, round: 1 },
    })
    ws.fireMessage({ type: "error", message: "out of bounds" })
    ws.fireMessage({
      type: "arena_match_end",
      data: { match_id: "match-1", reason: "last_standing", result: null },
    })

    expect(obs).toHaveLength(1)
    expect(obs[0]!.turn).toBe(5)
    expect(turns).toEqual([{ entity_id: "you", timeout_ms: 10_000 }])
    expect(deaths).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(errors).toHaveLength(1)
  })

  it("sendArenaAction writes a typed ArenaClientMessage onto the open socket", async () => {
    const client = makeClient()
    await client.connectArenaMatch("match-99")

    client.sendArenaAction({ type: "move", direction: "up" })

    const ws = MockWebSocket.instances[0]!
    expect(ws.sent).toHaveLength(1)
    const sent = JSON.parse(ws.sent[0]!)
    expect(sent).toEqual({ type: "action", data: { type: "move", direction: "up" } })
  })

  it("sendArenaAction throws when the arena socket is not connected", () => {
    const client = makeClient()
    expect(() => client.sendArenaAction({ type: "wait" })).toThrow("Arena WebSocket not connected")
  })

  it("disconnectArena closes the active arena socket and clears state", async () => {
    const client = makeClient()
    const closes: unknown[] = []
    await client.connectArenaMatch("match-end", {
      onClose: (event) => closes.push(event),
    })

    client.disconnectArena()
    await new Promise((r) => setTimeout(r, 5))

    expect(closes).toHaveLength(1)
    expect(() => client.sendArenaAction({ type: "wait" })).toThrow()
  })
})
