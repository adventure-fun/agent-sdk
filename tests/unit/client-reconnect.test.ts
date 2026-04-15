import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { GameClient, type DisconnectEvent, type ReconnectExhaustedEvent, type ReconnectingEvent, type ConnectEvent } from "../../src/client.js"

// Minimal mock WebSocket that lets the test drive onopen/onclose/onerror/onmessage.
// Installed as the global WebSocket before each test so GameClient.openGameSocket
// can `new WebSocket(...)` against it.
class MockWebSocket {
  static instances: MockWebSocket[] = []
  static autoOpen = false
  url: string
  protocols?: string | string[]
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  readyState = 0
  CONNECTING = 0
  OPEN = 1
  CLOSING = 2
  CLOSED = 3

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    MockWebSocket.instances.push(this)
    if (MockWebSocket.autoOpen) {
      // Open on the next microtask so the caller finishes wiring handlers first.
      queueMicrotask(() => this.fireOpen())
    }
  }

  send(_data: string): void {}
  close(_code?: number, _reason?: string): void {
    this.readyState = 3
    queueMicrotask(() => this.fireClose(1000, "client closed"))
  }

  fireOpen(): void {
    this.readyState = 1
    this.onopen?.(new Event("open"))
  }

  fireClose(code: number, reason: string): void {
    this.readyState = 3
    const event = { code, reason, wasClean: false } as unknown as CloseEvent
    this.onclose?.(event)
  }

  fireError(): void {
    this.onerror?.(new Event("error"))
  }
}

const ORIGINAL_WS = globalThis.WebSocket
const ORIGINAL_FETCH = globalThis.fetch

function installMockWebSocket(): void {
  // Bun's WebSocket constructor is nominally typed; assigning our mock as
  // `typeof WebSocket` requires an unknown cast.
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
}

function makeClient(overrides?: Parameters<typeof GameClient>[3]): GameClient {
  return new GameClient(
    "https://api.example.com",
    "wss://api.example.com",
    { token: "session-token", expires_at: Date.now() + 60_000 },
    {
      reconnect: { maxRetries: 3, backoffMs: 1, maxDelayMs: 2 },
      ...overrides,
    },
  )
}

describe("GameClient reconnection flow", () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    MockWebSocket.autoOpen = false
    installMockWebSocket()
    // Stub /auth/ws-ticket to return null so openGameSocket uses the
    // subprotocol path (no extra async work, no real fetch).
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })) as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.WebSocket = ORIGINAL_WS
    globalThis.fetch = ORIGINAL_FETCH
  })

  it("marks an unexpected close with willReconnect=true when retries remain", async () => {
    MockWebSocket.autoOpen = true
    const client = makeClient()
    const closes: DisconnectEvent[] = []

    const connectPromise = client.connect("realm-1", {
      onClose: (event) => closes.push(event),
    })

    // Wait for the initial socket to auto-open and resolve connect().
    await connectPromise
    expect(MockWebSocket.instances).toHaveLength(1)
    const firstSocket = MockWebSocket.instances[0]!

    // Prevent the auto-open behavior from firing on the retry so we can
    // assert willReconnect on the first close deterministically.
    MockWebSocket.autoOpen = false

    firstSocket.fireClose(1006, "abnormal")

    expect(closes).toHaveLength(1)
    const [closeEvent] = closes
    expect(closeEvent!.intentional).toBe(false)
    expect(closeEvent!.willReconnect).toBe(true)
    expect(closeEvent!.code).toBe(1006)

    client.disconnect()
  })

  it("fires onReconnecting → onReconnected on a successful retry", async () => {
    MockWebSocket.autoOpen = true
    const client = makeClient()
    const reconnecting: ReconnectingEvent[] = []
    const reconnected: ConnectEvent[] = []
    const exhausted: ReconnectExhaustedEvent[] = []

    await client.connect("realm-1", {
      onReconnecting: (event) => reconnecting.push(event),
      onReconnected: (event) => reconnected.push(event),
      onReconnectExhausted: (event) => exhausted.push(event),
    })
    const firstSocket = MockWebSocket.instances[0]!
    firstSocket.fireClose(1006, "abnormal")

    // onReconnecting fires synchronously from scheduleReconnect — assert
    // immediately, before the setTimeout fires the next openGameSocket.
    expect(reconnecting).toHaveLength(1)
    expect(reconnecting[0]!.attempt).toBe(1)
    expect(reconnecting[0]!.maxAttempts).toBe(3)

    // Wait long enough for the backoff timer (1ms) + microtasks to settle
    // and the replacement socket to auto-open.
    await new Promise((r) => setTimeout(r, 20))

    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2)
    expect(reconnected).toHaveLength(1)
    expect(reconnected[0]!.reconnected).toBe(true)
    expect(exhausted).toHaveLength(0)

    client.disconnect()
  })

  it("retries connectLobby on initial failure and resolves once a socket opens", async () => {
    // The first two sockets fail pre-open; the third opens. connectLobby should
    // retry through them and resolve once the third attempt succeeds.
    const client = makeClient()
    const reconnecting: ReconnectingEvent[] = []
    const connected: ConnectEvent[] = []

    const connectPromise = client.connectLobby({
      onError: () => {},
    })
    client.on("reconnecting", (event) => reconnecting.push(event))
    client.on("connected", (event) => connected.push(event))

    // Fail the first two sockets pre-open.
    for (let i = 0; i < 2; i++) {
      // Wait a tick for connectLobby to create the next socket.
      while (MockWebSocket.instances.length <= i) {
        await new Promise((r) => setTimeout(r, 0))
      }
      const attempt = MockWebSocket.instances[i]!
      attempt.fireError()
      attempt.fireClose(1006, "down")
    }

    // Wait for connectLobby's retry setTimeout to fire (backoffMs=1) and create
    // the third socket, then open it.
    while (MockWebSocket.instances.length < 3) {
      await new Promise((r) => setTimeout(r, 5))
    }
    MockWebSocket.instances[2]!.fireOpen()

    await connectPromise

    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(3)
    // reconnecting fired before each retry attempt (not before the first).
    expect(reconnecting.length).toBeGreaterThanOrEqual(2)
    expect(reconnecting[0]!.scope).toBe("lobby")
    // connected fired once, marked as a reconnect.
    const lobbyConnected = connected.find((event) => event.scope === "lobby")
    expect(lobbyConnected).toBeDefined()
    expect(lobbyConnected!.reconnected).toBe(true)

    client.disconnectLobby()
  })

  it("rejects connectLobby after exhausting every retry attempt", async () => {
    const client = makeClient({ reconnect: { maxRetries: 2, backoffMs: 1, maxDelayMs: 2 } })

    const connectPromise = client.connectLobby().catch((error: unknown) => error)

    // Drain each attempt: wait for socket creation, fire error + close to
    // simulate pre-open failure, then let the retry setTimeout fire.
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 10))
      const latest = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      if (!latest || latest.readyState === 1) break
      latest.fireError()
      latest.fireClose(1006, "still down")
    }

    const result = await connectPromise
    expect(result).toBeDefined()
    expect((result as Error).message).toContain("Lobby WebSocket connection failed")
    // Initial attempt + 2 retries = 3 sockets total.
    expect(MockWebSocket.instances.length).toBe(3)
  })

  it("ignores late error events from a lobby socket after disconnectLobby", async () => {
    MockWebSocket.autoOpen = true
    const client = makeClient()
    const errors: unknown[] = []

    await client.connectLobby({
      onError: (error) => errors.push(error),
    })
    const lobbySocket = MockWebSocket.instances[0]!

    client.disconnectLobby()

    // A stale error arriving after disconnect must not reach the handler.
    lobbySocket.fireError()
    expect(errors).toHaveLength(0)
  })

  it("fires onReconnectExhausted when every retry fails", async () => {
    // First socket auto-opens so the initial connect resolves; subsequent
    // sockets drop without opening to simulate the backend staying down.
    MockWebSocket.autoOpen = true
    const client = makeClient({ reconnect: { maxRetries: 2, backoffMs: 1, maxDelayMs: 2 } })
    const exhausted: ReconnectExhaustedEvent[] = []
    const closes: DisconnectEvent[] = []

    await client.connect("realm-1", {
      onClose: (event) => closes.push(event),
      onReconnectExhausted: (event) => exhausted.push(event),
    })
    MockWebSocket.autoOpen = false

    // Kill the initial socket.
    MockWebSocket.instances[0]!.fireClose(1006, "down")

    // Let the retry timer fire → new socket is created but never opens. We
    // fire a close on each retry socket to simulate immediate failure.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 10))
      const latest = MockWebSocket.instances[MockWebSocket.instances.length - 1]!
      if (latest.readyState === 1) break
      latest.fireClose(1006, "still down")
    }

    await new Promise((r) => setTimeout(r, 20))

    expect(exhausted).toHaveLength(1)
    expect(exhausted[0]!.attempts).toBe(2)

    // First close had retries remaining, last close should be terminal.
    expect(closes[0]!.willReconnect).toBe(true)
    const lastClose = closes[closes.length - 1]!
    expect(lastClose.willReconnect).toBe(false)

    client.disconnect()
  })
})
