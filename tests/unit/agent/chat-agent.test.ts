import { describe, expect, it } from "bun:test"
import { BaseAgent } from "../../../src/agent.js"
import { createDefaultConfig } from "../../../src/config.js"
import type { ChatManagerEvents } from "../../../src/chat/index.js"
import type { DecisionPrompt, DecisionResult, LLMAdapter } from "../../../src/adapters/llm/index.js"
import type { LobbyEvent, Observation, SanitizedChatMessage } from "../../../src/protocol.js"
import { buildObservation } from "../../helpers/mock-observation.js"

type ChatEventName = keyof ChatManagerEvents

class MockGameClient {
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

const walletAdapter = {
  getAddress: async () => "0x0",
  signMessage: async () => "sig",
  signTransaction: async () => "tx",
  getNetwork: () => "base" as const,
}

function createLLMAdapter(
  chatImpl?: (prompt: Parameters<NonNullable<LLMAdapter["chat"]>>[0]) => Promise<string>,
): LLMAdapter {
  return {
    name: "test",
    decide: async (_prompt: DecisionPrompt): Promise<DecisionResult> => ({
      action: { type: "wait" },
      reasoning: "wait",
    }),
    ...(chatImpl ? { chat: chatImpl } : {}),
  }
}

describe("BaseAgent chat lifecycle", () => {
  it("does not start chat when chat is disabled", async () => {
    const agent = new BaseAgent(
      createDefaultConfig({
        llm: { provider: "openrouter", apiKey: "test-key" },
        wallet: { type: "env" },
      }),
      {
        llmAdapter: createLLMAdapter(),
        walletAdapter,
      },
    )
    const client = new MockGameClient()

    const chatManager = await agent.startChat(client as never)

    expect(chatManager).toBeNull()
    expect(client.connectLobbyCalls).toBe(0)
  })

  it("connects chat and forwards extraction events into banter generation", async () => {
    const client = new MockGameClient()
    const agent = new BaseAgent(
      createDefaultConfig({
        characterName: "Scout",
        characterClass: "rogue",
        llm: { provider: "openrouter", apiKey: "test-key" },
        wallet: { type: "env" },
        chat: {
          enabled: true,
          triggers: ["own_extraction"],
          personality: {
            name: "Scout",
            traits: ["witty"],
          },
        },
      }),
      {
        llmAdapter: createLLMAdapter(async () => "Easy work."),
        walletAdapter,
      },
    )

    await agent.processObservation(buildObservation() as Observation)
    await agent.startChat(client as never)
    await agent.handleExtraction({
      loot_summary: [],
      xp_gained: 25,
      gold_gained: 10,
      realm_completed: true,
    })

    expect(client.connectLobbyCalls).toBe(1)
    expect(client.requests).toHaveLength(1)
    expect(client.requests[0]?.path).toBe("/lobby/chat")
  })

  it("stops chat cleanly and disconnects the lobby socket", async () => {
    const client = new MockGameClient()
    const agent = new BaseAgent(
      createDefaultConfig({
        characterName: "Scout",
        llm: { provider: "openrouter", apiKey: "test-key" },
        wallet: { type: "env" },
        chat: {
          enabled: true,
          personality: {
            name: "Scout",
            traits: ["quiet"],
          },
        },
      }),
      {
        llmAdapter: createLLMAdapter(async () => "Acknowledged."),
        walletAdapter,
      },
    )

    await agent.startChat(client as never)
    agent.stop()

    expect(client.disconnectLobbyCalls).toBe(1)
  })
})
