import type { LLMConfig } from "../../config.js"
import type { Action, CharacterClass, Observation, SanitizedChatMessage } from "../../protocol.js"
import type { MemorySnapshot, ModuleRecommendation } from "../../modules/index.js"
import type { ChatPersonality } from "../../chat/personality.js"
import { AnthropicAdapter } from "./anthropic.js"
import { OpenAIAdapter } from "./openai.js"
import { OpenRouterAdapter } from "./openrouter.js"

export interface HistoryEntry {
  turn: number
  action: Action
  reasoning: string
  observation_summary: string
}

export interface DecisionPrompt {
  observation: Observation
  moduleRecommendations: ModuleRecommendation[]
  legalActions: Action[]
  recentHistory: HistoryEntry[]
  systemPrompt: string
  memorySnapshot?: MemorySnapshot
}

export interface DecisionResult {
  action: Action
  reasoning: string
}

export interface PlannedAction {
  action: Action
  reasoning: string
}

export interface ActionPlan {
  strategy: string
  actions: PlannedAction[]
}

export interface PlanningPrompt {
  observation: Observation
  moduleRecommendations: ModuleRecommendation[]
  legalActions: Action[]
  recentHistory: HistoryEntry[]
  systemPrompt: string
  strategicContext?: string
  planType: "strategic" | "tactical"
  maxActions: number
  memorySnapshot?: MemorySnapshot
}

export interface ChatPrompt {
  recentMessages: SanitizedChatMessage[]
  personality: ChatPersonality
  trigger: string
  agentState: {
    characterName: string
    characterClass: CharacterClass
    currentHP: number
    maxHP: number
  }
  context?: string
  systemPrompt?: string
}

export interface LLMAdapter {
  name: string
  decide(prompt: DecisionPrompt): Promise<DecisionResult>
  plan?(prompt: PlanningPrompt): Promise<ActionPlan>
  chat?(prompt: ChatPrompt): Promise<string>
}
export type {
  ActionToolSchema,
  JsonSchemaProperty,
  LobbyActionPlan,
  LobbyActionStep,
  LobbyDecisionPrompt,
  PlanToolSchema,
  ToolCallResult,
} from "./shared.js"
export {
  buildActionToolSchema,
  buildCorrectionMessage,
  buildDecisionPrompt,
  buildLobbyDecisionPrompt,
  buildLobbySystemPrompt,
  buildPlanningPrompt,
  buildPlanningToolSchema,
  buildStrategicSystemPrompt,
  buildSystemPrompt,
  buildTacticalSystemPrompt,
  extractReasoning,
  parseActionPlanFromJSON,
  parseActionPlanFromText,
  parseActionFromJSON,
  parseActionFromText,
  parseAnyActionFromJSON,
  parseDecisionResult,
  parseDecisionResultFromText,
  parseLobbyActionPlanFromJSON,
  parseLobbyActionPlanFromText,
} from "./shared.js"

export { AnthropicAdapter } from "./anthropic.js"
export { OpenAIAdapter } from "./openai.js"
export { OpenRouterAdapter } from "./openrouter.js"
export type { AnthropicAdapterOptions } from "./anthropic.js"
export type { OpenAIAdapterOptions } from "./openai.js"
export type { OpenRouterAdapterOptions } from "./openrouter.js"

export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  switch (config.provider) {
    case "openrouter": {
      const options = {
        apiKey: config.apiKey,
        ...(config.model !== undefined ? { model: config.model } : {}),
        ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.structuredOutput !== undefined
          ? { structuredOutput: config.structuredOutput }
          : {}),
      }
      return new OpenRouterAdapter(options)
    }
    case "openai": {
      const options = {
        apiKey: config.apiKey,
        ...(config.model !== undefined ? { model: config.model } : {}),
        ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.structuredOutput !== undefined
          ? { structuredOutput: config.structuredOutput }
          : {}),
      }
      return new OpenAIAdapter(options)
    }
    case "anthropic": {
      const options = {
        apiKey: config.apiKey,
        ...(config.model !== undefined ? { model: config.model } : {}),
        ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.structuredOutput !== undefined
          ? { structuredOutput: config.structuredOutput }
          : {}),
      }
      return new AnthropicAdapter(options)
    }
    default: {
      const neverProvider: never = config.provider
      throw new Error(
        `Unsupported LLM provider: ${String(neverProvider)}. Supported providers: openrouter, openai, anthropic.`,
      )
    }
  }
}
