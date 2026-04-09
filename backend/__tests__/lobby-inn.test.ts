import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import { createMockDb } from "./helpers/mock-db.js"

async function importFreshLobbyRoutes(
  mockDb: ReturnType<typeof createMockDb>,
  options?: {
    activeSession?: boolean
    settledPayment?: {
      action: "inn_rest"
      txHash: string
      network: string
      amountUsd: string
      headers: Record<string, string>
    } | null
  },
) {
  mock.module("../src/db/client.js", () => ({ db: mockDb.db }))
  mock.module("../src/auth/middleware.js", () => ({
    requireAuth: async (c: Parameters<Parameters<Hono["use"]>[1]>[0], next: () => Promise<void>) => {
      c.set("session", {
        account_id: "acct-1",
        wallet_address: "0xabc",
        player_type: "human",
      })
      await next()
    },
  }))
  mock.module("../src/game/active-sessions.js", () => ({
    hasActiveSession: () => options?.activeSession ?? false,
    getActiveSession: () => undefined,
    registerActiveSession: () => {},
    unregisterActiveSession: () => {},
    clearActiveSessions: () => {},
    listSpectatableSessions: () => [],
  }))
  mock.module("../src/payments/x402.js", () => ({
    getRequestedNetworks: () => ["base"],
    verifyAndSettle: async () => options?.settledPayment ?? null,
    return402: () =>
      new Response(JSON.stringify({ error: "Payment required" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      }),
    logPayment: async () => {},
  }))

  return import(`../src/routes/lobby.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("11.4 — lobby inn route", () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it("returns 402 when inn payment has not been settled yet", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "mage",
        gold: 40,
        hp_current: 18,
        hp_max: 50,
        resource_current: 7,
        resource_max: 20,
      },
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/inn/rest", {
      method: "POST",
    })

    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({ error: "Payment required" })
  })

  it("restores hp and resource after a settled inn payment", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "knight",
        gold: 40,
        hp_current: 12,
        hp_max: 60,
        resource_current: 2,
        resource_max: 10,
      },
      error: null,
    })
    mockDb.setResponse("characters", "update", {
      data: {
        hp_current: 60,
        hp_max: 60,
        resource_current: 10,
        resource_max: 10,
      },
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb, {
      settledPayment: {
        action: "inn_rest",
        txHash: "0xpaid",
        network: "eip155:84532",
        amountUsd: "0.05",
        headers: { "PAYMENT-RESPONSE": "ok" },
      },
    })
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/inn/rest", {
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("PAYMENT-RESPONSE")).toBe("ok")
    expect(await response.json()).toEqual({
      hp_current: 60,
      hp_max: 60,
      resource_current: 10,
      resource_max: 10,
      message: "You rest at the inn and feel restored.",
    })
  })

  it("rejects inn rest when the character is already fully restored", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "mage",
        gold: 40,
        hp_current: 50,
        hp_max: 50,
        resource_current: 20,
        resource_max: 20,
      },
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/inn/rest", {
      method: "POST",
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "You are already fully rested.",
    })
  })

  it("rejects inn rest while the character is in an active session", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "mage",
        gold: 40,
        hp_current: 20,
        hp_max: 50,
        resource_current: 10,
        resource_max: 20,
      },
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb, { activeSession: true })
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/inn/rest", {
      method: "POST",
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "Leave the dungeon before resting.",
    })
  })
})
