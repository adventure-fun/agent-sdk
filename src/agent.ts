import {
  createLLMAdapter,
  buildLobbyDecisionPrompt,
  buildLobbySystemPrompt,
  parseLobbyActionPlanFromText,
  type DecisionResult,
  type HistoryEntry,
  type LLMAdapter,
  type LobbyActionStep,
} from "./adapters/llm/index.js"
import {
  createX402Client,
  isX402CapableWalletAdapter,
  type WalletAdapter,
} from "./adapters/wallet/index.js"
import { authenticate, type SessionToken } from "./auth.js"
import { BanterEngine, ChatManager } from "./chat/index.js"
import {
  GameClient,
  type ItemTemplateSummary,
  type RealmTemplateSummary,
  type ShopCatalogItem,
  type ShopCatalogResponse,
} from "./client.js"
import type {
  AgentConfig,
  DecisionConfig,
  LobbyConfig,
  RealmProgressionConfig,
  StatRerollConfig,
} from "./config.js"
import { ActionPlanner, type PlannerDecision } from "./planner.js"
import type {
  Action,
  CharacterClass,
  CharacterStats,
  EquipSlot,
  InventoryItem,
  Observation,
} from "./protocol.js"
import {
  createAgentContext,
  createModuleRegistry,
  CombatModule,
  ExplorationModule,
  InventoryModule,
  KeyDoorModule,
  TrapHandlingModule,
  PortalModule,
  HealingModule,
  type AgentContext,
  type AgentModule,
  type ModuleRegistry,
} from "./modules/index.js"
import { computeCharacterRollNameForAttempt } from "./character-roll-name.js"
import type { CharacterNameProvider } from "./character-name-provider.js"
import type { ChatPersonality } from "./chat/personality.js"
import { SpendingTracker } from "./spending-tracker.js"

const DEFAULT_MODULES: AgentModule[] = [
  new CombatModule(),
  new ExplorationModule(),
  new InventoryModule(),
  new KeyDoorModule(),
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
type RunOutcome = "death" | "extracted" | "stopped"

export type AgentClient = Pick<
  GameClient,
  | "connect"
  | "connectLobby"
  | "disconnect"
  | "disconnectLobby"
  | "getCurrentCharacter"
  | "getLobbyInventory"
  | "getLobbyShops"
  | "getItemTemplates"
  | "getMyRealms"
  | "getRealmTemplates"
  | "buyShopItem"
  | "discardLobbyItem"
  | "sellShopItem"
  | "equipLobbyItem"
  | "unequipLobbySlot"
  | "useLobbyConsumable"
  | "restAtInn"
  | "request"
  | "sendAction"
  | "on"
  | "off"
>

export type LobbyCharacterRecord = {
  id: string
  class: CharacterClass
  name: string
  status?: string
  level?: number
  gold?: number
  hp_current?: number
  hp_max?: number
  resource_current?: number
  resource_max?: number
  stat_rerolled?: boolean
  stats?: CharacterStats
}

type CharacterRecord = LobbyCharacterRecord

type RealmRecord = {
  id: string
  template_id?: string
  status?: string
  // Mirrors realm_instances.session_state from the backend. A "paused" row
  // with session_state=null represents a clean exit (portal/retreat) that
  // should NOT block hub actions — findBlockingRealm must match the server's
  // hasLockedRealm semantics, otherwise the agent gets stuck re-entering a
  // realm it already cleanly left and the planner emergency-retreats forever.
  session_state?: unknown
}

type CharacterProgressionResponse = {
  skill_points: number
  skill_tree_unlocked: Record<string, boolean>
  tier_choices_available?: number
  perks_unlocked?: Record<string, number>
  perks_template?: Array<{ id: string; max_stacks: number }>
}

export type LobbyState = {
  character: CharacterRecord
  inventoryGold: number
  inventory: InventoryItem[]
  shops: ShopCatalogResponse
  itemTemplates: ItemTemplateSummary[]
}

/**
 * Optional lobby-phase extension hook. Called from `runHeuristicLobbyPhase` after inventory
 * cleanup and BEFORE the built-in equip/buy-potion/buy-portal passes, so custom shopping logic
 * can act on fresh lobby state without overriding the defaults. Implementations may call
 * `client.buyShopItem`, `client.sellShopItem`, `client.equipLobbyItem`, etc. The built-in
 * passes run again against refreshed state after the hook returns, so partial progress is safe.
 *
 * Errors thrown from the hook are surfaced via the `error` event and swallowed — they do not
 * abort the realm loop. Return `true` to indicate the hook fully handled shopping and the
 * default equip/buy passes should be skipped.
 */
export type LobbyHook = (ctx: {
  state: LobbyState
  client: AgentClient
  config: AgentConfig
}) => Promise<void | boolean>


class AgentStoppedError extends Error {
  constructor() {
    super("Agent stopped")
    this.name = "AgentStoppedError"
  }
}

interface AgentPlanner {
  decideAction(observation: Observation, context: AgentContext): Promise<PlannerDecision>
  reset?(): void
}

export interface BaseAgentOptions {
  llmAdapter: LLMAdapter
  tacticalLLMAdapter?: LLMAdapter
  walletAdapter: WalletAdapter
  characterNameProvider?: CharacterNameProvider
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
  /**
   * Optional lobby-phase extension. Called from `runHeuristicLobbyPhase` after inventory cleanup
   * and before the built-in equip/buy-potion/buy-portal passes. Return `true` to signal the hook
   * fully handled shopping and the default passes should be skipped.
   */
  lobbyHook?: LobbyHook
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
  context: AgentContext
  private readonly config: AgentConfig
  private readonly llm: LLMAdapter
  private readonly tacticalLLM: LLMAdapter
  private readonly wallet: WalletAdapter
  private readonly registry: ModuleRegistry
  private readonly planner: AgentPlanner
  private readonly nameProvider: CharacterNameProvider | null
  private readonly authenticateFn: (baseUrl: string, wallet: WalletAdapter) => Promise<SessionToken>
  private readonly clientFactory: BaseAgentOptions["clientFactory"]
  private readonly lobbyHook: LobbyHook | null
  private readonly history: HistoryEntry[] = []
  private lastObservation: Observation | null = null
  private chatManager: ChatManager | null = null
  private banterEngine: BanterEngine | null = null
  private listeners = new Map<AgentEventName, Set<(payload: unknown) => void>>()
  private clientInstance: AgentClient | null = null
  private spendingTracker: SpendingTracker | null = null
  private runCompletion:
    | {
        resolve: (outcome: RunOutcome) => void
        reject: (error: Error) => void
      }
    | null = null
  private isRunning = false
  // Tracks consecutive "empty" extractions — runs where the agent retreated
  // or timed out with gold=0, xp=0, completed=false. A streak of these usually
  // means the character is stuck at low HP with no way to heal (e.g. inn rest
  // disabled + wallet empty) and will emergency-retreat forever. The main
  // loop bails when the streak exceeds a threshold to avoid infinite loops.
  private emptyExtractionStreak = 0

  constructor(config: AgentConfig, options: BaseAgentOptions) {
    if (!config.llm.apiKey) {
      throw new Error("LLM API key is required")
    }

    this.config = config
    this.llm = options.llmAdapter
    this.wallet = options.walletAdapter
    this.nameProvider = options.characterNameProvider ?? null
    this.authenticateFn = options.authenticateFn ?? authenticate
    this.clientFactory = options.clientFactory
    this.lobbyHook = options.lobbyHook ?? null
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

      await this.maybeUpdateProfile(client)

      const startedAt = Date.now()
      let realmCount = 0
      let outcome: RunOutcome = "stopped"
      // Loop-detection + crash-resilience bookkeeping. See the try/catch around
      // playRealm below: we use these to (a) bail out if we keep resuming the
      // same stuck realm (belt-and-suspenders for the findBlockingRealm fix in
      // case any edge case still slips through), and (b) survive transient
      // network failures (e.g. /realms/:id/enter 404s from Railway edge
      // weirdness) without crashing the process.
      let lastBlockingRealmId: string | null = null
      let sameBlockingRealmStreak = 0
      let consecutivePlayFailures = 0
      const MAX_SAME_BLOCKING_RESUMES = 3
      const MAX_CONSECUTIVE_PLAY_FAILURES = 3
      const MAX_EMPTY_EXTRACTION_STREAK = 3
      this.emptyExtractionStreak = 0
      do {
        if (this.hasReachedActivityLimits(startedAt, realmCount)) {
          break
        }

        let character = await this.ensureCharacter(client)

        // If a previous run crashed mid-realm the backend still has that realm
        // marked active/paused, which blocks every hub action (inn rest, shop,
        // equip, reroll, skill/perk spend). Resume and play it out before any
        // hub prep so the next iteration starts clean.
        const blockingRealm = await this.findBlockingRealm(client)
        if (blockingRealm?.id) {
          if (blockingRealm.id === lastBlockingRealmId) {
            sameBlockingRealmStreak += 1
          } else {
            sameBlockingRealmStreak = 1
            lastBlockingRealmId = blockingRealm.id
          }
          if (sameBlockingRealmStreak >= MAX_SAME_BLOCKING_RESUMES) {
            console.error(
              `[agent] Aborting: realm ${blockingRealm.id} has blocked hub prep for `
                + `${sameBlockingRealmStreak} consecutive iterations. This usually means a `
                + `retreat loop on a character with too-low HP. Manual intervention required.`,
            )
            break
          }
          console.log(
            `[agent] Resuming stuck realm ${blockingRealm.id} (status=${blockingRealm.status}). `
              + "Skipping hub prep this iteration.",
          )
          try {
            outcome = await this.playRealm(client, blockingRealm.id)
            consecutivePlayFailures = 0
          } catch (error) {
            consecutivePlayFailures += 1
            const message = error instanceof Error ? error.message : String(error)
            console.warn(
              `[agent] playRealm failed (${consecutivePlayFailures}/${MAX_CONSECUTIVE_PLAY_FAILURES}): ${message}`,
            )
            if (consecutivePlayFailures >= MAX_CONSECUTIVE_PLAY_FAILURES) {
              console.error("[agent] Aborting: too many consecutive playRealm failures.")
              break
            }
            await new Promise<void>((r) => setTimeout(r, 2_000))
            continue
          }
          if (this.emptyExtractionStreak >= MAX_EMPTY_EXTRACTION_STREAK) {
            console.error(
              `[agent] Aborting: ${this.emptyExtractionStreak} consecutive empty extractions `
                + `(gold=0 xp=0 completed=false). Character is likely stuck at low HP with `
                + `no healing available — fund the wallet or heal manually and restart.`,
            )
            break
          }
          if (outcome !== "stopped") {
            realmCount += 1
          }
          continue
        }

        // No blocking realm this iteration — reset loop-detection state so
        // future stuck-realm streaks are measured from scratch.
        lastBlockingRealmId = null
        sameBlockingRealmStreak = 0

        character = await this.maybeRerollStats(client, character)
        if (!this.isRunning) {
          break
        }

        await this.maybeSpendSkillPoints(client)
        if (!this.isRunning) {
          break
        }

        await this.maybeSpendPerks(client)
        if (!this.isRunning) {
          break
        }

        await this.lobbyPhase(client)
        if (!this.isRunning || this.hasReachedActivityLimits(startedAt, realmCount)) {
          break
        }

        const realmId = await this.ensureRealm(client)
        try {
          outcome = await this.playRealm(client, realmId)
          consecutivePlayFailures = 0
        } catch (error) {
          consecutivePlayFailures += 1
          const message = error instanceof Error ? error.message : String(error)
          console.warn(
            `[agent] playRealm failed (${consecutivePlayFailures}/${MAX_CONSECUTIVE_PLAY_FAILURES}): ${message}`,
          )
          if (consecutivePlayFailures >= MAX_CONSECUTIVE_PLAY_FAILURES) {
            console.error("[agent] Aborting: too many consecutive playRealm failures.")
            break
          }
          await new Promise<void>((r) => setTimeout(r, 2_000))
          continue
        }
        if (this.emptyExtractionStreak >= MAX_EMPTY_EXTRACTION_STREAK) {
          console.error(
            `[agent] Aborting: ${this.emptyExtractionStreak} consecutive empty extractions `
              + `(gold=0 xp=0 completed=false). Character is likely stuck at low HP with `
              + `no healing available — fund the wallet or heal manually and restart.`,
          )
          break
        }
        if (outcome !== "stopped") {
          realmCount += 1
        }
      } while (this.isRunning && this.shouldContinue(outcome))

      this.isRunning = false
      this.clientInstance = null
    } catch (error) {
      this.isRunning = false
      this.clientInstance = null
      if (error instanceof AgentStoppedError) {
        return
      }
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
    // Track "empty" extractions — retreats with no loot and no completion.
    // The main loop uses this to detect retreat-loops (character stuck at low
    // HP, can't heal, keeps emergency-retreating from every realm it enters).
    if (
      !data.realm_completed
      && (data.gold_gained ?? 0) === 0
      && (data.xp_gained ?? 0) === 0
    ) {
      this.emptyExtractionStreak += 1
    } else {
      this.emptyExtractionStreak = 0
    }
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
    this.isRunning = false
    this.teardownChat()
    this.clientInstance?.disconnect()
    this.clientInstance = null
    this.runCompletion?.resolve("stopped")
    this.runCompletion = null
    this.emit("disconnected", undefined)
  }

  private recordAction(observation: Observation, result: DecisionResult): void {
    const observationSummary = summarizeObservation(observation)
    const entry: HistoryEntry = {
      turn: observation.turn,
      action: result.action,
      reasoning: result.reasoning,
      observation_summary: observationSummary,
    }

    this.history.push(entry)
    if (this.history.length > MAX_HISTORY) {
      this.history.shift()
    }

    this.context.previousActions.push({
      turn: observation.turn,
      action: result.action,
      reasoning: result.reasoning,
      observation_summary: observationSummary,
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
      if (this.config.limits?.maxSpendUsd !== undefined) {
        throw new Error(
          "limits.maxSpendUsd is not supported with a custom clientFactory because the SDK cannot attach x402 spending hooks.",
        )
      }
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
    this.spendingTracker = new SpendingTracker(this.config.limits)
    if (this.spendingTracker.isEnabled) {
      if (!x402Client) {
        throw new Error(
          "limits.maxSpendUsd requires an x402-capable wallet adapter so the SDK can track spending.",
        )
      }
      this.spendingTracker.attach(x402Client)
    }

    return new GameClient(this.config.apiUrl, this.config.wsUrl, session, {
      wallet: this.wallet,
      ...(x402Client ? { x402Client } : {}),
    })
  }

  private async maybeUpdateProfile(client: AgentClient): Promise<void> {
    const profile = this.config.profile
    if (!profile) {
      return
    }

    const body = {
      ...(profile.handle !== undefined ? { handle: profile.handle } : {}),
      ...(profile.xHandle !== undefined ? { x_handle: profile.xHandle } : {}),
      ...(profile.githubHandle !== undefined ? { github_handle: profile.githubHandle } : {}),
    }

    if (Object.keys(body).length === 0) {
      return
    }

    await client.request("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  }

  private async ensureCharacter(client: AgentClient): Promise<CharacterRecord> {
    let character: CharacterRecord | null = null
    try {
      character = await client.request<CharacterRecord>("/characters/me")
    } catch (error) {
      if (!isStatusError(error, 404)) {
        throw error
      }
    }

    if (
      character !== null
      && character.status !== undefined
      && character.status !== "alive"
    ) {
      character = null
    }

    if (character !== null) {
      // Reused character path: rollNewPlayerCharacter is the only other writer of
      // config.characterName, so without this the dynamic-name flow ends up with
      // characterName=undefined on every process restart. resolveChatPersonality then
      // returns null and startChat skips BanterEngine creation, silently disabling
      // banter until the character dies and gets re-rolled.
      if (
        !this.config.characterName
        && typeof character.name === "string"
        && character.name.trim().length > 0
      ) {
        this.config.characterName = character.name
      }
      return character
    }

    return this.rollNewPlayerCharacter(client)
  }

  /**
   * Creates a new living character (e.g. first session or after death when `/characters/me` is
   * absent or non-alive). Retries `POST /characters/roll` on name conflicts with fresh names.
   *
   * Name source precedence:
   *   1. Explicit `config.characterName` — always wins, retries use the deterministic suffix.
   *   2. Configured `characterNameProvider` — called per attempt; result persisted to config.
   *   3. Deterministic fallback on "Agent" if neither is available (throws if no class).
   *
   * After a successful roll, the chosen name is written back onto `this.config.characterName`
   * (and any returned personality into `this.config.chat.personality` if the user hasn't set
   * one) so downstream system prompts, chat manager, and banter engine read the fresh identity.
   */
  private async rollNewPlayerCharacter(client: AgentClient): Promise<CharacterRecord> {
    const characterClass = this.config.characterClass
    if (!characterClass) {
      throw new Error(
        "characterClass is required to roll a character when none exists",
      )
    }

    const hasExplicitName = typeof this.config.characterName === "string"
      && this.config.characterName.trim().length > 0
    const fallbackBase = hasExplicitName ? this.config.characterName! : "Agent"
    const provider = hasExplicitName ? null : this.nameProvider

    if (!provider && !hasExplicitName) {
      throw new Error(
        "characterName or characterNameProvider is required to roll a character when none exists",
      )
    }

    const maxAttempts = 40
    let lastName: string | undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let name: string
      let personality: Partial<ChatPersonality> | undefined

      if (provider) {
        try {
          const result = await provider.generate({
            characterClass: characterClass as CharacterClass,
            attempt,
            ...(lastName ? { previousName: lastName } : {}),
            ...(this.config.characterFlavor ? { flavor: this.config.characterFlavor } : {}),
          })
          name = result.name
          personality = result.personality
        } catch {
          // Provider (e.g. LLM) is unavailable or returned garbage. Fall back to the
          // deterministic suffix so the run doesn't die purely because naming failed.
          name = computeCharacterRollNameForAttempt(fallbackBase, attempt)
        }
      } else {
        name = computeCharacterRollNameForAttempt(fallbackBase, attempt)
      }

      lastName = name

      try {
        const character = await client.request<CharacterRecord>("/characters/roll", {
          method: "POST",
          body: JSON.stringify({
            class: characterClass,
            name,
          }),
        })

        this.config.characterName = character.name
        if (personality) {
          this.applyGeneratedPersonality(personality, character.name)
        }
        return character
      } catch (error) {
        if (isRetryableCharacterRollConflict(error)) {
          continue
        }
        throw error
      }
    }

    throw new Error(
      `Could not roll a new character after ${maxAttempts} attempts (last name conflict or invalid name).`,
    )
  }

  private applyGeneratedPersonality(
    partial: Partial<ChatPersonality>,
    name: string,
  ): void {
    if (!this.config.chat) return
    if (this.config.chat.personality) return
    this.config.chat.personality = {
      name,
      traits: partial.traits && partial.traits.length > 0 ? partial.traits : ["observant"],
      ...(partial.backstory ? { backstory: partial.backstory } : {}),
      ...(partial.responseStyle ? { responseStyle: partial.responseStyle } : {}),
      ...(partial.topics ? { topics: partial.topics } : {}),
    }
  }

  private async maybeRerollStats(
    client: AgentClient,
    character: CharacterRecord,
  ): Promise<CharacterRecord> {
    const rerollConfig = this.config.rerollStats
    if (!rerollConfig?.enabled) {
      return character
    }

    if (character.stat_rerolled || !character.stats) {
      return character
    }

    if (!this.isBadStatRoll(character.stats, rerollConfig)) {
      return character
    }

    if (!(await this.waitForBudgetIfNeeded())) {
      return character
    }

    return client.request<CharacterRecord>("/characters/reroll-stats", {
      method: "POST",
      body: JSON.stringify({}),
    })
  }

  private isBadStatRoll(stats: CharacterStats, rerollConfig: StatRerollConfig): boolean {
    const minStats = rerollConfig.minStats ?? {}
    const hasMinStats = Object.keys(minStats).length > 0
    const hasMinTotal = rerollConfig.minTotal !== undefined

    if (!hasMinStats && !hasMinTotal) {
      throw new Error(
        "rerollStats requires minStats or minTotal so the SDK can determine when a roll is bad",
      )
    }

    if (
      hasMinStats
      && Object.entries(minStats).some(([key, minimum]) =>
        minimum !== undefined && stats[key as keyof CharacterStats] < minimum,
      )
    ) {
      return true
    }

    if (hasMinTotal) {
      const total = Object.values(stats).reduce((sum, value) => sum + value, 0)
      return total < (rerollConfig.minTotal ?? 0)
    }

    return false
  }

  private async maybeSpendSkillPoints(client: AgentClient): Promise<void> {
    if (!this.config.skillTree?.autoSpend) {
      return
    }

    const preferredNodes = this.config.skillTree.preferredNodes ?? []
    if (preferredNodes.length === 0) {
      return
    }

    const progression = await client.request<CharacterProgressionResponse>("/characters/progression")
    if (progression.skill_points <= 0) {
      return
    }

    let remainingPoints = progression.skill_points
    const unlocked = new Set(Object.keys(progression.skill_tree_unlocked ?? {}))

    for (const nodeId of preferredNodes) {
      if (remainingPoints <= 0) {
        break
      }

      if (unlocked.has(nodeId)) {
        continue
      }

      try {
        await client.request("/characters/skill", {
          method: "POST",
          body: JSON.stringify({ node_id: nodeId }),
        })
        unlocked.add(nodeId)
        remainingPoints -= 1
      } catch (error) {
        if (isStatusError(error, 400)) {
          continue
        }
        throw error
      }
    }
  }

  private async maybeSpendPerks(client: AgentClient): Promise<void> {
    if (!this.config.perks?.autoSpend) {
      return
    }

    const preferredPerks = this.config.perks.preferredPerks ?? []
    if (preferredPerks.length === 0) {
      return
    }

    const progression = await client.request<CharacterProgressionResponse>("/characters/progression")
    if (progression.skill_points <= 0) {
      return
    }

    let remainingPoints = progression.skill_points
    const stacks: Record<string, number> = { ...(progression.perks_unlocked ?? {}) }
    const maxStacksById = new Map<string, number>()
    for (const perk of progression.perks_template ?? []) {
      maxStacksById.set(perk.id, perk.max_stacks)
    }

    // Walk the preferred list repeatedly, buying one stack at a time. This lets
    // the agent spread stacks across multiple perks (as opposed to dumping all
    // points into the first one) while still respecting user preference order.
    let madeProgress = true
    while (remainingPoints > 0 && madeProgress) {
      madeProgress = false
      for (const perkId of preferredPerks) {
        if (remainingPoints <= 0) break
        const cap = maxStacksById.get(perkId) ?? Infinity
        if ((stacks[perkId] ?? 0) >= cap) continue

        try {
          await client.request("/characters/perk", {
            method: "POST",
            body: JSON.stringify({ perk_id: perkId }),
          })
          stacks[perkId] = (stacks[perkId] ?? 0) + 1
          remainingPoints -= 1
          madeProgress = true
        } catch (error) {
          if (isStatusError(error, 400)) {
            // cap hit or other validation failure — skip this perk
            continue
          }
          throw error
        }
      }
    }
  }

  // Backend's hasLockedRealm (backend/src/game/active-sessions.ts) blocks hub
  // actions only when a realm_instances row is "active" OR "paused" AND
  // session_state is non-null. A paused row with null session_state is a clean
  // exit (portal extraction / retreat) that the agent just finished, and hub
  // actions will work against it. Mirroring that logic here is critical: the
  // old "any paused row blocks hub" heuristic caused the agent to re-enter a
  // realm it just cleanly left and emergency-retreat forever in a loop.
  private async findBlockingRealm(client: AgentClient): Promise<RealmRecord | null> {
    const mine = await this.getMyRealms(client)
    const realms = mine.realms ?? []
    for (const realm of realms) {
      if (!realm.id) continue
      if (realm.status === "active") {
        return realm
      }
      if (realm.status === "paused" && realm.session_state != null) {
        return realm
      }
    }
    return null
  }

  private async ensureRealm(client: AgentClient): Promise<string> {
    const mine = await this.getMyRealms(client)
    const realms = mine.realms ?? []
    const candidateTemplates = this.selectRealmTemplateCandidates()

    // Schema RealmStatus = "generated" | "active" | "paused" | "boss_cleared" |
    //   "realm_cleared" | "completed" | "dead_end". We can resume any realm whose run
    // hasn't finished server-side. "dead_end" is the actual death status (NOT "dead",
    // which is a typo we used to use that produced the "No active session" reconnect
    // loop). "boss_cleared" / "realm_cleared" are mid-extraction states the agent can
    // still play out, so they remain reusable.
    const FINISHED_REALM_STATUSES = new Set(["completed", "dead_end"])
    const reusableRealm = realms.find((realm) =>
      matchesRealmTemplate(realm, candidateTemplates)
      && (!realm.status || !FINISHED_REALM_STATUSES.has(realm.status)),
    )
    if (reusableRealm?.id) {
      return reusableRealm.id
    }

    const strategy = this.config.realmProgression?.strategy ?? "auto"

    if (strategy === "auto") {
      return this.ensureAutoRealm(client, realms, candidateTemplates)
    }

    if (strategy === "regenerate") {
      const completedRealm = realms.find((realm) =>
        matchesRealmTemplate(realm, candidateTemplates) && realm.status === "completed",
      )
      if (completedRealm?.id) {
        if (!(await this.waitForBudgetIfNeeded())) {
          throw new AgentStoppedError()
        }
        const regenerated = await client.request<RealmRecord>(
          `/realms/${completedRealm.id}/regenerate`,
          {
            method: "POST",
            body: JSON.stringify({}),
          },
        )
        return regenerated.id
      }
    }

    if (strategy === "new-realm") {
      for (const templateId of candidateTemplates) {
        const activeRealm = realms.find((realm) =>
          realm.template_id === templateId
          && realm.status !== "completed"
          && realm.status !== "dead_end",
        )
        if (activeRealm?.id) {
          return activeRealm.id
        }

        const completedRealm = realms.find((realm) =>
          realm.template_id === templateId && realm.status === "completed",
        )
        if (completedRealm) {
          continue
        }

        if (!(await this.waitForBudgetIfNeeded())) {
          throw new AgentStoppedError()
        }
        const realm = await client.request<RealmRecord>("/realms/generate", {
          method: "POST",
          body: JSON.stringify({ template_id: templateId }),
        })
        return realm.id
      }

      throw new Error(
        "realmProgression.strategy=\"new-realm\" exhausted templatePriority without finding a playable realm",
      )
    }

    const requestedTemplate = candidateTemplates[0]
    if (!requestedTemplate) {
      throw new Error(
        "realmTemplateId or realmProgression.templatePriority is required when no reusable realm exists for the agent",
      )
    }

    const completedRealm = realms.find((realm) =>
      realm.template_id === requestedTemplate && realm.status === "completed",
    )
    if (strategy === "stop" && completedRealm) {
      throw new Error(
        `Realm "${requestedTemplate}" is already completed and realmProgression.strategy is "stop"`,
      )
    }

    if (!(await this.waitForBudgetIfNeeded())) {
      throw new AgentStoppedError()
    }
    const realm = await client.request<RealmRecord>("/realms/generate", {
      method: "POST",
      body: JSON.stringify({ template_id: requestedTemplate }),
    })
    return realm.id
  }

  private selectRealmTemplateCandidates(): string[] {
    const candidates = [
      ...(this.config.realmProgression?.templatePriority ?? []),
      ...(this.config.realmTemplateId ? [this.config.realmTemplateId] : []),
    ].filter((value): value is string => value.length > 0)

    return [...new Set(candidates)]
  }

  private async ensureAutoRealm(
    client: AgentClient,
    realms: RealmRecord[],
    candidateTemplates: string[],
  ): Promise<string> {
    const templates = await this.getAutoRealmTemplates(client, candidateTemplates)
    if (templates.length === 0) {
      throw new Error("realmProgression.strategy=\"auto\" could not resolve any realm templates")
    }

    for (const template of templates) {
      const completedRealm = realms.find((realm) =>
        realm.template_id === template.id && realm.status === "completed",
      )
      if (completedRealm) {
        continue
      }

      if (!(await this.waitForBudgetIfNeeded())) {
        throw new AgentStoppedError()
      }
      const generatedRealm = await client.request<RealmRecord>("/realms/generate", {
        method: "POST",
        body: JSON.stringify({ template_id: template.id }),
      })
      return generatedRealm.id
    }

    const progression = this.config.realmProgression
    if (progression?.onAllCompleted === "stop") {
      throw new Error(
        "realmProgression.strategy=\"auto\" completed all available realm templates and onAllCompleted is \"stop\"",
      )
    }

    const completedRealmByTemplate = new Map(
      realms
        .filter((realm): realm is RealmRecord & { template_id: string; id: string } =>
          realm.template_id !== undefined && realm.id !== undefined && realm.status === "completed",
        )
        .map((realm) => [realm.template_id, realm]),
    )
    const lastCompletedTemplate = [...templates]
      .reverse()
      .find((template) => completedRealmByTemplate.has(template.id))
    if (!lastCompletedTemplate) {
      throw new Error(
        "realmProgression.strategy=\"auto\" could not find a completed realm to regenerate after exhausting templates",
      )
    }

    const realmToRegenerate = completedRealmByTemplate.get(lastCompletedTemplate.id)
    if (!realmToRegenerate?.id) {
      throw new Error(`Completed realm missing id for template "${lastCompletedTemplate.id}"`)
    }

    if (!(await this.waitForBudgetIfNeeded())) {
      throw new AgentStoppedError()
    }
    const regenerated = await client.request<RealmRecord>(
      `/realms/${realmToRegenerate.id}/regenerate`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    )
    return regenerated.id
  }

  private async getAutoRealmTemplates(
    client: AgentClient,
    candidateTemplates: string[],
  ): Promise<RealmTemplateSummary[]> {
    const response = await this.getRealmTemplates(client)
    const templates = [...(response.templates ?? [])].sort((left, right) => left.orderIndex - right.orderIndex)
    if (candidateTemplates.length === 0) {
      return templates
    }

    return templates.filter((template) => candidateTemplates.includes(template.id))
  }

  private shouldContinue(outcome: RunOutcome): boolean {
    if (!this.isRunning) {
      return false
    }

    if (outcome === "death") {
      return this.config.rerollOnDeath === true
    }

    if (outcome === "extracted") {
      return this.config.realmProgression?.continueOnExtraction ?? true
    }

    return false
  }

  private hasReachedActivityLimits(startedAt: number, realmCount: number): boolean {
    const limits = this.config.limits
    if (!limits) {
      return false
    }

    if (limits.maxRealms !== undefined && realmCount >= limits.maxRealms) {
      return true
    }

    if (
      limits.maxRuntimeMinutes !== undefined
      && Date.now() - startedAt >= limits.maxRuntimeMinutes * 60_000
    ) {
      return true
    }

    return false
  }

  private async waitForBudgetIfNeeded(): Promise<boolean> {
    const tracker = this.spendingTracker
    if (!tracker?.isEnabled || tracker.canSpend()) {
      return true
    }

    await tracker.sleepUntilBudgetResets(() => this.isRunning)
    return this.isRunning && tracker.canSpend()
  }

  private async lobbyPhase(client: AgentClient): Promise<void> {
    let state = await this.loadLobbyState(client)
    if (!state) {
      return
    }
    if (state.character.status && state.character.status !== "alive") {
      return
    }

    state = await this.ensureLobbyRecovery(client, state)
    if (!this.isRunning) {
      throw new AgentStoppedError()
    }

    if (this.config.lobby?.useLLM !== false && typeof this.llm.chat === "function") {
      const completedWithLlm = await this.runLlmLobbyPhase(client, state)
      if (completedWithLlm) {
        const refreshedState = await this.loadLobbyState(client)
        if (!refreshedState) {
          return
        }
        if (this.config.lobby?.autoSellJunk !== false) {
          await this.runInventoryCleanupPhase(client, refreshedState)
        }
        return
      }

      state = await this.loadLobbyState(client)
      if (!state) {
        return
      }
    }

    await this.runHeuristicLobbyPhase(client, state)
  }

  private async ensureLobbyRecovery(
    client: AgentClient,
    state: LobbyState,
  ): Promise<LobbyState> {
    const lobbyConfig = this.config.lobby ?? {}
    if (!shouldHealAtInn(state.character, lobbyConfig)) {
      return state
    }
    if (!(await this.waitForBudgetIfNeeded())) {
      throw new AgentStoppedError()
    }

    // Right after a retreat/extraction the backend can 409 the rest endpoint for two reasons:
    //   1) "You are already fully rested" — the server finished the post-extract auto-heal
    //      before our stale `state` snapshot could see it. Re-fetch `/characters/me`; if the
    //      fresh character no longer needs healing, we're done.
    //   2) "Leave the dungeon before resting" — session cleanup hasn't finished yet; we wait
    //      and retry until the session drops off server-side.
    // Non-409 errors (e.g. 500 from x402 payment failure when the wallet has no USDC)
    // are now logged and swallowed. The agent continues to lobby phase; the main loop's
    // pre-realm HP check will stop the agent cleanly if HP is still critically low.
    const maxAttempts = 5
    const baseBackoffMs = 500

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await client.restAtInn()
        const refreshed = await this.loadLobbyState(client)
        return refreshed ?? state
      } catch (error) {
        if (!isStatusError(error, 409)) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(
            `[agent] inn rest failed (${message}); continuing without healing. `
              + "Set lobby.disableInnRest=true to skip inn rest entirely, or fund the wallet.",
          )
          // Return the freshest state we can so downstream logic sees real HP.
          return (await this.loadLobbyState(client)) ?? state
        }
        // Re-fetch character state. If the server already healed us, accept and proceed.
        const refreshed = await this.loadLobbyState(client)
        if (refreshed && !shouldHealAtInn(refreshed.character, lobbyConfig)) {
          return refreshed
        }
        if (!this.isRunning) {
          throw new AgentStoppedError()
        }
        // Still needs healing — back off and retry (session likely still winding down).
        if (attempt < maxAttempts - 1) {
          const delayMs = baseBackoffMs * (attempt + 1)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }

    // Ran out of 409 retries — probably session cleanup is genuinely stuck.
    // Log and return the latest state; the main loop's HP check will decide.
    console.warn(
      `[agent] inn rest still 409ing after ${maxAttempts} attempts; continuing anyway`,
    )
    return (await this.loadLobbyState(client)) ?? state
  }

  private async loadLobbyState(client: AgentClient): Promise<LobbyState | null> {
    try {
      const [character, inventory, shops, itemTemplates] = await Promise.all([
        this.getCurrentCharacter(client),
        this.getLobbyInventory(client),
        this.getLobbyShops(client),
        this.getItemTemplates(client),
      ])

      return {
        character: character as CharacterRecord,
        inventoryGold: inventory.gold,
        inventory: inventory.inventory,
        shops,
        itemTemplates: itemTemplates.items,
      }
    } catch (error) {
      if (isStatusError(error, 404)) {
        return null
      }
      throw error
    }
  }

  private async runLlmLobbyPhase(client: AgentClient, initialState: LobbyState): Promise<boolean> {
    const personality = this.resolveChatPersonality() ?? {
      name: this.config.characterName ?? initialState.character.name ?? "Agent",
      traits: ["pragmatic"],
    }

    try {
      const response = await this.llm.chat?.({
        recentMessages: [],
        personality,
        trigger: "idle",
        agentState: {
          characterName: initialState.character.name ?? personality.name,
          characterClass: initialState.character.class,
          currentHP: initialState.character.hp_current ?? 0,
          maxHP: initialState.character.hp_max ?? 0,
        },
        context: buildLobbyDecisionPrompt({
          character: initialState.character,
          inventory: {
            gold: initialState.inventoryGold,
            inventory: initialState.inventory,
          },
          shops: initialState.shops,
        }),
        systemPrompt: buildLobbySystemPrompt(this.config),
      })

      if (!response) {
        return false
      }

      const plan = parseLobbyActionPlanFromText(response)
      if (!plan) {
        return false
      }

      let state = initialState
      for (const step of plan.actions.slice(0, 8)) {
        if (!this.isRunning) {
          throw new AgentStoppedError()
        }

        state = await this.executeLobbyAction(client, state, step)
        if (step.action === "done") {
          break
        }
      }

      return true
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      if (normalizedError instanceof AgentStoppedError) {
        throw normalizedError
      }

      this.emit("error", normalizedError)
      return false
    }
  }

  private async runHeuristicLobbyPhase(client: AgentClient, initialState: LobbyState): Promise<void> {
    const lobbyConfig = this.config.lobby ?? {}
    let state = initialState

    if (shouldHealAtInn(state.character, lobbyConfig)) {
      if (!(await this.waitForBudgetIfNeeded())) {
        throw new AgentStoppedError()
      }

      await client.restAtInn()
      const refreshedState = await this.loadLobbyState(client)
      if (!refreshedState) {
        return
      }
      state = refreshedState
    }

    if (lobbyConfig.autoSellJunk !== false) {
      state = await this.runInventoryCleanupPhase(client, state)
    }

    let hookFullyHandled = false
    if (this.lobbyHook) {
      try {
        const hookResult = await this.lobbyHook({
          state,
          client,
          config: this.config,
        })
        hookFullyHandled = hookResult === true
        const refreshedState = await this.loadLobbyState(client)
        if (!refreshedState) {
          return
        }
        state = refreshedState
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        this.emit("error", normalizedError)
      }
    }

    if (!hookFullyHandled && lobbyConfig.autoEquipUpgrades !== false) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const upgrade = findBestLobbyUpgrade(state.inventory)
        if (!upgrade) {
          break
        }

        await client.equipLobbyItem(upgrade.id)
        const refreshedState = await this.loadLobbyState(client)
        if (!refreshedState) {
          return
        }
        state = refreshedState
      }
    }

    const healingItems = getHealingShopItems(state.shops)
    const preferredHealingItem = healingItems[0]
    const desiredPotions = lobbyConfig.buyPotionMinimum ?? 2
    if (!hookFullyHandled && preferredHealingItem && desiredPotions > 0) {
      const ownedHealing = countInventoryTemplates(
        state.inventory,
        new Set(healingItems.map((item) => item.id)),
      )
      if (ownedHealing < desiredPotions && state.inventoryGold >= (preferredHealingItem.buy_price ?? 0)) {
        const quantity = Math.min(
          desiredPotions - ownedHealing,
          preferredHealingItem.stack_limit ?? desiredPotions - ownedHealing,
        )
        await client.buyShopItem({
          itemId: preferredHealingItem.id,
          quantity,
        })
        const refreshedState = await this.loadLobbyState(client)
        if (!refreshedState) {
          return
        }
        state = refreshedState
      }
    }

    if (!hookFullyHandled && lobbyConfig.buyPortalScroll !== false) {
      const portalItem = getPortalShopItem(state.shops)
      if (portalItem) {
        const ownedPortals = countInventoryTemplates(state.inventory, new Set([portalItem.id]))
        if (ownedPortals < 1 && state.inventoryGold >= (portalItem.buy_price ?? 0)) {
          await client.buyShopItem({ itemId: portalItem.id, quantity: 1 })
        }
      }
    }
  }

  private async runInventoryCleanupPhase(
    client: AgentClient,
    initialState: LobbyState,
  ): Promise<LobbyState> {
    let state = initialState
    for (const action of planInventoryCleanup(state)) {
      if (action.type === "sell") {
        await client.sellShopItem({
          itemId: action.item.id,
          quantity: action.quantity,
        })
      } else {
        await this.discardLobbyItem(client, action.item.id)
      }

      const refreshedState = await this.loadLobbyState(client)
      if (!refreshedState) {
        return state
      }
      state = refreshedState
    }

    return state
  }

  private async executeLobbyAction(
    client: AgentClient,
    state: LobbyState,
    step: LobbyActionStep,
  ): Promise<LobbyState> {
    try {
      switch (step.action) {
        case "heal": {
          if (!canUseInn(state.character)) {
            return state
          }
          if (!(await this.waitForBudgetIfNeeded())) {
            throw new AgentStoppedError()
          }
          await client.restAtInn()
          return (await this.loadLobbyState(client)) ?? state
        }
        case "buy": {
          if (!step.item_id) {
            return state
          }
          const shopItem = findShopItem(state.shops, step.item_id)
          if (!shopItem) {
            return state
          }
          await client.buyShopItem({
            itemId: shopItem.id,
            quantity: normalizeQuantity(step.quantity),
          })
          return (await this.loadLobbyState(client)) ?? state
        }
        case "sell": {
          if (!step.item_id) {
            return state
          }
          const inventoryItem = state.inventory.find((item) => item.id === step.item_id && !item.slot)
          if (!inventoryItem) {
            return state
          }
          await client.sellShopItem({
            itemId: inventoryItem.id,
            quantity: Math.min(normalizeQuantity(step.quantity), inventoryItem.quantity),
          })
          return (await this.loadLobbyState(client)) ?? state
        }
        case "equip": {
          if (!step.item_id) {
            return state
          }
          const inventoryItem = state.inventory.find((item) => item.id === step.item_id && !item.slot)
          if (!inventoryItem) {
            return state
          }
          await client.equipLobbyItem(inventoryItem.id)
          return (await this.loadLobbyState(client)) ?? state
        }
        case "unequip": {
          if (!step.slot || !state.inventory.some((item) => item.slot === step.slot)) {
            return state
          }
          await client.unequipLobbySlot(step.slot)
          return (await this.loadLobbyState(client)) ?? state
        }
        case "use": {
          if (!step.item_id) {
            return state
          }
          const inventoryItem = state.inventory.find((item) => item.id === step.item_id)
          if (!inventoryItem) {
            return state
          }
          await client.useLobbyConsumable(inventoryItem.id)
          return (await this.loadLobbyState(client)) ?? state
        }
        case "done":
          return state
      }
    } catch (error) {
      if (isStatusError(error, 400) || isStatusError(error, 404) || isStatusError(error, 409)) {
        return (await this.loadLobbyState(client)) ?? state
      }
      throw error
    }
  }

  private async getCurrentCharacter(client: AgentClient): Promise<CharacterRecord> {
    const maybeTypedClient = client as AgentClient & {
      getCurrentCharacter?: () => Promise<CharacterRecord>
    }
    if (typeof maybeTypedClient.getCurrentCharacter === "function") {
      return maybeTypedClient.getCurrentCharacter()
    }

    return client.request<CharacterRecord>("/characters/me")
  }

  private async getMyRealms(client: AgentClient): Promise<{ realms: RealmRecord[] }> {
    const maybeTypedClient = client as AgentClient & {
      getMyRealms?: () => Promise<{ realms: RealmRecord[] }>
    }
    if (typeof maybeTypedClient.getMyRealms === "function") {
      return maybeTypedClient.getMyRealms()
    }

    return client.request<{ realms: RealmRecord[] }>("/realms/mine")
  }

  private async getRealmTemplates(
    client: AgentClient,
  ): Promise<{ templates: RealmTemplateSummary[] }> {
    const maybeTypedClient = client as AgentClient & {
      getRealmTemplates?: () => Promise<{ templates: RealmTemplateSummary[] }>
    }
    if (typeof maybeTypedClient.getRealmTemplates === "function") {
      return maybeTypedClient.getRealmTemplates()
    }

    return client.request<{ templates: RealmTemplateSummary[] }>("/content/realms")
  }

  private async getLobbyInventory(client: AgentClient): Promise<{
    gold: number
    inventory: InventoryItem[]
  }> {
    const maybeTypedClient = client as AgentClient & {
      getLobbyInventory?: () => Promise<{ gold: number; inventory: InventoryItem[] }>
    }
    if (typeof maybeTypedClient.getLobbyInventory === "function") {
      return maybeTypedClient.getLobbyInventory()
    }

    return client.request<{ gold: number; inventory: InventoryItem[] }>("/lobby/shop/inventory")
  }

  private async getLobbyShops(client: AgentClient): Promise<ShopCatalogResponse> {
    const maybeTypedClient = client as AgentClient & {
      getLobbyShops?: () => Promise<ShopCatalogResponse>
    }
    if (typeof maybeTypedClient.getLobbyShops === "function") {
      return maybeTypedClient.getLobbyShops()
    }

    return client.request<ShopCatalogResponse>("/lobby/shops")
  }

  private async getItemTemplates(
    client: AgentClient,
  ): Promise<{ items: ItemTemplateSummary[] }> {
    const maybeTypedClient = client as AgentClient & {
      getItemTemplates?: () => Promise<{ items: ItemTemplateSummary[] }>
    }
    if (typeof maybeTypedClient.getItemTemplates === "function") {
      return maybeTypedClient.getItemTemplates()
    }

    return client.request<{ items: ItemTemplateSummary[] }>("/content/items")
  }

  private async discardLobbyItem(client: AgentClient, itemId: string): Promise<void> {
    const maybeTypedClient = client as AgentClient & {
      discardLobbyItem?: (itemId: string) => Promise<unknown>
    }
    if (typeof maybeTypedClient.discardLobbyItem === "function") {
      await maybeTypedClient.discardLobbyItem(itemId)
      return
    }

    await client.request("/lobby/discard", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
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

  private async playRealm(client: AgentClient, realmId: string): Promise<RunOutcome> {
    // Each realm instance gets a fresh planner + context so that leftover strategic plans
    // (e.g. queued actions after an emergency retreat) and stale map memory from the previous
    // realm can't bleed into the new run's first turns.
    this.planner.reset?.()
    this.context = createAgentContext(this.config)

    const completion = new Promise<RunOutcome>((resolve, reject) => {
      this.runCompletion = { resolve, reject }
    })

    await client.connect(realmId, {
      onObservation: async (observation) => {
        await this.handleObservation(observation)
      },
      onDeath: (payload) => {
        this.handleDeath(payload)
        this.finishRun("death")
      },
      onExtracted: async (payload) => {
        await this.handleExtraction(payload)
        this.finishRun("extracted")
      },
      onError: (error) => {
        this.emit("error", error)
        // If the server says the session is over, stop hammering it. Errors like
        // "No active session", "session expired", or "realm not found" mean the realm
        // is unrecoverable; reconnecting won't fix anything. Disconnect the client
        // and fail the current run so the outer realm loop can move on (or stop).
        if (isFatalGameError(error)) {
          this.clientInstance?.disconnect()
          this.failRun(
            error instanceof Error
              ? error
              : new Error(`Fatal game error: ${String(error)}`),
          )
        }
      },
      onClose: (event) => {
        // A single unexpected close used to kill the run immediately. We now
        // defer to the client's reconnection loop: if willReconnect is true
        // the client has scheduled another attempt, and we only give up when
        // onReconnectExhausted fires (or the close was intentional to begin
        // with). The server-side handleGameOpen sends a fresh initial
        // observation on every successful reconnect, so the agent's planner
        // automatically resyncs without needing a bespoke resume path.
        if (event.intentional) return
        if (event.willReconnect) {
          console.log(
            `[agent] game socket closed (code=${event.code} reason=${event.reason || "-"}), reconnect scheduled`,
          )
          return
        }
        if (this.isRunning && this.runCompletion) {
          this.failRun(
            new Error(`Game socket closed unexpectedly: ${event.code} ${event.reason}`),
          )
        }
      },
      onReconnecting: (event) => {
        console.log(
          `[agent] reconnecting (attempt ${event.attempt}/${event.maxAttempts}, delay=${event.delayMs}ms)`,
        )
      },
      onReconnectExhausted: (event) => {
        if (this.isRunning && this.runCompletion) {
          const reason = event.lastError?.message ?? "unknown"
          this.failRun(
            new Error(
              `Game socket reconnection exhausted after ${event.attempts} attempts: ${reason}`,
            ),
          )
        }
      },
      onReconnected: (_event) => {
        console.log("[agent] game socket reconnected — awaiting fresh initial observation")
      },
    })

    if (this.config.chat?.enabled) {
      // Chat is supplemental — a lobby WS failure must never kill the run. ChatManager's
      // own connect() path unwires its listeners on failure, so there's nothing to
      // unwind here. The next realm iteration will attempt startChat again.
      try {
        await this.startChat(client)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[agent] chat unavailable this run: ${message}`)
      }
    }

    return completion
  }

  private finishRun(outcome: RunOutcome): void {
    if (!this.runCompletion) {
      // Already finished (e.g. death + extracted both fire, or finishRun called twice).
      return
    }
    this.teardownChat()
    // Cleanly close the game socket before resolving so the server-side close event
    // doesn't race the next realm in the loop. disconnect() sets intentionalGameDisconnect
    // and the per-socket guard in openGameSocket ignores stale onclose events anyway —
    // but closing eagerly makes the cleanup deterministic.
    this.clientInstance?.disconnect()
    this.runCompletion.resolve(outcome)
    this.runCompletion = null
  }

  private failRun(error: Error): void {
    if (!this.runCompletion) {
      // Already failed/finished — don't reject twice. failRun is idempotent so callers
      // that race (e.g. fatal-error onError + onClose firing back-to-back) are safe.
      return
    }
    this.teardownChat()
    this.isRunning = false
    // Make sure the WebSocket is closed and reconnects are suppressed before we hand
    // control back to the outer realm loop. disconnect() sets intentionalGameDisconnect.
    this.clientInstance?.disconnect()
    this.runCompletion.reject(error)
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

function matchesRealmTemplate(realm: RealmRecord, candidateTemplates: string[]): boolean {
  if (candidateTemplates.length === 0) {
    return true
  }

  return realm.template_id !== undefined && candidateTemplates.includes(realm.template_id)
}

function isStatusError(error: unknown, status: number): boolean {
  if (typeof error === "object" && error !== null && "status" in error) {
    return (error as { status?: unknown }).status === status
  }

  return false
}

/**
 * Name / uniqueness conflicts from `POST /characters/roll`. The dev API returns 409; the
 * production API has been observed returning 400 and 500 for per-account unique-name
 * collisions. We fast-path 409, then fall back to scanning the error message and the raw
 * response body for a name-conflict hint on 400/500 so we can still retry with a fresh name.
 * A bare 500 with no conflict hint is NOT retried — that keeps real server outages failing
 * fast instead of burning 40 retries.
 */
function isRetryableCharacterRollConflict(error: unknown): boolean {
  if (isStatusError(error, 409)) {
    return true
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ""
  const body = extractGameClientBodyText(error).toLowerCase()
  const haystack = `${message} ${body}`
  const nameConflictHint =
    haystack.includes("name")
    || haystack.includes("unique")
    || haystack.includes("taken")
    || haystack.includes("exists")
    || haystack.includes("conflict")
    || haystack.includes("duplicate")

  if (isStatusError(error, 400) && nameConflictHint) return true
  if (isStatusError(error, 500) && nameConflictHint) return true
  return false
}

function extractGameClientBodyText(error: unknown): string {
  if (typeof error === "object" && error !== null && "bodyText" in error) {
    const value = (error as { bodyText?: unknown }).bodyText
    return typeof value === "string" ? value : ""
  }
  return ""
}

/**
 * Returns true when an error from the game WebSocket means the current realm is unrecoverable.
 * Used by the agent's onError handler to fail the run instead of looping forever sending
 * actions that the server keeps rejecting. Matches messages from the server's session layer.
 */
const FATAL_GAME_ERROR_PATTERNS = [
  /no active session/i,
  /session.*(?:expired|terminated|ended|closed)/i,
  /realm.*not found/i,
  /character.*not found/i,
  /already.*(?:completed|extracted|dead)/i,
]
function isFatalGameError(error: unknown): boolean {
  if (!error) return false
  // Only flag GameClientError of kind "game" (server-side game errors). Network / protocol /
  // payment errors are recoverable and shouldn't kill the run on their own.
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error)
  if (!message) return false
  const kind =
    typeof error === "object" && error !== null && "kind" in error
      ? (error as { kind: unknown }).kind
      : undefined
  if (kind !== undefined && kind !== "game") return false
  return FATAL_GAME_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

function summarizeObservation(obs: Observation): string {
  const entityCounts: Record<string, number> = {}
  for (const entity of obs.visible_entities) {
    entityCounts[entity.type] = (entityCounts[entity.type] ?? 0) + 1
  }
  const entitySummary = Object.entries(entityCounts)
    .map(([type, count]) => `${type}:${count}`)
    .join("/") || "none"
  const parts = [
    `f${obs.position.floor}/${obs.realm_info.floor_count}`,
    `room:${obs.position.room_id}`,
    `pos:(${obs.position.tile.x},${obs.position.tile.y})`,
    `hp:${obs.character.hp.current}/${obs.character.hp.max}`,
    `${obs.character.resource.type}:${obs.character.resource.current}/${obs.character.resource.max}`,
    `entities:${entitySummary}`,
    `status:${obs.realm_info.status}`,
  ]
  return parts.join(" ")
}

function canUseInn(character: CharacterRecord): boolean {
  return (
    typeof character.hp_current === "number"
    && typeof character.hp_max === "number"
    && character.hp_current < character.hp_max
  )
}

function shouldHealAtInn(character: CharacterRecord, lobbyConfig: LobbyConfig): boolean {
  if (lobbyConfig.disableInnRest) {
    return false
  }
  if (!canUseInn(character)) {
    return false
  }

  const threshold = lobbyConfig.innHealThreshold ?? 1
  // `threshold <= 0` means "never heal". Treating it explicitly instead of
  // relying on the math (0.22 < 0 → false) makes the intent obvious to anyone
  // reading the config: set `innHealThreshold: 0` or `disableInnRest: true` to
  // opt out when the wallet can't afford the x402 fee.
  if (threshold <= 0) {
    return false
  }
  return (character.hp_current ?? 0) / Math.max(character.hp_max ?? 1, 1) < threshold
}

function findBestLobbyUpgrade(inventory: InventoryItem[]): InventoryItem | null {
  const equippedBySlot = new Map<EquipSlot, InventoryItem>()
  for (const item of inventory) {
    if (item.slot) {
      equippedBySlot.set(item.slot, item)
    }
  }

  let bestUpgrade: InventoryItem | null = null
  let bestDelta = 0
  for (const item of inventory) {
    if (item.slot) {
      continue
    }

    const guessedSlot = guessLobbySlot(item)
    if (!guessedSlot) {
      continue
    }

    const equipped = equippedBySlot.get(guessedSlot)
    const delta = itemModifierValue(item.modifiers) - itemModifierValue(equipped?.modifiers ?? {})
    if (!equipped || delta > bestDelta) {
      bestUpgrade = item
      bestDelta = equipped ? delta : itemModifierValue(item.modifiers)
    }
  }

  return bestUpgrade
}

type InventoryCleanupAction = {
  type: "sell" | "discard"
  item: InventoryItem
  quantity: number
}

function planInventoryCleanup(state: LobbyState): InventoryCleanupAction[] {
  const templatesById = new Map(state.itemTemplates.map((template) => [template.id, template]))
  const actions: InventoryCleanupAction[] = []

  for (const item of state.inventory) {
    if (item.slot) {
      continue
    }

    const template = templatesById.get(item.template_id)
    if (isProtectedLobbyItem(item.template_id, template)) {
      continue
    }

    if (isCharacterIncompatibleItem(state.character.class, template)) {
      actions.push({
        type: (template?.sell_price ?? 0) > 0 ? "sell" : "discard",
        item,
        quantity: item.quantity,
      })
      continue
    }

    if (!isConservativeJunkCandidate(item, template)) {
      continue
    }

    actions.push({
      type: (template?.sell_price ?? 0) > 0 ? "sell" : "discard",
      item,
      quantity: item.quantity,
    })
  }

  return actions
}

function isProtectedLobbyItem(
  templateId: string,
  template: ItemTemplateSummary | undefined,
): boolean {
  if (templateId === "health-potion" || templateId === "portal-scroll") {
    return true
  }

  if (!template) {
    return false
  }

  if (template.type === "key-item") {
    return true
  }

  return Array.isArray(template.effects) && template.effects.some((effect) =>
    typeof effect === "object"
    && effect !== null
    && "type" in effect
    && (
      effect.type === "heal-hp"
      || effect.type === "restore-resource"
      || effect.type === "portal-escape"
    ),
  )
}

function isCharacterIncompatibleItem(
  characterClass: string | undefined,
  template: ItemTemplateSummary | undefined,
): boolean {
  if (!template || !characterClass) {
    return false
  }

  if (template.class_restriction && template.class_restriction !== characterClass) {
    return true
  }

  return Boolean(template.ammo_type) && characterClass !== "archer"
}

function isConservativeJunkCandidate(
  item: InventoryItem,
  template: ItemTemplateSummary | undefined,
): boolean {
  const lowerName = item.name.toLowerCase()
  if (lowerName.includes("junk") || lowerName.includes("scrap") || lowerName.includes("trophy")) {
    return true
  }

  if (!template) {
    return item.quantity > 1 && itemModifierValue(item.modifiers) === 0
  }

  if (template.type === "loot") {
    return true
  }

  return item.quantity > 1
    && template.type !== "equipment"
    && template.type !== "consumable"
    && template.type !== "key-item"
    && itemModifierValue(item.modifiers) === 0
}

function getHealingShopItems(shops: ShopCatalogResponse): ShopCatalogItem[] {
  return shops.sections
    .flatMap((section) => section.items)
    .filter((item) => {
      if (item.id === "health-potion") {
        return true
      }

      return Array.isArray(item.effects)
        && item.effects.some((effect) =>
          typeof effect === "object"
          && effect !== null
          && "type" in effect
          && effect.type === "heal-hp",
        )
    })
    .sort((left, right) => (left.buy_price ?? Number.POSITIVE_INFINITY) - (right.buy_price ?? Number.POSITIVE_INFINITY))
}

function getPortalShopItem(shops: ShopCatalogResponse): ShopCatalogItem | null {
  return shops.sections
    .flatMap((section) => section.items)
    .find((item) => {
      if (item.id === "portal-scroll") {
        return true
      }

      return Array.isArray(item.effects)
        && item.effects.some((effect) =>
          typeof effect === "object"
          && effect !== null
          && "type" in effect
          && effect.type === "portal-escape",
        )
    }) ?? null
}

function findShopItem(shops: ShopCatalogResponse, itemId: string): ShopCatalogItem | null {
  return shops.sections.flatMap((section) => section.items).find((item) => item.id === itemId) ?? null
}

function countInventoryTemplates(inventory: InventoryItem[], templateIds: Set<string>): number {
  return inventory.reduce((sum, item) => (
    templateIds.has(item.template_id) ? sum + item.quantity : sum
  ), 0)
}

function itemModifierValue(modifiers: Record<string, number>): number {
  return Object.values(modifiers).reduce((sum, value) => sum + Math.abs(value), 0)
}

function guessLobbySlot(item: InventoryItem): EquipSlot | null {
  if (typeof item.modifiers.attack === "number" && item.modifiers.attack > 0) {
    return "weapon"
  }
  if (typeof item.modifiers.defense === "number" && item.modifiers.defense > 0) {
    return "armor"
  }

  const lowerName = item.name.toLowerCase()
  if (lowerName.includes("helm")) return "helm"
  if (lowerName.includes("glove") || lowerName.includes("hand")) return "hands"
  if (lowerName.includes("ring") || lowerName.includes("amulet") || lowerName.includes("accessory")) {
    return "accessory"
  }
  if (lowerName.includes("armor")) return "armor"

  return null
}

function normalizeQuantity(quantity: number | undefined): number {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 1) {
    return 1
  }

  return Math.floor(quantity)
}
