import type { LLMAdapter } from "../adapters/llm/index.js"
import type { GameClient } from "../client.js"
import type { LobbyEvent, SanitizedChatMessage } from "../protocol.js"
import {
  DEFAULT_CHAT_HISTORY_LENGTH,
  DEFAULT_CHAT_SEND_INTERVAL_MS,
  MAX_CHAT_MESSAGE_LENGTH,
  type ChatConfig,
} from "./personality.js"

type ChatClient = Pick<
  GameClient,
  "connectLobby" | "request" | "disconnectLobby" | "on" | "off"
>

export interface ChatManagerEvents {
  chatMessage: SanitizedChatMessage
  lobbyEvent: LobbyEvent
}

export interface ChatManagerOptions {
  selfCharacterName?: string
  minSendIntervalMs?: number
  now?: () => number
  dedupeCacheSize?: number
}

type ChatEventName = keyof ChatManagerEvents
type ChatEventHandler<K extends ChatEventName> = (payload: ChatManagerEvents[K]) => void

class ChatEventEmitter {
  private listeners = new Map<ChatEventName, Set<(payload: unknown) => void>>()

  on<K extends ChatEventName>(event: K, handler: ChatEventHandler<K>): void {
    const handlers = this.listeners.get(event) ?? new Set<(payload: unknown) => void>()
    handlers.add(handler as (payload: unknown) => void)
    this.listeners.set(event, handlers)
  }

  off<K extends ChatEventName>(event: K, handler: ChatEventHandler<K>): void {
    this.listeners.get(event)?.delete(handler as (payload: unknown) => void)
  }

  emit<K extends ChatEventName>(event: K, payload: ChatManagerEvents[K]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(payload)
    }
  }
}

export class ChatManager {
  private readonly eventEmitter = new ChatEventEmitter()
  private readonly recentMessages: SanitizedChatMessage[] = []
  private readonly seenFingerprints = new Set<string>()
  private readonly fingerprintQueue: string[] = []
  private readonly minSendIntervalMs: number
  private readonly now: () => number
  private readonly dedupeCacheSize: number
  private connected = false
  private lastSentAt = Number.NEGATIVE_INFINITY

  private readonly handleChatMessageBound = (message: SanitizedChatMessage) => {
    this.handleChatMessage(message)
  }

  private readonly handleLobbyEventBound = (event: LobbyEvent) => {
    this.eventEmitter.emit("lobbyEvent", event)
  }

  constructor(
    private readonly client: ChatClient,
    private readonly config: ChatConfig,
    readonly llmAdapter?: LLMAdapter,
    private readonly options: ChatManagerOptions = {},
  ) {
    this.minSendIntervalMs = options.minSendIntervalMs ?? DEFAULT_CHAT_SEND_INTERVAL_MS
    this.now = options.now ?? (() => Date.now())
    this.dedupeCacheSize = options.dedupeCacheSize ?? 200
  }

  get isConnected(): boolean {
    return this.connected
  }

  getRecentMessages(): readonly SanitizedChatMessage[] {
    return this.recentMessages
  }

  on<K extends ChatEventName>(event: K, handler: ChatEventHandler<K>): void {
    this.eventEmitter.on(event, handler)
  }

  off<K extends ChatEventName>(event: K, handler: ChatEventHandler<K>): void {
    this.eventEmitter.off(event, handler)
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    this.client.on("chatMessage", this.handleChatMessageBound)
    this.client.on("lobbyEvent", this.handleLobbyEventBound)

    try {
      await this.client.connectLobby()
      this.connected = true
    } catch (error) {
      this.client.off("chatMessage", this.handleChatMessageBound)
      this.client.off("lobbyEvent", this.handleLobbyEventBound)
      throw error
    }
  }

  async sendMessage(message: string): Promise<void> {
    const sanitized = sanitizeOutgoingMessage(message)
    if (sanitized.length === 0) {
      throw new Error("Chat message cannot be empty")
    }
    if (sanitized.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new Error(`Chat message exceeds ${MAX_CHAT_MESSAGE_LENGTH} characters`)
    }

    const now = this.now()
    if (now - this.lastSentAt < this.minSendIntervalMs) {
      throw new Error("Chat message rate limited by SDK client")
    }

    await this.client.request<{ ok: true }>("/lobby/chat", {
      method: "POST",
      body: JSON.stringify({ message: sanitized }),
    })
    this.lastSentAt = now
  }

  disconnect(): void {
    this.connected = false
    this.client.off("chatMessage", this.handleChatMessageBound)
    this.client.off("lobbyEvent", this.handleLobbyEventBound)
    this.client.disconnectLobby()
  }

  private handleChatMessage(message: SanitizedChatMessage): void {
    if (
      this.options.selfCharacterName &&
      message.character_name === this.options.selfCharacterName
    ) {
      return
    }

    const fingerprint = [
      message.timestamp,
      message.character_name,
      message.message,
    ].join(":")
    if (this.seenFingerprints.has(fingerprint)) {
      return
    }

    this.seenFingerprints.add(fingerprint)
    this.fingerprintQueue.push(fingerprint)
    if (this.fingerprintQueue.length > this.dedupeCacheSize) {
      const expired = this.fingerprintQueue.shift()
      if (expired) {
        this.seenFingerprints.delete(expired)
      }
    }

    this.recentMessages.push(message)
    const maxHistoryLength = this.config.maxHistoryLength ?? DEFAULT_CHAT_HISTORY_LENGTH
    while (this.recentMessages.length > maxHistoryLength) {
      this.recentMessages.shift()
    }

    this.eventEmitter.emit("chatMessage", message)
  }
}

function sanitizeOutgoingMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ")
}

export * from "./personality.js"
export { BanterEngine } from "./banter.js"
