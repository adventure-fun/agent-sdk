import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { GameClient } from "../../src/client.js"

const ORIGINAL_FETCH = globalThis.fetch

interface RecordedRequest {
  url: string
  method: string
  headers: Headers
  body: string | null
}

function makeClient(): GameClient {
  return new GameClient(
    "https://api.example.com",
    "wss://api.example.com",
    {
      token: "session-token",
      expires_at: Date.now() + 60_000,
    },
  )
}

describe("GameClient.fetchWsTicket", () => {
  let recorded: RecordedRequest[] = []
  let nextResponse: () => Response = () =>
    new Response(JSON.stringify({ ticket: "mock-ticket", expires_in: 60 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })

  beforeEach(() => {
    recorded = []
    nextResponse = () =>
      new Response(JSON.stringify({ ticket: "mock-ticket", expires_in: 60 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      recorded.push({
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : null,
      })
      return nextResponse()
    }) as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  it("POSTs to /auth/ws-ticket with the Bearer token and returns the ticket", async () => {
    const client = makeClient()
    // fetchWsTicket is private; the access modifier is type-only, runtime is open.
    const ticket = await (client as unknown as { fetchWsTicket(): Promise<string | null> })
      .fetchWsTicket()

    expect(ticket).toBe("mock-ticket")
    expect(recorded).toHaveLength(1)
    expect(recorded[0]!.url).toBe("https://api.example.com/auth/ws-ticket")
    expect(recorded[0]!.method).toBe("POST")
    expect(recorded[0]!.headers.get("Authorization")).toBe("Bearer session-token")
    expect(recorded[0]!.headers.get("Content-Type")).toBe("application/json")
  })

  it("returns null when the backend does not know the endpoint (local stub fallback)", async () => {
    nextResponse = () =>
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })

    const client = makeClient()
    const ticket = await (client as unknown as { fetchWsTicket(): Promise<string | null> })
      .fetchWsTicket()

    expect(ticket).toBeNull()
  })

  it("returns null when the network call throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down")
    }) as typeof globalThis.fetch

    const client = makeClient()
    const ticket = await (client as unknown as { fetchWsTicket(): Promise<string | null> })
      .fetchWsTicket()

    expect(ticket).toBeNull()
  })
})
