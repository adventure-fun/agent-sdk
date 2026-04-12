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

export interface RealmProgressionConfig {
  strategy: "regenerate" | "new-realm" | "stop"
  templatePriority?: string[]
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
      strategy: "regenerate",
    },
    skillTree: {
      autoSpend: false,
      preferredNodes: [],
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
