import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import { createMockDb } from "./helpers/mock-db.js"

async function importFreshRealmRoutes(
  mockDb: ReturnType<typeof createMockDb>,
  options?: {
    settledPayment?: {
      action: "realm_regen"
      txHash: string
      network: string
      amountUsd: string
      headers: Record<string, string>
    } | null
  },
) {
  mock.module("../src/db/client.js", () => ({ db: mockDb.db }))
  mock.module("../src/auth/middleware.js", () => ({
    requireAuth: async (
      c: Parameters<Parameters<Hono["use"]>[1]>[0],
      next: () => Promise<void>,
    ) => {
      c.set("session", {
        account_id: "acct-1",
        wallet_address: "0xabc",
        player_type: "human",
      })
      await next()
    },
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

  return import(`../src/routes/realms.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("Group 3 — realm regeneration route", () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it("rejects regeneration for realms that are not completed", async () => {
    mockDb.setResponse("characters", "select", {
      data: { id: "char-1", gold: 150 },
      error: null,
    })
    mockDb.setResponse("realm_instances", "select", {
      data: {
        id: "realm-1",
        character_id: "char-1",
        template_id: "tutorial-cellar",
        status: "paused",
      },
      error: null,
    })

    const { realmRoutes } = await importFreshRealmRoutes(mockDb)
    const app = new Hono()
    app.route("/realms", realmRoutes)

    const response = await app.request(
      "http://example.test/realms/realm-1/regenerate",
      { method: "POST" },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "Only completed realms can be regenerated",
    })
  })

  it("rejects regeneration when the character lacks enough gold", async () => {
    mockDb.setResponse("characters", "select", {
      data: { id: "char-1", gold: 65 },
      error: null,
    })
    mockDb.setResponse("realm_instances", "select", {
      data: {
        id: "realm-1",
        character_id: "char-1",
        template_id: "tutorial-cellar",
        status: "completed",
      },
      error: null,
    })

    const { realmRoutes } = await importFreshRealmRoutes(mockDb)
    const app = new Hono()
    app.route("/realms", realmRoutes)

    const response = await app.request(
      "http://example.test/realms/realm-1/regenerate",
      { method: "POST" },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Requires 100 gold",
      gold: 65,
    })
  })

  it("regenerates a completed realm after payment settlement", async () => {
    mockDb.setResponse("characters", "select", {
      data: { id: "char-1", gold: 175 },
      error: null,
    })
    mockDb.setResponse("realm_instances", "select", {
      data: {
        id: "realm-1",
        character_id: "char-1",
        template_id: "tutorial-cellar",
        status: "completed",
        floor_reached: 3,
      },
      error: null,
    })
    mockDb.setResponse("realm_instances", "update", {
      data: {
        id: "realm-1",
        character_id: "char-1",
        template_id: "tutorial-cellar",
        status: "generated",
        floor_reached: 1,
        seed: 123456,
      },
      error: null,
    })
    mockDb.setResponse("characters", "update", { data: null, error: null })

    const { realmRoutes } = await importFreshRealmRoutes(mockDb, {
      settledPayment: {
        action: "realm_regen",
        txHash: "0xpaid",
        network: "eip155:84532",
        amountUsd: "0.25",
        headers: { "PAYMENT-RESPONSE": "ok" },
      },
    })
    const app = new Hono()
    app.route("/realms", realmRoutes)

    const response = await app.request(
      "http://example.test/realms/realm-1/regenerate",
      { method: "POST" },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("PAYMENT-RESPONSE")).toBe("ok")
    expect(await response.json()).toMatchObject({
      id: "realm-1",
      status: "generated",
      floor_reached: 1,
    })

    const realmUpdate = mockDb.getCalls("realm_instances", "update")[0]
    expect(realmUpdate?.payload).toMatchObject({
      status: "generated",
      floor_reached: 1,
    })

    const characterUpdate = mockDb.getCalls("characters", "update")[0]
    expect(characterUpdate?.payload).toEqual({ gold: 75 })
  })
})
