import { describe, expect, it } from "bun:test"
import { ChatManager, type ChatManagerEvents } from "../../../src/chat/index.js"
import type { LobbyEvent, SanitizedChatMessage } from "../../../src/protocol.js"

type ChatEventName = keyof ChatManagerEvents

class MockChatClient {
  connectLobbyCalls = 0
  disconnectLobbyCalls = 0
  requests: Array<{ path: string; options: RequestInit }> = []
  private listeners = new Map<ChatEventName, Set<(payload: unknown) => void>>()

  async connectLobby(): Promise<void> {
    this.connectLobbyCalls += 1
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    this.requests.push({ path, options })
    return { ok: true } as T
  }

  disconnectLobby(): void {
    this.disconnectLobbyCalls += 1
  }

  on<K extends ChatEventName>(event: K, handler: (payload: ChatManagerEvents[K]) => void): void {
    const handlers = this.listeners.get(event) ?? new Set<(payload: unknown) => void>()
    handlers.add(handler as (payload: unknown) => void)
    this.listeners.set(event, handlers)
  }

  off<K extends ChatEventName>(event: K, handler: (payload: ChatManagerEvents[K]) => void): void {
    this.listeners.get(event)?.delete(handler as (payload: unknown) => void)
  }

  emit<K extends ChatEventName>(event: K, payload: ChatManagerEvents[K]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(payload)
    }
  }
}

function buildChatMessage(
  overrides: Partial<SanitizedChatMessage> = {},
): SanitizedChatMessage {
  return {
    character_name: "Ally",
    character_class: "rogue",
    player_type: "human",
    message: "Scout, watch your flank.",
    timestamp: 1,
    ...overrides,
  }
}

function buildLobbyEvent(overrides: Partial<LobbyEvent> = {}): LobbyEvent {
  return {
    type: "death",
    characterName: "Ally",
    characterClass: "rogue",
    detail: "A goblin got the last hit.",
    timestamp: 2,
    ...overrides,
  }
}

describe("ChatManager", () => {
  it("connects to the lobby, deduplicates messages, and filters its own chat", async () => {
    const client = new MockChatClient()
    const manager = new ChatManager(
      client,
      { enabled: true, maxHistoryLength: 2 },
      undefined,
      { selfCharacterName: "Scout" },
    )
    const seenMessages: SanitizedChatMessage[] = []
    const seenEvents: LobbyEvent[] = []

    manager.on("chatMessage", (message) => {
      seenMessages.push(message)
    })
    manager.on("lobbyEvent", (event) => {
      seenEvents.push(event)
    })

    await manager.connect()

    const inbound = buildChatMessage()
    client.emit("chatMessage", inbound)
    client.emit("chatMessage", inbound)
    client.emit(
      "chatMessage",
      buildChatMessage({
        character_name: "Scout",
        message: "I sent this one.",
        timestamp: 3,
      }),
    )
    client.emit("lobbyEvent", buildLobbyEvent())

    expect(client.connectLobbyCalls).toBe(1)
    expect(seenMessages).toEqual([inbound])
    expect(manager.getRecentMessages()).toEqual([inbound])
    expect(seenEvents).toHaveLength(1)
  })

  it("sends chat over HTTP and enforces client-side rate limiting", async () => {
    let now = 10_000
    const client = new MockChatClient()
    const manager = new ChatManager(
      client,
      { enabled: true },
      undefined,
      {
        now: () => now,
        minSendIntervalMs: 5_000,
      },
    )

    await manager.sendMessage("  hello   lobby  ")

    expect(client.requests).toHaveLength(1)
    expect(client.requests[0]?.path).toBe("/lobby/chat")
    expect(client.requests[0]?.options.method).toBe("POST")
    expect(client.requests[0]?.options.body).toBe(JSON.stringify({ message: "hello lobby" }))

    await expect(manager.sendMessage("too soon")).rejects.toThrow(
      "Chat message rate limited by SDK client",
    )

    now += 5_000
    await expect(manager.sendMessage("back again")).resolves.toBeUndefined()
  })

  it("disconnects the lobby socket and unregisters listeners", async () => {
    const client = new MockChatClient()
    const manager = new ChatManager(client, { enabled: true })

    await manager.connect()
    manager.disconnect()

    client.emit("chatMessage", buildChatMessage())

    expect(client.disconnectLobbyCalls).toBe(1)
    expect(manager.getRecentMessages()).toHaveLength(0)
    expect(manager.isConnected).toBe(false)
  })
})
