import { describe, expect, it } from "bun:test"
import {
  authenticate,
  createDefaultConfig,
  createWalletAdapter,
  createX402Client,
  GameClient,
  BaseAgent,
  createModuleRegistry,
  createAgentContext,
  createMapMemory,
  CombatModule,
  ExplorationModule,
  InventoryModule,
  TrapHandlingModule,
  PortalModule,
  HealingModule,
  type AgentConfig,
  type AgentModule,
  type ModuleRecommendation,
  type AgentContext,
  type MapMemory,
  type ModuleRegistry,
  type LLMAdapter,
  type DecisionPrompt,
  type DecisionResult,
  type Direction,
  createLLMAdapter,
  buildSystemPrompt,
  OpenAIAdapter,
  OpenRouterAdapter,
  AnthropicAdapter,
  EvmEnvWalletAdapter,
  OpenWalletAdapter,
  ChatManager,
  BanterEngine,
} from "./index.js"

describe("agent-sdk public exports", () => {
  it("exposes the authentication helper", () => {
    expect(typeof authenticate).toBe("function")
  })

  it("constructs a game client from the package entrypoint", () => {
    const client = new GameClient(
      "https://example.com",
      "wss://example.com",
      {
        token: "session-token",
        expires_at: Date.now() + 60_000,
      },
    )

    expect(client.sessionToken).toBe("session-token")
  })

  it("creates a default agent config with override support", () => {
    const config = createDefaultConfig({
      apiUrl: "https://example.com",
      llm: {
        provider: "openai",
        apiKey: "test-key",
      },
      wallet: {
        type: "env",
      },
    })

    expect(config.apiUrl).toBe("https://example.com")
    expect(config.wsUrl).toBe("ws://localhost:3001")
    expect(config.llm.provider).toBe("openai")
    expect(config.wallet.type).toBe("env")
  })

  it("exposes typed protocol and event APIs", () => {
    const client = new GameClient(
      "https://example.com",
      "wss://example.com",
      {
        token: "session-token",
        expires_at: Date.now() + 60_000,
      },
      {
        reconnect: {
          maxRetries: 5,
          backoffMs: 250,
        },
      },
    )

    const observationHandler = () => {}
    client.on("observation", observationHandler)
    client.off("observation", observationHandler)

    const direction: Direction = "up"
    const config: AgentConfig = createDefaultConfig({
      llm: { provider: "anthropic", apiKey: "another-key" },
      wallet: { type: "open-wallet", endpoint: "https://wallet.example.com" },
    })

    expect(direction).toBe("up")
    expect(config.llm.provider).toBe("anthropic")
  })

  it("exposes module system from Phase 2", () => {
    expect(typeof createModuleRegistry).toBe("function")
    expect(typeof createAgentContext).toBe("function")
    expect(typeof createMapMemory).toBe("function")

    const combat = new CombatModule()
    expect(combat.name).toBe("combat")

    const exploration = new ExplorationModule()
    expect(exploration.name).toBe("exploration")

    const inventory = new InventoryModule()
    expect(inventory.name).toBe("inventory")

    const trapHandling = new TrapHandlingModule()
    expect(trapHandling.name).toBe("trap-handling")

    const portal = new PortalModule()
    expect(portal.name).toBe("portal")

    const healing = new HealingModule()
    expect(healing.name).toBe("healing")
  })

  it("exposes BaseAgent and LLM adapter types from Phase 2", () => {
    expect(BaseAgent).toBeDefined()

    const mockLLM: LLMAdapter = {
      name: "test",
      decide: async (prompt: DecisionPrompt): Promise<DecisionResult> => ({
        action: { type: "wait" },
        reasoning: "test",
      }),
    }

    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    })

    const agent = new BaseAgent(config, {
      llmAdapter: mockLLM,
      walletAdapter: {
        getAddress: async () => "0x0",
        signMessage: async () => "sig",
        signTransaction: async () => "tx",
        getNetwork: () => "base",
      },
    })

    expect(agent.context.turn).toBe(0)
  })

  it("exposes Phase 3 adapter factory and provider classes", () => {
    const openAI = createLLMAdapter({
      provider: "openai",
      apiKey: "test-key",
      structuredOutput: "tool",
    })
    const openRouter = createLLMAdapter({
      provider: "openrouter",
      apiKey: "test-key",
      structuredOutput: "json",
    })
    const anthropic = createLLMAdapter({
      provider: "anthropic",
      apiKey: "test-key",
      structuredOutput: "tool",
    })

    expect(openAI).toBeInstanceOf(OpenAIAdapter)
    expect(openRouter).toBeInstanceOf(OpenRouterAdapter)
    expect(anthropic).toBeInstanceOf(AnthropicAdapter)
  })

  it("exposes shared prompt helpers from the package entrypoint", () => {
    const prompt = buildSystemPrompt(
      createDefaultConfig({
        characterName: "Scout",
        llm: { provider: "openrouter", apiKey: "test-key" },
        wallet: { type: "env" },
      }),
    )

    expect(prompt).toContain("Scout")
    expect(prompt).toContain("choose_action")
  })

  it("exposes wallet factories and adapters from the package entrypoint", async () => {
    const envWallet = await createWalletAdapter({
      type: "env",
      network: "base",
      privateKey: "0x59c6995e998f97a5a0044976f7d9f7ea3a4b64c9d8d0f9ac1c9c1a40add3521e",
    })
    const openWallet = await createWalletAdapter({
      type: "open-wallet",
      endpoint: "https://wallet.example.com",
      network: "base",
    })

    expect(envWallet).toBeInstanceOf(EvmEnvWalletAdapter)
    expect(openWallet).toBeInstanceOf(OpenWalletAdapter)
    await expect(createX402Client(envWallet)).resolves.toBeDefined()
  })

  it("exposes chat primitives from the package entrypoint", () => {
    expect(ChatManager).toBeDefined()
    expect(BanterEngine).toBeDefined()

    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
      chat: {
        enabled: true,
        personality: {
          name: "Scout",
          traits: ["witty"],
          responseStyle: "brief",
        },
      },
    })

    expect(config.chat?.personality?.responseStyle).toBe("brief")
  })
})
