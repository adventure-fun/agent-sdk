import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import { createMockDb } from "./helpers/mock-db.js"

async function importFreshAuthRoutes(mockDb: ReturnType<typeof createMockDb>) {
  mock.module("../src/db/client.js", () => ({ db: mockDb.db }))
  mock.module("../src/auth/jwt.js", () => ({
    signSession: async () => "session-token",
  }))
  mock.module("../src/auth/wallet.js", () => ({
    verifyWalletSignature: async () => true,
  }))
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
  mock.module("../src/redis/client.js", () => ({
    getRedis: () => null,
    isRedisAvailable: () => false,
    redisGet: async () => null,
    redisSet: async () => false,
    redisDel: async () => false,
  }))

  return import(`../src/routes/auth.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("10.3 / 10.6 — auth routes", () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it("accepts a challenge nonce from the fallback in-memory store", async () => {
    mockDb.setResponse("accounts", "select", { data: null, error: null })
    mockDb.setResponse("accounts", "insert", {
      data: {
        id: "acct-1",
        wallet_address: "0xabc",
        player_type: "human",
      },
      error: null,
    })

    const { authRoutes } = await importFreshAuthRoutes(mockDb)
    const app = new Hono()
    app.route("/auth", authRoutes)

    const challenge = await app.request("http://example.test/auth/challenge")
    expect(challenge.status).toBe(200)

    const { nonce } = await challenge.json() as { nonce: string }
    const connect = await app.request("http://example.test/auth/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: "0xabc",
        signature: "sig",
        nonce,
        player_type: "human",
      }),
    })

    expect(connect.status).toBe(200)
    expect(await connect.json()).toEqual({
      token: "session-token",
      account: {
        id: "acct-1",
        wallet_address: "0xabc",
        player_type: "human",
      },
    })
  })

  it("uses requireAuth session data for profile updates", async () => {
    mockDb.setResponse("accounts", "update", {
      data: { id: "acct-1", handle: "new-handle" },
      error: null,
    })

    const { authRoutes } = await importFreshAuthRoutes(mockDb)
    const app = new Hono()
    app.route("/auth", authRoutes)

    const response = await app.request("http://example.test/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "new-handle" }),
    })

    expect(response.status).toBe(200)
    const updateCalls = mockDb.getCalls("accounts", "update")
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]!.filters).toContainEqual({
      method: "eq",
      args: ["id", "acct-1"],
    })
  })
})
