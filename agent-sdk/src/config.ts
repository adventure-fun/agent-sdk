import type {
  ChatConfig,
} from "./chat/personality.js"
import {
  DEFAULT_BANTER_FREQUENCY_SECONDS,
  DEFAULT_CHAT_HISTORY_LENGTH,
  DEFAULT_CHAT_TRIGGERS,
} from "./chat/personality.js"

export type LLMProvider = "openrouter" | "openai" | "anthropic"
export type WalletProvider = "env" | "open-wallet"
export type LogLevel = "debug" | "info" | "warn" | "error"
export type WalletNetwork = "base" | "base-sepolia" | "solana" | "solana-devnet"

export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model?: string
  baseUrl?: string
  maxRetries?: number
  temperature?: number
  structuredOutput?: "auto" | "json" | "tool"
}

export interface WalletConfig {
  type: WalletProvider
  network?: WalletNetwork
  privateKey?: string
  walletName?: string
  passphrase?: string
  chainId?: string
  vaultPath?: string
  accountIndex?: number
}

export interface StatRerollConfig {
  enabled?: boolean
  minStats?: Partial<{
    hp: number
    attack: number
    defense: number
    accuracy: number
    evasion: number
    speed: number
  }>
  minTotal?: number
}

export type RealmProgressionStrategy = "auto" | "regenerate" | "new-realm" | "stop"

export interface RealmProgressionConfig {
  strategy: RealmProgressionStrategy
  templatePriority?: string[]
  continueOnExtraction?: boolean
  onAllCompleted?: "regenerate-last" | "stop"
}

export interface AgentProfileConfig {
  handle?: string
  xHandle?: string
  githubHandle?: string
}

export interface SkillTreeConfig {
  autoSpend?: boolean
  preferredNodes?: string[]
}

export interface PerksConfig {
  autoSpend?: boolean
  /** Perk IDs in order of preference. The agent buys stacks top-to-bottom. */
  preferredPerks?: string[]
}

export interface LobbyConfig {
  innHealThreshold?: number
  autoSellJunk?: boolean
  autoEquipUpgrades?: boolean
  buyPotionMinimum?: number
  buyPortalScroll?: boolean
  useLLM?: boolean
}

export type SpendingWindow = "total" | "daily" | "hourly"

export interface AgentLimitsConfig {
  maxRealms?: number
  maxRuntimeMinutes?: number
  maxSpendUsd?: number
  spendingWindow?: SpendingWindow
}

export interface ModuleConfig {
  name: string
  enabled?: boolean
  priority?: number
  options?: Record<string, unknown>
}

export interface LogConfig {
  level: LogLevel
  structured?: boolean
}

export interface DecisionConfig {
  strategy: "planned" | "llm-every-turn" | "module-only"
  tacticalModel?: string
  maxPlanLength?: number
  moduleConfidenceThreshold?: number
  emergencyHpPercent?: number
  /**
   * After a realm clear, homing can override the tactical LLM for stability. After this many
   * consecutive overrides, one turn is left to the tactical planner so the model can re-assess.
   * @default 12
   */
  extractionHomingOverrideMaxStreak?: number
  /**
   * On floor 1 after a clear (not at `entrance_room_id`), prefer moving **west** until `left` is
   * blocked or stalled, then enter a one-shot `reassess` phase: no deterministic homing and no
   * automatic `use_portal` fallback so the tactical LLM can choose the next move. Most realms lay
   * their exit spine roughly west, so this is on by default; set `false` for realms where the
   * entrance is elsewhere.
   * @default true
   */
  extractionPreferLeftBiasExit?: boolean
  /**
   * During active play (realm not cleared, no visible enemies), prefer moving **east** (`right`)
   * to make forward progress instead of oscillating. Symmetric with `extractionPreferLeftBiasExit`
   * — the realm spine generally extends east from the entrance, so east-bias is the exploration
   * equivalent of west-bias retreat. On by default; set `false` for realms whose deeper rooms
   * live elsewhere.
   * @default true
   */
  explorationPreferRightBias?: boolean
  /**
   * During active play, the exploration module's east-bias recommendation can override the
   * tactical LLM for stability (same pattern as `extractionHomingOverrideMaxStreak`). After this
   * many consecutive overrides the tactical planner gets one turn to reassess.
   * @default 12
   */
  explorationHomingOverrideMaxStreak?: number
  /**
   * Number of recent action entries from `context.previousActions` that the planner serializes
   * into the LLM decision/planning prompt. A larger window helps the model recognize
   * multi-turn patterns (e.g. repeatedly bumping a locked door) and recall earlier observations
   * when deciding whether to backtrack. Capped by `MAX_HISTORY` in agent.ts.
   * @default 20
   */
  historyWindow?: number
}

export interface AgentConfig {
  apiUrl: string
  wsUrl: string
  realmTemplateId?: string
  characterClass?: string
  characterName?: string
  rerollStats?: StatRerollConfig
  realmProgression?: RealmProgressionConfig
  profile?: AgentProfileConfig
  skillTree?: SkillTreeConfig
  perks?: PerksConfig
  lobby?: LobbyConfig
  limits?: AgentLimitsConfig
  rerollOnDeath?: boolean
  llm: LLMConfig
  wallet: WalletConfig
  modules?: ModuleConfig[]
  chat?: ChatConfig
  logging?: LogConfig
  decision?: DecisionConfig
}

export function createDefaultConfig(
  overrides: Partial<AgentConfig>,
): AgentConfig {
  const llmOverrides: Partial<LLMConfig> = overrides.llm ?? {}
  const walletOverrides: Partial<WalletConfig> = overrides.wallet ?? {}
  const chatOverrides: Partial<ChatConfig> = overrides.chat ?? {}
  const loggingOverrides: Partial<LogConfig> = overrides.logging ?? {}
  const decisionOverrides: Partial<DecisionConfig> = overrides.decision ?? {}

  const config: AgentConfig = {
    apiUrl: overrides.apiUrl ?? "http://localhost:3001",
    wsUrl: overrides.wsUrl ?? "ws://localhost:3001",
    llm: {
      provider: llmOverrides.provider ?? "openrouter",
      apiKey: llmOverrides.apiKey ?? "",
      maxRetries: llmOverrides.maxRetries ?? 2,
      temperature: llmOverrides.temperature ?? 0.2,
    },
    wallet: {
      type: walletOverrides.type ?? "env",
      network: walletOverrides.network ?? "base",
    },
    rerollStats: {
      enabled: false,
    },
    realmProgression: {
      strategy: "auto",
      continueOnExtraction: true,
      onAllCompleted: "regenerate-last",
    },
    skillTree: {
      autoSpend: false,
      preferredNodes: [],
    },
    perks: {
      autoSpend: false,
      preferredPerks: [],
    },
    lobby: {
      innHealThreshold: 1,
      autoSellJunk: true,
      autoEquipUpgrades: true,
      buyPotionMinimum: 2,
      buyPortalScroll: true,
      useLLM: true,
    },
    limits: {
      spendingWindow: "total",
    },
    rerollOnDeath: overrides.rerollOnDeath ?? false,
    modules: overrides.modules ?? [],
    logging: {
      level: loggingOverrides.level ?? "info",
      structured: loggingOverrides.structured ?? false,
    },
    decision: {
      strategy: decisionOverrides.strategy ?? "planned",
      maxPlanLength: decisionOverrides.maxPlanLength ?? 10,
      moduleConfidenceThreshold: decisionOverrides.moduleConfidenceThreshold ?? 0.75,
      emergencyHpPercent: decisionOverrides.emergencyHpPercent ?? 0.2,
      extractionHomingOverrideMaxStreak: decisionOverrides.extractionHomingOverrideMaxStreak ?? 12,
      extractionPreferLeftBiasExit: decisionOverrides.extractionPreferLeftBiasExit ?? true,
      explorationPreferRightBias: decisionOverrides.explorationPreferRightBias ?? true,
      explorationHomingOverrideMaxStreak: decisionOverrides.explorationHomingOverrideMaxStreak ?? 12,
    },
  }

  if (overrides.realmTemplateId !== undefined) {
    config.realmTemplateId = overrides.realmTemplateId
  }

  if (overrides.characterClass !== undefined) {
    config.characterClass = overrides.characterClass
  }

  if (overrides.characterName !== undefined) {
    config.characterName = overrides.characterName
  }

  if (llmOverrides.model !== undefined) {
    config.llm.model = llmOverrides.model
  }

  if (llmOverrides.baseUrl !== undefined) {
    config.llm.baseUrl = llmOverrides.baseUrl
  }

  if (llmOverrides.structuredOutput !== undefined) {
    config.llm.structuredOutput = llmOverrides.structuredOutput
  }

  if (walletOverrides.privateKey !== undefined) {
    config.wallet.privateKey = walletOverrides.privateKey
  }

  if (walletOverrides.walletName !== undefined) {
    config.wallet.walletName = walletOverrides.walletName
  }

  if (walletOverrides.passphrase !== undefined) {
    config.wallet.passphrase = walletOverrides.passphrase
  }

  if (walletOverrides.chainId !== undefined) {
    config.wallet.chainId = walletOverrides.chainId
  }

  if (walletOverrides.vaultPath !== undefined) {
    config.wallet.vaultPath = walletOverrides.vaultPath
  }

  if (walletOverrides.accountIndex !== undefined) {
    config.wallet.accountIndex = walletOverrides.accountIndex
  }

  if (overrides.rerollStats !== undefined) {
    config.rerollStats = {
      enabled: overrides.rerollStats.enabled ?? true,
      ...(overrides.rerollStats.minStats ? { minStats: overrides.rerollStats.minStats } : {}),
      ...(overrides.rerollStats.minTotal !== undefined
        ? { minTotal: overrides.rerollStats.minTotal }
        : {}),
    }
  }

  if (overrides.realmProgression !== undefined) {
    config.realmProgression = {
      strategy: overrides.realmProgression.strategy,
      ...(overrides.realmProgression.templatePriority
        ? { templatePriority: [...overrides.realmProgression.templatePriority] }
        : {}),
      continueOnExtraction: overrides.realmProgression.continueOnExtraction ?? true,
      onAllCompleted: overrides.realmProgression.onAllCompleted ?? "regenerate-last",
    }
  }

  if (overrides.profile !== undefined) {
    config.profile = {
      ...(overrides.profile.handle !== undefined ? { handle: overrides.profile.handle } : {}),
      ...(overrides.profile.xHandle !== undefined ? { xHandle: overrides.profile.xHandle } : {}),
      ...(overrides.profile.githubHandle !== undefined
        ? { githubHandle: overrides.profile.githubHandle }
        : {}),
    }
  }

  if (overrides.skillTree !== undefined) {
    config.skillTree = {
      autoSpend: overrides.skillTree.autoSpend ?? true,
      preferredNodes: [...(overrides.skillTree.preferredNodes ?? [])],
    }
  }

  if (overrides.perks !== undefined) {
    config.perks = {
      autoSpend: overrides.perks.autoSpend ?? true,
      preferredPerks: [...(overrides.perks.preferredPerks ?? [])],
    }
  }

  if (overrides.lobby !== undefined) {
    config.lobby = {
      innHealThreshold: overrides.lobby.innHealThreshold ?? 1,
      autoSellJunk: overrides.lobby.autoSellJunk ?? true,
      autoEquipUpgrades: overrides.lobby.autoEquipUpgrades ?? true,
      buyPotionMinimum: overrides.lobby.buyPotionMinimum ?? 2,
      buyPortalScroll: overrides.lobby.buyPortalScroll ?? true,
      useLLM: overrides.lobby.useLLM ?? true,
    }
  }

  if (overrides.limits !== undefined) {
    config.limits = {
      ...(overrides.limits.maxRealms !== undefined
        ? { maxRealms: overrides.limits.maxRealms }
        : {}),
      ...(overrides.limits.maxRuntimeMinutes !== undefined
        ? { maxRuntimeMinutes: overrides.limits.maxRuntimeMinutes }
        : {}),
      ...(overrides.limits.maxSpendUsd !== undefined
        ? { maxSpendUsd: overrides.limits.maxSpendUsd }
        : {}),
      spendingWindow: overrides.limits.spendingWindow ?? "total",
    }
  }

  if (overrides.chat) {
    config.chat = {
      enabled: chatOverrides.enabled ?? false,
      banterFrequency:
        chatOverrides.banterFrequency ?? DEFAULT_BANTER_FREQUENCY_SECONDS,
      triggers: chatOverrides.triggers ?? [...DEFAULT_CHAT_TRIGGERS],
      maxHistoryLength:
        chatOverrides.maxHistoryLength ?? DEFAULT_CHAT_HISTORY_LENGTH,
    }

    if (chatOverrides.personality !== undefined) {
      config.chat.personality = chatOverrides.personality
    }
  }

  if (decisionOverrides.tacticalModel !== undefined) {
    config.decision!.tacticalModel = decisionOverrides.tacticalModel
  }

  return config
}
