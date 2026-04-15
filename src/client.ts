import { wrapFetchWithPayment } from "@x402/fetch"
import type { x402Client as X402Client } from "@x402/core/client"
import type { WalletAdapter } from "./adapters/wallet/index.js"
import type { SessionToken } from "./auth.js"
import type {
  Action,
  CharacterClass,
  CharacterStats,
  ClientMessage,
  EquipSlot,
  InventoryItem,
  LobbyEvent,
  Observation,
  PaymentRequired402,
  SanitizedChatMessage,
  ServerMessage,
} from "./protocol.js"

export type ObservationHandler = (obs: Observation) => void
export type DeathHandler = (data: { cause: string; floor: number; room: string; turn: number }) => void
export type ExtractedHandler = (data: {
  loot_summary: Observation["inventory"]
  xp_gained: number
  gold_gained: number
  completion_bonus?: { xp: number; gold: number }
  realm_completed: boolean
}) => void

export type GameClientErrorKind = "network" | "game" | "payment" | "protocol"

export interface AgentAccountProfile {
  handle?: string | null
  x_handle?: string | null
  github_handle?: string | null
}

export interface UpdateProfileInput {
  handle?: string
  xHandle?: string
  githubHandle?: string
}

export interface AgentCharacter {
  id: string
  account_id?: string
  name: string
  class: CharacterClass
  level?: number
  xp?: number
  gold?: number
  stats?: CharacterStats
  hp_current?: number
  hp_max?: number
  resource_current?: number
  resource_max?: number
  status?: string
  stat_rerolled?: boolean
  skill_tree?: Record<string, boolean>
}

export interface CharacterProgression {
  level: number
  xp: number
  xp_to_next_level: number
  xp_for_next_level: number
  skill_points: number
  skill_tree_template: Record<string, unknown> | null
  skill_tree_unlocked: Record<string, boolean>
}

export interface RealmSummary {
  id: string
  template_id?: string
  status?: string
}

export interface RealmListResponse {
  realms: RealmSummary[]
}

export interface RealmTemplateSummary {
  id: string
  orderIndex: number
  name: string
  description?: string
  theme?: string
  difficulty_tier?: number
  floor_count?: number
  is_tutorial?: boolean
}

export interface RealmTemplateListResponse {
  templates: RealmTemplateSummary[]
}

export interface ShopCatalogItem {
  id: string
  name: string
  description?: string
  type?: string
  rarity?: string
  equip_slot?: EquipSlot | null
  class_restriction?: string | null
  stats?: Record<string, number>
  effects?: Array<Record<string, unknown>>
  stack_limit?: number
  sell_price?: number
  buy_price?: number
  ammo_type?: string | null
}

export interface ItemTemplateSummary extends ShopCatalogItem {
  type: string
  rarity: string
  stack_limit: number
  sell_price: number
  buy_price: number
}

export interface ItemTemplateListResponse {
  items: ItemTemplateSummary[]
}

export interface ShopCatalogResponse {
  sections: Array<{
    id?: string
    title?: string
    label?: string
    items: ShopCatalogItem[]
  }>
  featured: ShopCatalogItem[]
}

export interface LobbyInventoryResponse {
  gold: number
  inventory: InventoryItem[]
}

export interface LobbyBuyResponse {
  gold: number
  item: InventoryItem
  message: string
}

export interface LobbySellResponse {
  gold: number
  sold: {
    item_id: string
    template_id: string
    quantity: number
    total_gold: number
  }
  message: string
}

export interface LobbyDiscardResponse {
  message: string
}

export interface LobbyEquipmentResponse {
  inventory: InventoryItem[]
  message: string
}

export interface LobbyConsumableResponse {
  message: string
}

export interface InnRestResponse {
  hp_current: number
  hp_max: number
  resource_current: number
  resource_max: number
  message: string
}

export interface GameClientOptions {
  reconnect?: {
    maxRetries?: number
    backoffMs?: number
    maxDelayMs?: number
  }
  wallet?: WalletAdapter
  x402Client?: X402Client
}

export interface DisconnectEvent {
  code: number
  reason: string
  intentional: boolean
  scope: "game" | "lobby"
  // True when the client has scheduled another reconnect attempt after this
  // close. Agents should typically treat these as transient and keep the run
  // alive; the `reconnectExhausted` event fires separately once retries run
  // out so that higher layers can fail the run on a single terminal signal.
  willReconnect: boolean
}

export interface ReconnectingEvent {
  scope: "game"
  realmId: string
  attempt: number
  maxAttempts: number
  delayMs: number
}

export interface ReconnectExhaustedEvent {
  scope: "game"
  realmId: string
  attempts: number
  lastError?: GameClientError
}

export interface ConnectEvent {
  scope: "game" | "lobby"
  realmId?: string
  // True when this connect is the result of a successful reconnect attempt
  // after an unexpected close, as opposed to the initial connect(). Agents
  // can use this to reset per-run state that was in flight when the socket
  // dropped (e.g. clear an action-in-flight flag and wait for a fresh
  // initial observation from the server's handleGameOpen).
  reconnected?: boolean
}

export interface GameSessionHandlers {
  onObservation?: ObservationHandler
  onDeath?: DeathHandler
  onExtracted?: ExtractedHandler
  onError?: (error: GameClientError) => void
  onClose?: (event: DisconnectEvent) => void
  // Fired while the client is retrying. onClose still fires with
  // willReconnect: true for the same disconnect — this is the forward-looking
  // notification agents use to pause action dispatch between attempts.
  onReconnecting?: (event: ReconnectingEvent) => void
  // Fired exactly once per realm connection when every reconnect attempt has
  // failed and the client has given up. This is the terminal signal agents
  // should wire their failRun() path to; treat onClose with
  // willReconnect=false OR onReconnectExhausted as "session is over."
  onReconnectExhausted?: (event: ReconnectExhaustedEvent) => void
  // Fired on successful reconnect after an unexpected close. Agents can use
  // this to clear any in-flight action state — the server sends a fresh
  // initial observation on handleGameOpen, which will arrive shortly after.
  onReconnected?: (event: ConnectEvent) => void
}

export interface LobbyHandlers {
  onChatMessage?: (message: SanitizedChatMessage) => void
  onLobbyEvent?: (event: LobbyEvent) => void
  onError?: (error: GameClientError) => void
  onClose?: (event: DisconnectEvent) => void
}

export interface GameClientEvents {
  observation: Observation
  death: { cause: string; floor: number; room: string; turn: number }
  extracted: {
    loot_summary: Observation["inventory"]
    xp_gained: number
    gold_gained: number
    completion_bonus?: { xp: number; gold: number }
    realm_completed: boolean
  }
  error: GameClientError
  connected: ConnectEvent
  disconnected: DisconnectEvent
  reconnecting: ReconnectingEvent
  reconnectExhausted: ReconnectExhaustedEvent
  chatMessage: SanitizedChatMessage
  lobbyEvent: LobbyEvent
}

type EventName = keyof GameClientEvents
type EventHandler<K extends EventName> = (payload: GameClientEvents[K]) => void
type RequestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

class TypedEventEmitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<(payload: unknown) => void>>()

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    const handlers = this.listeners.get(event) ?? new Set<(payload: unknown) => void>()
    handlers.add(handler as (payload: unknown) => void)
    this.listeners.set(event, handlers)
  }

  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    this.listeners.get(event)?.delete(handler as (payload: unknown) => void)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(payload)
    }
  }
}

export class GameClientError extends Error {
  status: number | undefined
  paymentRequired: PaymentRequired402 | null | undefined
  bodyText: string | undefined
  override cause: unknown

  constructor(
    readonly kind: GameClientErrorKind,
    message: string,
    options: {
      status?: number
      paymentRequired?: PaymentRequired402 | null
      bodyText?: string
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = "GameClientError"
    this.status = options.status
    this.paymentRequired = options.paymentRequired
    this.bodyText = options.bodyText
    this.cause = options.cause
  }
}

type LobbyLiveMessage =
  | { type: "connected"; channel: "lobby" }
  | { type: "lobby_chat"; data: SanitizedChatMessage }
  | { type: "lobby_activity"; data: LobbyEvent }
  | { type: "leaderboard_update"; data: unknown }

export class GameClient {
  private ws: WebSocket | null = null
  private lobbyWs: WebSocket | null = null
  private token: SessionToken
  private wallet: WalletAdapter | undefined
  private activeRealmId: string | null = null
  private reconnectAttempt = 0
  private lastReconnectError: GameClientError | undefined
  private intentionalGameDisconnect = false
  private intentionalLobbyDisconnect = false
  private reconnectConfig: Required<NonNullable<GameClientOptions["reconnect"]>>
  private readonly paymentClient: X402Client | undefined
  private readonly requestFetch: RequestFetch
  private eventEmitter = new TypedEventEmitter<GameClientEvents>()
  private gameHandlers: GameSessionHandlers = {}
  private lobbyHandlers: LobbyHandlers = {}

  constructor(
    private baseUrl: string,
    private wsUrl: string,
    token: SessionToken,
    options: GameClientOptions = {},
  ) {
    this.token = token
    this.wallet = options.wallet
    this.paymentClient = options.x402Client
    this.reconnectConfig = {
      // 8 tries × 250ms base with exponential backoff + jitter caps out
      // around 60s of total wait. That's enough to survive a backend
      // restart, a brief Railway edge hiccup, or a DB blip without the
      // agent giving up on the run. The old defaults (3 × 500ms ~ 3.5s)
      // were too short to cover any of those and caused the agent to
      // immediately failRun on transient closes.
      maxRetries: options.reconnect?.maxRetries ?? 8,
      backoffMs: options.reconnect?.backoffMs ?? 250,
      maxDelayMs: options.reconnect?.maxDelayMs ?? 30_000,
    }
    // Cast through `Parameters<typeof wrapFetchWithPayment>[1]` so the call typechecks
    // against whichever copy of `@x402/core` `@x402/fetch` resolves at install time.
    // In the standalone agent-sdk repo, `@x402/fetch` ships with a nested copy of
    // `@x402/core` whose `x402Client` class has a private field that makes it nominally
    // distinct from the top-level `@x402/core` copy we import directly. Structurally the
    // types are identical and the runtime call is fine — we just need to bypass TS's
    // nominal check on the private field.
    type WrapPaymentClient = Parameters<typeof wrapFetchWithPayment>[1]
    this.requestFetch = options.x402Client
      ? wrapFetchWithPayment(fetch, options.x402Client as unknown as WrapPaymentClient)
      : fetch
  }

  get sessionToken(): string {
    return this.token.token
  }

  on<K extends EventName>(event: K, handler: EventHandler<K>): void {
    this.eventEmitter.on(event, handler)
  }

  off<K extends EventName>(event: K, handler: EventHandler<K>): void {
    this.eventEmitter.off(event, handler)
  }

  /** Opens a WebSocket game session for a realm instance */
  connect(
    realmId: string,
    handlers: GameSessionHandlers = {},
  ): Promise<void> {
    this.activeRealmId = realmId
    this.gameHandlers = handlers
    this.intentionalGameDisconnect = false
    return this.openGameSocket(realmId)
  }

  connectLobby(handlers: LobbyHandlers = {}): Promise<void> {
    this.lobbyHandlers = handlers
    this.intentionalLobbyDisconnect = false

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}/lobby/live`)
      let opened = false

      this.lobbyWs = ws

      ws.onopen = () => {
        opened = true
        this.eventEmitter.emit("connected", { scope: "lobby" })
        resolve()
      }

      ws.onerror = (event) => {
        const error = new GameClientError(
          "network",
          "Lobby WebSocket connection failed",
          { cause: event },
        )
        this.handleError(error, this.lobbyHandlers)
        if (!opened) {
          reject(error)
        }
      }

      ws.onclose = (event) => {
        this.lobbyWs = null
        const disconnectEvent: DisconnectEvent = {
          code: event.code,
          reason: event.reason,
          intentional: this.intentionalLobbyDisconnect,
          scope: "lobby",
          // Lobby socket has no reconnect loop today; always terminal.
          willReconnect: false,
        }
        this.eventEmitter.emit("disconnected", disconnectEvent)
        this.lobbyHandlers.onClose?.(disconnectEvent)
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as LobbyLiveMessage
          switch (message.type) {
            case "connected":
              break
            case "lobby_chat":
              this.eventEmitter.emit("chatMessage", message.data)
              this.lobbyHandlers.onChatMessage?.(message.data)
              break
            case "lobby_activity":
              this.eventEmitter.emit("lobbyEvent", message.data)
              this.lobbyHandlers.onLobbyEvent?.(message.data)
              break
            case "leaderboard_update":
              break
            default: {
              const unknownMessage: never = message
              throw new Error(`Unsupported lobby message: ${String(unknownMessage)}`)
            }
          }
        } catch (error) {
          this.handleError(
            new GameClientError(
              "protocol",
              "Failed to parse lobby message",
              { cause: error },
            ),
            this.lobbyHandlers,
          )
        }
      }
    })
  }

  sendAction(action: Action): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new GameClientError("network", "WebSocket not connected")
    }
    const payload: ClientMessage = { type: "action", data: action }
    this.ws.send(JSON.stringify(payload))
  }

  disconnect(): void {
    this.intentionalGameDisconnect = true
    this.intentionalLobbyDisconnect = true
    this.activeRealmId = null
    this.ws?.close()
    this.lobbyWs?.close()
    this.ws = null
    this.lobbyWs = null
  }

  disconnectLobby(): void {
    this.intentionalLobbyDisconnect = true
    this.lobbyWs?.close()
    this.lobbyWs = null
  }

  async getCurrentCharacter(): Promise<AgentCharacter> {
    return this.request("/characters/me")
  }

  async rollCharacter(input: { class: string; name: string }): Promise<AgentCharacter> {
    return this.request("/characters/roll", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  async rerollCharacterStats(): Promise<AgentCharacter> {
    return this.request("/characters/reroll-stats", {
      method: "POST",
      body: JSON.stringify({}),
    })
  }

  async getCharacterProgression(): Promise<CharacterProgression> {
    return this.request("/characters/progression")
  }

  async unlockCharacterSkill(nodeId: string): Promise<AgentCharacter> {
    return this.request("/characters/skill", {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId }),
    })
  }

  async updateProfile(input: UpdateProfileInput): Promise<AgentAccountProfile> {
    return this.request("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify({
        ...(input.handle !== undefined ? { handle: input.handle } : {}),
        ...(input.xHandle !== undefined ? { x_handle: input.xHandle } : {}),
        ...(input.githubHandle !== undefined ? { github_handle: input.githubHandle } : {}),
      }),
    })
  }

  async getMyRealms(): Promise<RealmListResponse> {
    return this.request("/realms/mine")
  }

  async getRealmTemplates(): Promise<RealmTemplateListResponse> {
    return this.request("/content/realms")
  }

  async getItemTemplates(): Promise<ItemTemplateListResponse> {
    return this.request("/content/items")
  }

  async generateRealm(templateId: string): Promise<RealmSummary> {
    return this.request("/realms/generate", {
      method: "POST",
      body: JSON.stringify({ template_id: templateId }),
    })
  }

  async regenerateRealm(realmId: string): Promise<RealmSummary> {
    return this.request(`/realms/${realmId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({}),
    })
  }

  async getLobbyShops(): Promise<ShopCatalogResponse> {
    return this.request("/lobby/shops")
  }

  async getLobbyInventory(): Promise<LobbyInventoryResponse> {
    return this.request("/lobby/shop/inventory")
  }

  async buyShopItem(input: { itemId: string; quantity?: number }): Promise<LobbyBuyResponse> {
    return this.request("/lobby/shop/buy", {
      method: "POST",
      body: JSON.stringify({
        item_id: input.itemId,
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      }),
    })
  }

  async sellShopItem(input: { itemId: string; quantity?: number }): Promise<LobbySellResponse> {
    return this.request("/lobby/shop/sell", {
      method: "POST",
      body: JSON.stringify({
        item_id: input.itemId,
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      }),
    })
  }

  async discardLobbyItem(itemId: string): Promise<LobbyDiscardResponse> {
    return this.request("/lobby/discard", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
  }

  async equipLobbyItem(itemId: string): Promise<LobbyEquipmentResponse> {
    return this.request("/lobby/equip", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
  }

  async unequipLobbySlot(slot: EquipSlot): Promise<LobbyEquipmentResponse> {
    return this.request("/lobby/unequip", {
      method: "POST",
      body: JSON.stringify({ slot }),
    })
  }

  async useLobbyConsumable(itemId: string): Promise<LobbyConsumableResponse> {
    return this.request("/lobby/use-consumable", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    })
  }

  async restAtInn(): Promise<InnRestResponse> {
    return this.request("/lobby/inn/rest", {
      method: "POST",
      body: JSON.stringify({}),
    })
  }

  /** REST helper with auth header */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let res: Response
    const headers = new Headers(options.headers)
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }
    headers.set("Authorization", `Bearer ${this.token.token}`)

    const walletNetwork = this.wallet?.getNetwork()
    if (walletNetwork && !headers.has("X-Payment-Network")) {
      headers.set("X-Payment-Network", walletNetwork)
    }

    try {
      res = await this.requestFetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
      })
    } catch (error) {
      throw this.toRequestError(path, error)
    }

    if (res.status === 402) {
      throw new GameClientError("payment", "Payment required", {
        status: 402,
        paymentRequired: await this.readPaymentRequired(res),
      })
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "")
      const suffix = bodyText ? ` — ${bodyText.slice(0, 300)}` : ""
      throw new GameClientError(
        "game",
        `Request failed: ${options.method ?? "GET"} ${path} → ${res.status} ${res.statusText}${suffix}`,
        { status: res.status, bodyText },
      )
    }

    if (res.status === 204) {
      return undefined as T
    }

    const body = await res.text()
    if (!body) {
      return undefined as T
    }

    return JSON.parse(body) as T
  }

  private toRequestError(path: string, error: unknown): GameClientError {
    if (error instanceof GameClientError) {
      return error
    }

    if (
      this.paymentClient &&
      error instanceof Error &&
      !(error instanceof TypeError)
    ) {
      return new GameClientError(
        "payment",
        `x402 payment flow failed for ${path}`,
        { cause: error },
      )
    }

    return new GameClientError("network", `Network request failed for ${path}`, {
      cause: error,
    })
  }

  // Ticket auth: some reverse proxies (Railway's edge) strip Sec-WebSocket-Protocol
  // during WS upgrades, which breaks the subprotocol-based token auth path. This
  // mints a short-lived single-use ticket over plain HTTPS (where proxies leave
  // the Authorization header alone) and then uses ?ticket= on the WS URL. Falls
  // back to null if the backend doesn't know the endpoint (e.g. local stub API),
  // so local dev keeps working on the subprotocol path below.
  private async fetchWsTicket(): Promise<string | null> {
    try {
      const response = await this.request<{ ticket: string; expires_in: number }>(
        "/auth/ws-ticket",
        { method: "POST", body: JSON.stringify({}) },
      )
      return response?.ticket ?? null
    } catch {
      return null
    }
  }

  private async openGameSocket(realmId: string): Promise<void> {
    const ticket = await this.fetchWsTicket()
    return new Promise((resolve, reject) => {
      const wsUrl = ticket
        ? `${this.wsUrl}/realms/${realmId}/enter?ticket=${encodeURIComponent(ticket)}`
        : `${this.wsUrl}/realms/${realmId}/enter`
      const ws = ticket
        ? new WebSocket(wsUrl)
        : new WebSocket(wsUrl, ["Bearer", this.token.token])
      let opened = false

      this.ws = ws

      ws.onopen = () => {
        opened = true
        const wasReconnecting = this.reconnectAttempt > 0
        this.reconnectAttempt = 0
        this.lastReconnectError = undefined
        const connectEvent: ConnectEvent = {
          scope: "game",
          realmId,
          reconnected: wasReconnecting,
        }
        this.eventEmitter.emit("connected", connectEvent)
        if (wasReconnecting) {
          this.gameHandlers.onReconnected?.(connectEvent)
        }
        resolve()
      }

      ws.onerror = (event) => {
        // Ignore late error events from stale WebSocket instances. If `this.ws` no longer
        // points at this socket, the agent has already moved on to a new realm (or
        // disconnected entirely) — emitting against the new state would corrupt the next run.
        if (this.ws !== ws) {
          return
        }
        const error = new GameClientError(
          "network",
          "WebSocket connection failed",
          { cause: event },
        )
        this.handleError(error, this.gameHandlers)
        if (!opened) {
          reject(error)
        }
      }

      ws.onclose = (event) => {
        // Same stale-socket guard as onerror. A previous realm's WebSocket can fire its
        // close event after `connect()` has been called for the next realm — its handlers
        // would otherwise see a fresh `intentionalGameDisconnect=false` and trigger a
        // reconnect or fail the next run by mistake.
        const isStale = this.ws !== ws
        if (isStale) {
          return
        }

        // Decide whether this close is going to be followed by a reconnect
        // BEFORE firing onClose — the agent's onClose handler inspects
        // willReconnect to decide whether to fail the run or just pause. The
        // previous implementation fired onClose first and then scheduled the
        // reconnect, which meant the agent immediately called failRun on any
        // unexpected close even when a retry was in the pipeline.
        const shouldReconnect =
          !this.intentionalGameDisconnect &&
          this.activeRealmId != null &&
          this.reconnectAttempt < this.reconnectConfig.maxRetries

        const disconnectEvent: DisconnectEvent = {
          code: event.code,
          reason: event.reason,
          intentional: this.intentionalGameDisconnect,
          scope: "game",
          willReconnect: shouldReconnect,
        }

        this.ws = null
        this.eventEmitter.emit("disconnected", disconnectEvent)
        this.gameHandlers.onClose?.(disconnectEvent)

        if (shouldReconnect) {
          this.scheduleReconnect()
        } else if (!this.intentionalGameDisconnect && this.reconnectAttempt > 0) {
          // We were mid-reconnect and just used up our last attempt: fire
          // the single terminal signal the agent waits on before failing
          // the run. The reconnectAttempt > 0 guard avoids emitting on the
          // very first unexpected close (which schedules a retry instead).
          this.emitReconnectExhausted()
        }
      }

      ws.onmessage = (event) => {
        // Stale-socket guard: drop messages buffered on a previous realm's WebSocket.
        if (this.ws !== ws) {
          return
        }
        try {
          const msg = JSON.parse(String(event.data)) as ServerMessage
          switch (msg.type) {
            case "observation":
              this.eventEmitter.emit("observation", msg.data)
              this.gameHandlers.onObservation?.(msg.data)
              break
            case "death":
              this.eventEmitter.emit("death", msg.data)
              this.gameHandlers.onDeath?.(msg.data)
              break
            case "extracted":
              this.eventEmitter.emit("extracted", msg.data)
              this.gameHandlers.onExtracted?.(msg.data)
              break
            case "error":
              this.handleError(new GameClientError("game", msg.message), this.gameHandlers)
              break
          }
        } catch (error) {
          this.handleError(
            new GameClientError(
              "protocol",
              "Failed to parse game server message",
              { cause: error },
            ),
            this.gameHandlers,
          )
        }
      }
    })
  }

  private scheduleReconnect(): void {
    if (!this.activeRealmId) {
      return
    }

    this.reconnectAttempt += 1
    // Exponential backoff with jitter, clamped to maxDelayMs. The jitter
    // (±50% of base) prevents all agents in a fleet from slamming the
    // server at the same wall-clock instant after a shared hiccup.
    const baseDelay = this.reconnectConfig.backoffMs * 2 ** (this.reconnectAttempt - 1)
    const jittered = baseDelay * (0.5 + Math.random())
    const delay = Math.min(jittered, this.reconnectConfig.maxDelayMs)

    const reconnectingEvent: ReconnectingEvent = {
      scope: "game",
      realmId: this.activeRealmId,
      attempt: this.reconnectAttempt,
      maxAttempts: this.reconnectConfig.maxRetries,
      delayMs: Math.round(delay),
    }
    this.eventEmitter.emit("reconnecting", reconnectingEvent)
    this.gameHandlers.onReconnecting?.(reconnectingEvent)

    setTimeout(() => {
      if (!this.activeRealmId || this.intentionalGameDisconnect) {
        return
      }

      void this.openGameSocket(this.activeRealmId).catch((error) => {
        const normalized = error instanceof GameClientError
          ? error
          : new GameClientError(
              "network",
              "Failed to reconnect WebSocket",
              { cause: error },
            )
        this.lastReconnectError = normalized
        this.handleError(normalized, this.gameHandlers)

        // If there are still retries left, onclose on the just-failed socket
        // will have fired scheduleReconnect again — we've already handled the
        // error above, so just return. If we've hit the cap, fire the
        // terminal reconnectExhausted event so the agent can finally fail
        // the run with a single meaningful signal.
        if (this.reconnectAttempt >= this.reconnectConfig.maxRetries) {
          this.emitReconnectExhausted()
        }
      })
    }, delay)
  }

  private emitReconnectExhausted(): void {
    if (!this.activeRealmId) return
    const event: ReconnectExhaustedEvent = {
      scope: "game",
      realmId: this.activeRealmId,
      attempts: this.reconnectAttempt,
      ...(this.lastReconnectError ? { lastError: this.lastReconnectError } : {}),
    }
    this.eventEmitter.emit("reconnectExhausted", event)
    this.gameHandlers.onReconnectExhausted?.(event)
  }

  private handleError(
    error: GameClientError,
    handlers: Pick<GameSessionHandlers, "onError"> | Pick<LobbyHandlers, "onError">,
  ): void {
    this.eventEmitter.emit("error", error)
    handlers.onError?.(error)
  }

  private async readPaymentRequired(res: Response): Promise<PaymentRequired402 | null> {
    const paymentHeader = res.headers.get("PAYMENT-REQUIRED")
    if (!paymentHeader) {
      try {
        const body = (await res.clone().json()) as Partial<PaymentRequired402>
        if (body.x402Version === 2 && Array.isArray(body.accepts)) {
          return body as PaymentRequired402
        }
      } catch {
        return null
      }

      return null
    }

    try {
      return JSON.parse(atob(paymentHeader)) as PaymentRequired402
    } catch {
      return null
    }
  }
}
