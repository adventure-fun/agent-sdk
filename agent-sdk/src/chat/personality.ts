export type ChatTrigger =
  | "other_death"
  | "own_extraction"
  | "lobby_event"
  | "direct_mention"
  | "idle"

export interface ChatPersonality {
  name: string
  traits: string[]
  backstory?: string
  responseStyle?: string
  topics?: string[]
}

export interface ChatConfig {
  enabled: boolean
  personality?: ChatPersonality
  banterFrequency?: number
  triggers?: ChatTrigger[]
  maxHistoryLength?: number
}

export const DEFAULT_CHAT_TRIGGERS: ChatTrigger[] = [
  "other_death",
  "own_extraction",
  "lobby_event",
  "direct_mention",
  "idle",
]

export const DEFAULT_BANTER_FREQUENCY_SECONDS = 120
export const DEFAULT_CHAT_HISTORY_LENGTH = 20
export const DEFAULT_CHAT_SEND_INTERVAL_MS = 5_000
export const MAX_CHAT_MESSAGE_LENGTH = 500
