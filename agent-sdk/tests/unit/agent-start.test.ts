import { describe, expect, it } from "bun:test"
import { BaseAgent, type BaseAgentOptions } from "../../src/agent.js"
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
}

function createConfig(
  overrides: Partial<AgentConfig> = {},
  decisionOverrides: Partial<NonNullable<AgentConfig["decision"]>> = {},
): AgentConfig {
  return createDefaultConfig({
    characterClass: "rogue",
    characterName: "Scout",
    realmTemplateId: "test-tutorial",
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
  tacticalLLMAdapter?: LLMAdapter
} = {}) {
  const config = options.config ?? createConfig()
  const llmAdapter = createLLM("strategic")
  const walletAdapter = createWallet()
  const client = new FakeGameClient(
    options.responses ??
      new Map<string, () => unknown | Promise<unknown>>([
        ["/characters/me", () => ({ id: "char-1", name: "Scout" })],
        ["/realms/mine", () => ({ realms: [] })],
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
      ["/realms/mine", () => ({ realms: [] })],
      ["/realms/generate", () => ({ id: "realm-1", template_id: "test-tutorial" })],
    ])
    const harness = createHarness({ responses })

    const startPromise = harness.agent.start()
    await flushAsyncWork()

    expect(harness.client.requests.map((entry) => entry.path)).toEqual([
      "/characters/me",
      "/characters/roll",
      "/realms/mine",
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
      "/realms/mine",
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
})
