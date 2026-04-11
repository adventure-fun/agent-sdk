import {
  createLLMAdapter,
  type DecisionResult,
  type HistoryEntry,
  type LLMAdapter,
} from "./adapters/llm/index.js"
import {
  createX402Client,
  isX402CapableWalletAdapter,
  type WalletAdapter,
} from "./adapters/wallet/index.js"
import { authenticate, type SessionToken } from "./auth.js"
import { BanterEngine, ChatManager } from "./chat/index.js"
import { GameClient, type GameClientError } from "./client.js"
import type { AgentConfig, DecisionConfig } from "./config.js"
import { ActionPlanner, type PlannerDecision } from "./planner.js"
import type { Action, CharacterClass, Observation } from "./protocol.js"
import {
  createAgentContext,
  createModuleRegistry,
  CombatModule,
  ExplorationModule,
  InventoryModule,
  TrapHandlingModule,
  PortalModule,
  HealingModule,
  type AgentContext,
  type AgentModule,
  type ModuleRegistry,
} from "./modules/index.js"

const DEFAULT_MODULES: AgentModule[] = [
  new CombatModule(),
  new ExplorationModule(),
  new InventoryModule(),
  new TrapHandlingModule(),
  new PortalModule(),
  new HealingModule(),
]

const MAX_HISTORY = 50
type ExtractionPayload = {
  loot_summary: Observation["inventory"]
  xp_gained: number
  gold_gained: number
  completion_bonus?: { xp: number; gold: number }
  realm_completed: boolean
}

type DeathPayload = { cause: string; floor: number; room: string; turn: number }

type AgentClient = Pick<
  GameClient,
  | "connect"
  | "connectLobby"
  | "disconnect"
  | "disconnectLobby"
  | "request"
  | "sendAction"
  | "on"
  | "off"
>

interface AgentPlanner {
  decideAction(observation: Observation, context: AgentContext): Promise<PlannerDecision>
}

export interface BaseAgentOptions {
  llmAdapter: LLMAdapter
  tacticalLLMAdapter?: LLMAdapter
  walletAdapter: WalletAdapter
  modules?: AgentModule[]
  authenticateFn?: (baseUrl: string, wallet: WalletAdapter) => Promise<SessionToken>
  clientFactory?: (args: {
    baseUrl: string
    wsUrl: string
    token: SessionToken
    wallet: WalletAdapter
  }) => AgentClient | Promise<AgentClient>
  plannerFactory?: (
    strategicLLM: LLMAdapter,
    tacticalLLM: LLMAdapter,
    registry: ModuleRegistry,
    decision: DecisionConfig,
  ) => AgentPlanner
}

export interface AgentEvents {
  observation: Observation
  action: { action: Action; reasoning: string }
  plannerDecision: PlannerDecision
  death: DeathPayload
  extracted: ExtractionPayload
  error: Error
  disconnected: void
}

type AgentEventName = keyof AgentEvents
type AgentEventHandler<K extends AgentEventName> = (payload: AgentEvents[K]) => void

export class BaseAgent {
  readonly context: AgentContext
  private readonly config: AgentConfig
  private readonly llm: LLMAdapter
  private readonly tacticalLLM: LLMAdapter
  private readonly wallet: WalletAdapter
  private readonly registry: ModuleRegistry
  private readonly planner: AgentPlanner
  private readonly authenticateFn: (baseUrl: string, wallet: WalletAdapter) => Promise<SessionToken>
  private readonly clientFactory: BaseAgentOptions["clientFactory"]
  private readonly history: HistoryEntry[] = []
  private lastObservation: Observation | null = null
  private chatManager: ChatManager | null = null
  private banterEngine: BanterEngine | null = null
  private listeners = new Map<AgentEventName, Set<(payload: unknown) => void>>()
  private clientInstance: AgentClient | null = null
  private runCompletion:
    | {
        resolve: () => void
        reject: (error: Error) => void
      }
    | null = null
  private isRunning = false

  constructor(config: AgentConfig, options: BaseAgentOptions) {
    if (!config.llm.apiKey) {
      throw new Error("LLM API key is required")
    }

    this.config = config
    this.llm = options.llmAdapter
    this.wallet = options.walletAdapter
    this.authenticateFn = options.authenticateFn ?? authenticate
    this.clientFactory = options.clientFactory
    this.context = createAgentContext(config)

    const modules = options.modules ?? DEFAULT_MODULES
    this.registry = createModuleRegistry(modules)
    this.tacticalLLM = this.resolveTacticalLLM(options)
    this.planner =
      options.plannerFactory?.(
        this.llm,
        this.tacticalLLM,
        this.registry,
        this.config.decision ?? { strategy: "planned" },
      ) ??
      new ActionPlanner(
        this.llm,
        this.tacticalLLM,
        this.registry,
        this.config.decision ?? { strategy: "planned" },
      )
  }

  get running(): boolean {
    return this.isRunning
  }

  get client(): AgentClient | null {
    return this.clientInstance
  }

  on<K extends AgentEventName>(event: K, handler: AgentEventHandler<K>): void {
    const handlers = this.listeners.get(event) ?? new Set()
    handlers.add(handler as (payload: unknown) => void)
    this.listeners.set(event, handlers)
  }

  off<K extends AgentEventName>(event: K, handler: AgentEventHandler<K>): void {
    this.listeners.get(event)?.delete(handler as (payload: unknown) => void)
  }

  /**
   * Process a single observation through the full pipeline:
   * 1. Update context
   * 2. Run modules
   * 3. Ask LLM for decision
   * 4. Validate against legal actions
   * 5. Return chosen action
   */
  async processObservation(observation: Observation): Promise<PlannerDecision> {
    this.lastObservation = observation
    this.context.turn = observation.turn
    this.emit("observation", observation)

    const result = await this.planner.decideAction(observation, this.context)

    this.recordAction(observation, result)
    this.emit("plannerDecision", result)
    this.emit("action", { action: result.action, reasoning: result.reasoning })

    return result
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Agent is already running")
    }

    this.isRunning = true

    try {
      const session = await this.authenticateFn(this.config.apiUrl, this.wallet)
      const client = await this.createClient(session)
      this.clientInstance = client

      await this.ensureCharacter(client)
      const realmId = await this.ensureRealm(client)

      const completion = new Promise<void>((resolve, reject) => {
        this.runCompletion = { resolve, reject }
      })

      await client.connect(realmId, {
        onObservation: async (observation) => {
          await this.handleObservation(observation)
        },
        onDeath: (payload) => {
          this.handleDeath(payload)
          this.finishRun()
        },
        onExtracted: async (payload) => {
          await this.handleExtraction(payload)
          this.finishRun()
        },
        onError: (error) => {
          this.emit("error", error)
        },
        onClose: (event) => {
          if (!event.intentional && this.isRunning) {
            this.failRun(new Error(`Game socket closed unexpectedly: ${event.code} ${event.reason}`))
          }
        },
      })

      if (this.config.chat?.enabled) {
        await this.startChat(client)
      }

      return completion
    } catch (error) {
      this.isRunning = false
      this.clientInstance = null
      throw error
    }
  }

  async startChat(client: AgentClient): Promise<ChatManager | null> {
    if (!this.config.chat?.enabled) {
      return null
    }

    if (this.chatManager) {
      return this.chatManager
    }

    const chatManager = new ChatManager(
      client,
      this.config.chat,
      this.llm,
      {
        ...(this.config.characterName
          ? { selfCharacterName: this.config.characterName }
          : {}),
      },
    )
    await chatManager.connect()
    this.chatManager = chatManager

    const personality = this.resolveChatPersonality()
    if (typeof this.llm.chat === "function" && personality) {
      this.banterEngine = new BanterEngine(
        chatManager,
        this.llm,
        personality,
        {
          ...(this.config.chat.triggers
            ? { triggers: this.config.chat.triggers }
            : {}),
          ...(this.config.chat.banterFrequency !== undefined
            ? { banterFrequency: this.config.chat.banterFrequency }
            : {}),
          getAgentState: () => this.getChatAgentState(),
        },
      )
      this.banterEngine.start()
    }

    return chatManager
  }

  async handleExtraction(data: ExtractionPayload): Promise<void> {
    this.emit("extracted", data)
    await this.banterEngine?.notifyOwnExtraction({
      realm_completed: data.realm_completed,
      gold_gained: data.gold_gained,
      xp_gained: data.xp_gained,
    })
  }

  handleDeath(data: DeathPayload): void {
    this.emit("death", data)
  }

  stop(): void {
    this.teardownChat()
    this.clientInstance?.disconnect()
    this.clientInstance = null
    this.isRunning = false
    this.runCompletion?.resolve()
    this.runCompletion = null
    this.emit("disconnected", undefined)
  }

  private recordAction(observation: Observation, result: DecisionResult): void {
    const entry: HistoryEntry = {
      turn: observation.turn,
      action: result.action,
      reasoning: result.reasoning,
      observation_summary: summarizeObservation(observation),
    }

    this.history.push(entry)
    if (this.history.length > MAX_HISTORY) {
      this.history.shift()
    }

    this.context.previousActions.push({
      turn: observation.turn,
      action: result.action,
      reasoning: result.reasoning,
    })
    if (this.context.previousActions.length > MAX_HISTORY) {
      this.context.previousActions.shift()
    }
  }

  private emit<K extends AgentEventName>(event: K, payload: AgentEvents[K]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(payload)
    }
  }

  private resolveChatPersonality() {
    if (this.config.chat?.personality) {
      return this.config.chat.personality
    }

    if (!this.config.characterName) {
      return null
    }

    return {
      name: this.config.characterName,
      traits: ["observant"],
    }
  }

  private getChatAgentState() {
    const characterClass: CharacterClass =
      this.lastObservation?.character.class ??
      (this.config.characterClass as CharacterClass | undefined) ??
      "rogue"

    return {
      characterName: this.config.characterName ?? this.resolveChatPersonality()?.name ?? "Agent",
      characterClass,
      currentHP: this.lastObservation?.character.hp.current ?? 0,
      maxHP: this.lastObservation?.character.hp.max ?? 0,
    }
  }

  private resolveTacticalLLM(options: BaseAgentOptions): LLMAdapter {
    if (options.tacticalLLMAdapter) {
      return options.tacticalLLMAdapter
    }

    const tacticalModel = this.config.decision?.tacticalModel
    if (!tacticalModel) {
      return this.llm
    }

    return createLLMAdapter({
      ...this.config.llm,
      model: tacticalModel,
    })
  }

  private async createClient(session: SessionToken): Promise<AgentClient> {
    if (this.clientFactory) {
      return this.clientFactory({
        baseUrl: this.config.apiUrl,
        wsUrl: this.config.wsUrl,
        token: session,
        wallet: this.wallet,
      })
    }

    const x402Client = isX402CapableWalletAdapter(this.wallet)
      ? await createX402Client(this.wallet)
      : undefined

    return new GameClient(this.config.apiUrl, this.config.wsUrl, session, {
      wallet: this.wallet,
      ...(x402Client ? { x402Client } : {}),
    })
  }

  private async ensureCharacter(client: AgentClient): Promise<void> {
    try {
      await client.request("/characters/me")
      return
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error
      }
    }

    if (!this.config.characterClass || !this.config.characterName) {
      throw new Error(
        "characterClass and characterName are required to roll a character when none exists",
      )
    }

    await client.request("/characters/roll", {
      method: "POST",
      body: JSON.stringify({
        class: this.config.characterClass,
        name: this.config.characterName,
      }),
    })
  }

  private async ensureRealm(client: AgentClient): Promise<string> {
    const mine = await client.request<{ realms: Array<{ id: string; template_id?: string; status?: string }> }>("/realms/mine")
    const realms = mine.realms ?? []
    const requestedTemplate = this.config.realmTemplateId

    const reusableRealm = realms.find((realm) =>
      (requestedTemplate ? realm.template_id === requestedTemplate : true) &&
      realm.status !== "completed" &&
      realm.status !== "dead",
    )
    if (reusableRealm?.id) {
      return reusableRealm.id
    }

    if (!requestedTemplate) {
      throw new Error(
        "realmTemplateId is required when no reusable realm exists for the agent",
      )
    }

    const realm = await client.request<{ id: string }>("/realms/generate", {
      method: "POST",
      body: JSON.stringify({ template_id: requestedTemplate }),
    })
    return realm.id
  }

  private async handleObservation(observation: Observation): Promise<void> {
    try {
      const result = await this.processObservation(observation)
      this.clientInstance?.sendAction(result.action)
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      this.emit("error", normalizedError)
      this.failRun(normalizedError)
    }
  }

  private finishRun(): void {
    this.teardownChat()
    this.isRunning = false
    this.runCompletion?.resolve()
    this.runCompletion = null
    this.clientInstance = null
  }

  private failRun(error: Error): void {
    this.teardownChat()
    this.isRunning = false
    this.runCompletion?.reject(error)
    this.runCompletion = null
    this.clientInstance = null
  }

  private teardownChat(): void {
    this.banterEngine?.stop()
    this.banterEngine = null
    this.chatManager?.disconnect()
    this.chatManager = null
  }
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "status" in error) {
    return (error as { status?: unknown }).status === 404
  }

  return false
}

function summarizeObservation(obs: Observation): string {
  const parts = [
    `Turn ${obs.turn}`,
    `HP:${obs.character.hp.current}/${obs.character.hp.max}`,
    `Room:${obs.position.room_id}`,
    `Entities:${obs.visible_entities.length}`,
  ]
  return parts.join(", ")
}
