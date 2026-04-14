import { describe, expect, it } from "bun:test"
import { BaseAgent, type BaseAgentOptions } from "../../src/agent.js"
import type { CharacterNameProvider } from "../../src/character-name-provider.js"
import type { PlannerDecision } from "../../src/planner.js"
import { createDefaultConfig, type AgentConfig } from "../../src/config.js"
import type {
  DecisionPrompt,
  DecisionResult,
  LLMAdapter,
} from "../../src/adapters/llm/index.js"
import type { SessionToken } from "../../src/auth.js"
import { buildObservation, moveAction, waitAction } from "../helpers/mock-observation.js"

type StartPayload = Parameters<BaseAgent["handleExtraction"]>[0]
type DeathPayload = Parameters<BaseAgent["handleDeath"]>[0]

interface FakeClientHandlers {
  onObservation?: (observation: ReturnType<typeof buildObservation>) => void | Promise<void>
  onDeath?: (payload: DeathPayload) => void
  onExtracted?: (payload: StartPayload) => void | Promise<void>
  onError?: (error: Error) => void
  onClose?: (event: { code: number; reason: string; intentional: boolean; scope: "game" | "lobby" }) => void
}

class FakeGameClient {
  requests: Array<{ path: string; options?: RequestInit }> = []
  sentActions: unknown[] = []
  connectRealmIds: string[] = []
  disconnectCount = 0
  handlers: FakeClientHandlers = {}

  constructor(
    private readonly responses: Map<string, () => unknown | Promise<unknown>>,
  ) {}

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    this.requests.push({ path, options })
    if (path === "/content/items") {
      return { items: [] } as T
    }
    if (path === "/lobby/shops") {
      return { sections: [], featured: [] } as T
    }
    if (path === "/lobby/shop/inventory") {
      const responder = this.responses.get(path)
      if (responder) {
        return (await responder()) as T
      }
      return { gold: 0, inventory: [] } as T
    }
    const responder = this.responses.get(path)
    if (!responder) {
      throw new Error(`No fake response configured for ${path}`)
    }
    return (await responder()) as T
  }

  async connect(realmId: string, handlers: FakeClientHandlers): Promise<void> {
    this.connectRealmIds.push(realmId)
    this.handlers = handlers
  }

  sendAction(action: unknown): void {
    this.sentActions.push(action)
  }

  disconnect(): void {
    this.disconnectCount += 1
  }

  disconnectLobby(): void {}

  on(): void {}

  off(): void {}

  async connectLobby(): Promise<void> {}

  async getCurrentCharacter() {
    return this.request("/characters/me")
  }

  async getLobbyInventory() {
    return this.request("/lobby/shop/inventory")
  }

  async getLobbyShops() {
    return this.request("/lobby/shops")
  }

  async getMyRealms() {
    return this.request("/realms/mine")
  }

  async getRealmTemplates() {
    return this.request("/content/realms")
  }

  async getItemTemplates() {
    return this.request("/content/items")
  }

  async buyShopItem(input: { itemId: string; quantity?: number }) {
    return this.request("/lobby/shop/buy", {
      method: "POST",
      body: JSON.stringify({ item_id: input.itemId, quantity: input.quantity ?? 1 }),
    })
  }

  async sellShopItem(input: { itemId: string; quantity?: number }) {
    return this.request("/lobby/shop/sell", {
      method: "POST",
      body: JSON.stringify({ item_id: input.itemId, quantity: input.quantity ?? 1 }),
    })
  }

  async discardLobbyItem(itemId: string) {
    return this.request("/lobby/discard", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
  }

  async equipLobbyItem(itemId: string) {
    return this.request("/lobby/equip", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
  }

  async unequipLobbySlot(slot: string) {
    return this.request("/lobby/unequip", {
      method: "POST",
      body: JSON.stringify({ slot }),
    })
  }

  async useLobbyConsumable(itemId: string) {
    return this.request("/lobby/use-consumable", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
  }

  async restAtInn() {
    return this.request("/lobby/inn/rest", { method: "POST" })
  }
}

function createConfig(
  overrides: Partial<AgentConfig> = {},
  decisionOverrides: Partial<NonNullable<AgentConfig["decision"]>> = {},
): AgentConfig {
  return createDefaultConfig({
    characterClass: "rogue",
    characterName: "Scout",
    realmTemplateId: "test-tutorial",
    realmProgression: {
      strategy: "auto",
      continueOnExtraction: false,
    },
    llm: { provider: "openai", apiKey: "test-key", model: "gpt-4o-mini" },
    wallet: { type: "env" },
    ...overrides,
    decision: decisionOverrides,
  })
}

function createLLM(name = "llm"): LLMAdapter {
  return {
    name,
    async decide(_prompt: DecisionPrompt): Promise<DecisionResult> {
      return {
        action: waitAction(),
        reasoning: `${name} decide`,
      }
    },
  }
}

function createWallet() {
  return {
    async getAddress() {
      return "0xabc"
    },
    async signMessage() {
      return "sig"
    },
    async signTransaction() {
      return "tx"
    },
    getNetwork() {
      return "base" as const
    },
  }
}

function createExtractionPayload(): StartPayload {
  return {
    loot_summary: [],
    xp_gained: 10,
    gold_gained: 5,
    realm_completed: false,
  }
}

async function flushAsyncWork(turns = 5): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function createHarness(options: {
  config?: AgentConfig
  responses?: Map<string, () => unknown | Promise<unknown>>
  authenticateFn?: (baseUrl: string, wallet: ReturnType<typeof createWallet>) => Promise<SessionToken>
  plannerDecision?: PlannerDecision
  plannerFactory?: BaseAgentOptions["plannerFactory"]
  llmAdapter?: LLMAdapter
  tacticalLLMAdapter?: LLMAdapter
  characterNameProvider?: CharacterNameProvider
} = {}) {
  const config = options.config ?? createConfig()
  const llmAdapter = options.llmAdapter ?? createLLM("strategic")
  const walletAdapter = createWallet()
  const client = new FakeGameClient(
    options.responses ??
      new Map<string, () => unknown | Promise<unknown>>([
        ["/characters/me", () => ({ id: "char-1", name: "Scout" })],
        ["/lobby/shop/inventory", () => ({ gold: 0, inventory: [] })],
        ["/lobby/shops", () => ({ sections: [], featured: [] })],
        ["/content/items", () => ({ items: [] })],
        ["/realms/mine", () => ({ realms: [] })],
        ["/content/realms", () => ({ templates: [{ id: "test-tutorial", orderIndex: 1, name: "Tutorial" }] })],
        ["/realms/generate", () => ({ id: "realm-1", template_id: "test-tutorial" })],
      ]),
  )
  const plannerDecision =
    options.plannerDecision ??
    ({
      action: moveAction("right"),
      reasoning: "Advance.",
      tier: "strategic",
      planDepth: 1,
    } satisfies PlannerDecision)
  const plannerCalls: ReturnType<typeof buildObservation>[] = []
  let plannerFactoryArgs: unknown[] = []

  const agent = new BaseAgent(config, {
    llmAdapter,
    tacticalLLMAdapter: options.tacticalLLMAdapter,
    walletAdapter,
    ...(options.characterNameProvider
      ? { characterNameProvider: options.characterNameProvider }
      : {}),
    authenticateFn:
      options.authenticateFn ??
      (async () => ({
        token: "session-token",
        expires_at: Date.now() + 60_000,
      })),
    clientFactory: () => client,
    plannerFactory:
      options.plannerFactory ??
      ((strategic, tactical, registry, decisionConfig) => {
        plannerFactoryArgs = [strategic, tactical, registry, decisionConfig]
        return {
          async decideAction(observation: ReturnType<typeof buildObservation>) {
            plannerCalls.push(observation)
            return plannerDecision
          },
        }
      }),
  })

  return {
    agent,
    client,
    config,
    llmAdapter,
    walletAdapter,
    plannerCalls,
    getPlannerFactoryArgs: () => plannerFactoryArgs,
  }
}

describe("BaseAgent.start", () => {
  it("throws when authentication fails", async () => {
    const harness = createHarness({
      authenticateFn: async () => {
        throw new Error("auth failed")
      },
    })

    await expect(harness.agent.start()).rejects.toThrow("auth failed")
  })

  it("rolls a character when /characters/me returns 404", async () => {
    const responses = new Map<string, () => unknown | Promise<unknown>>([
      ["/characters/me", () => {
        const error = new Error("No living character") as Error & { status?: number }
        error.status = 404
        throw error
      }],
      ["/characters/roll", () => ({ id: "char-1", name: "Scout" })],
      ["/lobby/shop/inventory", () => ({ gold: 0, inventory: [] })],
      ["/lobby/shops", () => ({ sections: [], featured: [] })],
      ["/realms/mine", () => ({ realms: [] })],
      ["/content/realms", () => ({ templates: [{ id: "test-tutorial", orderIndex: 1, name: "Tutorial" }] })],
      ["/realms/generate", () => ({ id: "realm-1", template_id: "test-tutorial" })],
    ])
    const harness = createHarness({ responses })

    const startPromise = harness.agent.start()
    await flushAsyncWork()

    expect(harness.client.requests.map((entry) => entry.path)).toEqual([
      "/characters/me",
      "/characters/roll",
      "/characters/me",
      "/lobby/shop/inventory",
      "/lobby/shops",
      "/content/items",
      "/realms/mine",
      "/content/realms",
      "/realms/generate",
    ])

    harness.client.handlers.onDeath?.({
      cause: "test",
      floor: 1,
      room: "room-1",
      turn: 1,
    })
    await startPromise
  })

  it("skips rolling when a living character already exists", async () => {
    const harness = createHarness()

    const startPromise = harness.agent.start()
    await flushAsyncWork()

    expect(harness.client.requests.map((entry) => entry.path)).toEqual([
      "/characters/me",
      "/characters/me",
      "/lobby/shop/inventory",
      "/lobby/shops",
      "/content/items",
      "/realms/mine",
      "/content/realms",
      "/realms/generate",
    ])

    harness.client.handlers.onDeath?.({
      cause: "test",
      floor: 1,
      room: "room-1",
      turn: 1,
    })
    await startPromise
  })

  it("rests at the inn before the next realm even when lobby planning uses the LLM", async () => {
    let rested = false
    const responses = new Map<string, () => unknown | Promise<unknown>>([
      ["/characters/me", () => ({
        id: "char-1",
        name: "Scout",
        class: "rogue",
        hp_current: rested ? 30 : 12,
        hp_max: 30,
        resource_current: 10,
        resource_max: 10,
      })],
      ["/lobby/shop/inventory", () => ({ gold: 0, inventory: [] })],
      ["/lobby/shops", () => ({ sections: [], featured: [] })],
      ["/content/items", () => ({ items: [] })],
      ["/lobby/inn/rest", () => {
        rested = true
        return {
          hp_current: 30,
          hp_max: 30,
          resource_current: 10,
          resource_max: 10,
          message: "Rested.",
        }
      }],
      ["/realms/mine", () => ({ realms: [] })],
      ["/content/realms", () => ({ templates: [{ id: "test-tutorial", orderIndex: 1, name: "Tutorial" }] })],
      ["/realms/generate", () => ({ id: "realm-1", template_id: "test-tutorial" })],
    ])
    const llmAdapter: LLMAdapter = {
      ...createLLM("strategic"),
      async chat() {
        return '{"actions":[{"action":"done"}]}'
      },
    }
    const harness = createHarness({
      config: createConfig({
        lobby: {
          useLLM: true,
          innHealThreshold: 1,
        },
      }),
      responses,
      llmAdapter,
    })

    const startPromise = harness.agent.start()
    await flushAsyncWork()

    const requestPaths = harness.client.requests.map((entry) => entry.path)
    expect(requestPaths).toContain("/lobby/inn/rest")
    expect(requestPaths.indexOf("/lobby/inn/rest")).toBeLessThan(requestPaths.indexOf("/realms/mine"))

    harness.client.handlers.onDeath?.({
      cause: "test",
      floor: 1,
      room: "room-1",
      turn: 1,
    })
    await startPromise
  })

  it("processes observations through the planner and sends actions", async () => {
    const harness = createHarness({
      plannerDecision: {
        action: moveAction("right"),
        reasoning: "Advance.",
        tier: "strategic",
        planDepth: 2,
      },
    })

    const plannerEvents: PlannerDecision[] = []
    harness.agent.on("plannerDecision", (decision) => {
      plannerEvents.push(decision)
    })

    const startPromise = harness.agent.start()
    await flushAsyncWork()

    await harness.client.handlers.onObservation?.(
      buildObservation({
        legal_actions: [moveAction("right"), waitAction()],
      }),
    )

    expect(harness.plannerCalls).toHaveLength(1)
    expect(harness.client.sentActions).toEqual([moveAction("right")])
    expect(plannerEvents[0]?.tier).toBe("strategic")

    harness.client.handlers.onDeath?.({
      cause: "test",
      floor: 1,
      room: "room-1",
      turn: 1,
    })
    await startPromise
  })

  it("resolves start() on extraction and emits extracted", async () => {
    const harness = createHarness()
    const extractedPayloads: StartPayload[] = []
    harness.agent.on("extracted", (payload) => {
      extractedPayloads.push(payload)
    })

    const startPromise = harness.agent.start()
    await flushAsyncWork()

    const payload = createExtractionPayload()
    await harness.client.handlers.onExtracted?.(payload)
    await startPromise

    expect(extractedPayloads).toEqual([payload])
  })

  it("resolves start() when stop() is called and disconnects the client", async () => {
    const harness = createHarness()

    const startPromise = harness.agent.start()
    await flushAsyncWork()

    harness.agent.stop()
    await startPromise

    expect(harness.client.disconnectCount).toBe(1)
  })

  it("passes separate strategic and tactical adapters to the planner when tacticalModel is configured", () => {
    const config = createConfig({}, {
      strategy: "planned",
      tacticalModel: "gpt-4o-mini",
    })
    const tacticalLLMAdapter = createLLM("tactical")
    const harness = createHarness({
      config,
      tacticalLLMAdapter,
    })

    const [strategicAdapter, tacticalAdapter] = harness.getPlannerFactoryArgs()
    expect(strategicAdapter).not.toBe(tacticalAdapter)
    expect(tacticalAdapter).toBe(tacticalLLMAdapter)
  })

  it("uses the characterNameProvider when characterName is unset and persists name + personality", async () => {
    const config = createConfig({
      characterName: undefined,
      chat: { enabled: true },
    })
    const providerCalls: Array<{ attempt: number; previousName?: string }> = []
    const nameProvider: CharacterNameProvider = {
      name: "stub",
      async generate(ctx) {
        providerCalls.push({
          attempt: ctx.attempt,
          ...(ctx.previousName ? { previousName: ctx.previousName } : {}),
        })
        return {
          name: "Vexrin",
          personality: {
            name: "Vexrin",
            traits: ["grim", "clever"],
            backstory: "A rogue of few words.",
            responseStyle: "Clipped and dry.",
          },
        }
      },
    }
    const rollBodies: unknown[] = []
    const responses = new Map<string, () => unknown | Promise<unknown>>([
      [
        "/characters/me",
        () => {
          const error = new Error("No living character") as Error & { status?: number }
          error.status = 404
          throw error
        },
      ],
      [
        "/characters/roll",
        () => ({ id: "char-1", name: "Vexrin", class: "rogue" }),
      ],
      ["/lobby/shop/inventory", () => ({ gold: 0, inventory: [] })],
      ["/lobby/shops", () => ({ sections: [], featured: [] })],
      ["/realms/mine", () => ({ realms: [] })],
      [
        "/content/realms",
        () => ({ templates: [{ id: "test-tutorial", orderIndex: 1, name: "Tutorial" }] }),
      ],
      ["/realms/generate", () => ({ id: "realm-1", template_id: "test-tutorial" })],
    ])
    const harness = createHarness({ config, responses, characterNameProvider: nameProvider })

    harness.client.request = new Proxy(harness.client.request, {
      apply(target, thisArg, args: [string, RequestInit?]) {
        if (args[0] === "/characters/roll" && args[1]?.body) {
          rollBodies.push(JSON.parse(String(args[1].body)))
        }
        return Reflect.apply(target, thisArg, args)
      },
    })

    const startPromise = harness.agent.start()
    await flushAsyncWork()

    expect(providerCalls).toEqual([{ attempt: 0 }])
    expect(rollBodies).toEqual([{ class: "rogue", name: "Vexrin" }])
    expect(harness.config.characterName).toBe("Vexrin")
    expect(harness.config.chat?.personality?.name).toBe("Vexrin")
    expect(harness.config.chat?.personality?.traits).toEqual(["grim", "clever"])
    expect(harness.config.chat?.personality?.backstory).toContain("rogue")

    harness.client.handlers.onDeath?.({
      cause: "test",
      floor: 1,
      room: "room-1",
      turn: 1,
    })
    await startPromise
  })

  it("retries rollNewPlayerCharacter on 500 when the body hints at a name conflict", async () => {
    let attempt = 0
    const responses = new Map<string, () => unknown | Promise<unknown>>([
      [
        "/characters/me",
        () => {
          const error = new Error("No living character") as Error & { status?: number }
          error.status = 404
          throw error
        },
      ],
      [
        "/characters/roll",
        () => {
          attempt += 1
          if (attempt === 1) {
            const error = new Error(
              "Request failed: POST /characters/roll → 500 Internal Server Error — Character name already taken",
            ) as Error & { status?: number; bodyText?: string }
            error.status = 500
            error.bodyText = "Character name already taken"
            throw error
          }
          return { id: "char-1", name: "Scout2", class: "rogue" }
        },
      ],
      ["/lobby/shop/inventory", () => ({ gold: 0, inventory: [] })],
      ["/lobby/shops", () => ({ sections: [], featured: [] })],
      ["/realms/mine", () => ({ realms: [] })],
      [
        "/content/realms",
        () => ({ templates: [{ id: "test-tutorial", orderIndex: 1, name: "Tutorial" }] }),
      ],
      ["/realms/generate", () => ({ id: "realm-1", template_id: "test-tutorial" })],
    ])
    const harness = createHarness({ responses })

    const startPromise = harness.agent.start()
    await flushAsyncWork()

    expect(attempt).toBe(2)
    expect(harness.config.characterName).toBe("Scout2")

    harness.client.handlers.onDeath?.({
      cause: "test",
      floor: 1,
      room: "room-1",
      turn: 1,
    })
    await startPromise
  })

  it("does not retry on 500 without a name-conflict hint", async () => {
    let attempt = 0
    const responses = new Map<string, () => unknown | Promise<unknown>>([
      [
        "/characters/me",
        () => {
          const error = new Error("No living character") as Error & { status?: number }
          error.status = 404
          throw error
        },
      ],
      [
        "/characters/roll",
        () => {
          attempt += 1
          const error = new Error(
            "Request failed: POST /characters/roll → 500 Internal Server Error — database is down",
          ) as Error & { status?: number; bodyText?: string }
          error.status = 500
          error.bodyText = "database is down"
          throw error
        },
      ],
    ])
    const harness = createHarness({ responses })

    await expect(harness.agent.start()).rejects.toThrow(/500/)
    expect(attempt).toBe(1)
  })
})
