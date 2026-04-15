import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import { createMockDb } from "./helpers/mock-db.js"

async function importFreshRealmRoutes(
  mockDb: ReturnType<typeof createMockDb>,
  options?: {
    settledPayment?: {
      action: "realm_regen" | "realm_generate"
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
  const verifyAndSettle = mock(async () => options?.settledPayment ?? null)
  mock.module("../src/payments/x402.js", () => ({
    getRequestedNetworks: () => ["base"],
    isActionFree: () => false,
    verifyAndSettle,
    return402: () =>
      new Response(JSON.stringify({ error: "Payment required" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      }),
    logPayment: async () => {},
    mapPaymentError: (err: unknown) => ({
      error: err instanceof Error ? err.message : String(err),
      code: "unknown" as const,
    }),
  }))

  const mod = await import(`../src/routes/realms.js?cacheBust=${Date.now()}-${Math.random()}`)
  return { ...mod, verifyAndSettle }
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

  it("regenerates a completed realm after payment settlement", async () => {
    mockDb.setResponse("characters", "select", {
      data: { id: "char-1", gold: 175 },
      error: null,
    })
    mockDb.setResponse("realm_instances", "select", {
      data: {
        id: "realm-1",
        character_id: "char-1",
        template_id: "collapsed-passage",
        status: "completed",
        floor_reached: 3,
      },
      error: null,
    })
    mockDb.setResponse("realm_instances", "update", {
      data: {
        id: "realm-1",
        character_id: "char-1",
        template_id: "collapsed-passage",
        status: "generated",
        floor_reached: 1,
        seed: 123456,
      },
      error: null,
    })
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

  })
})

describe("Group 6 — tutorial realm gating", () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it("rejects non-tutorial realm generation before the tutorial is completed", async () => {
    mockDb.setResponse("characters", "select", {
      data: { id: "char-1" },
      error: null,
    })
    mockDb.setResponse("realm_instances", "select", {
      data: null,
      error: null,
    })

    const { realmRoutes } = await importFreshRealmRoutes(mockDb)
    const app = new Hono()
    app.route("/realms", realmRoutes)

    const response = await app.request("http://example.test/realms/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: "sunken-crypt" }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: "Complete the tutorial first",
    })
  })

  it("allows tutorial generation for a new character and consumes the free slot", async () => {
    mockDb.setResponse("characters", "select", {
      data: { id: "char-1" },
      error: null,
    })
    mockDb.setResponse("realm_instances", "select", {
      data: null,
      error: null,
    })
    mockDb.setResponse("accounts", "select", {
      data: { free_realm_used: false },
      error: null,
    })
    mockDb.setResponse("realm_instances", "insert", {
      data: {
        id: "realm-tutorial",
        character_id: "char-1",
        template_id: "tutorial-cellar",
        status: "generated",
        floor_reached: 1,
        is_free: true,
      },
      error: null,
    })
    mockDb.setResponse("accounts", "update", { data: null, error: null })
    mockDb.setResponse("realm_discovered_map", "insert", { data: null, error: null })

    const { realmRoutes } = await importFreshRealmRoutes(mockDb)
    const app = new Hono()
    app.route("/realms", realmRoutes)

    const response = await app.request("http://example.test/realms/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: "tutorial-cellar" }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      id: "realm-tutorial",
      template_id: "tutorial-cellar",
      status: "generated",
      is_free: true,
    })
    expect(mockDb.getCalls("accounts", "update")[0]?.payload).toEqual({ free_realm_used: true })
  })

  it("allows non-tutorial generation after tutorial completion is recorded", async () => {
    mockDb.setResponse("characters", "select", {
      data: { id: "char-1" },
      error: null,
    })
    mockDb.setResponse("realm_instances", "select", {
      data: { id: "realm-tutorial-complete" },
      error: null,
    })
    mockDb.setResponse("realm_instances", "select", {
      data: null,
      error: null,
    })
    mockDb.setResponse("accounts", "select", {
      data: { free_realm_used: true },
      error: null,
    })
    mockDb.setResponse("realm_instances", "insert", {
      data: {
        id: "realm-crypt",
        character_id: "char-1",
        template_id: "sunken-crypt",
        status: "generated",
        floor_reached: 1,
        is_free: false,
      },
      error: null,
    })
    mockDb.setResponse("realm_discovered_map", "insert", { data: null, error: null })

    const { realmRoutes, verifyAndSettle } = await importFreshRealmRoutes(mockDb, {
      settledPayment: {
        action: "realm_generate",
        txHash: "0xrealm",
        network: "eip155:84532",
        amountUsd: "0.25",
        headers: { "PAYMENT-RESPONSE": "ok" },
      },
    })
    const app = new Hono()
    app.route("/realms", realmRoutes)

    const response = await app.request("http://example.test/realms/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: "sunken-crypt" }),
    })

    expect(response.status).toBe(201)
    expect(response.headers.get("PAYMENT-RESPONSE")).toBe("ok")
    expect(await response.json()).toMatchObject({
      id: "realm-crypt",
      template_id: "sunken-crypt",
      is_free: false,
    })
    expect(verifyAndSettle).toHaveBeenCalledTimes(1)
  })

  it("keeps the tutorial free even after the account free realm has been spent", async () => {
    mockDb.setResponse("characters", "select", {
      data: { id: "char-1" },
      error: null,
    })
    mockDb.setResponse("realm_instances", "select", {
      data: null,
      error: null,
    })
    mockDb.setResponse("accounts", "select", {
      data: { free_realm_used: true },
      error: null,
    })
    mockDb.setResponse("realm_instances", "insert", {
      data: {
        id: "realm-tutorial-repeat",
        character_id: "char-1",
        template_id: "tutorial-cellar",
        status: "generated",
        floor_reached: 1,
        is_free: true,
      },
      error: null,
    })
    mockDb.setResponse("realm_discovered_map", "insert", { data: null, error: null })

    const { realmRoutes, verifyAndSettle } = await importFreshRealmRoutes(mockDb, {
      settledPayment: {
        action: "realm_generate",
        txHash: "0xshould-not-run",
        network: "eip155:84532",
        amountUsd: "0.25",
        headers: { "PAYMENT-RESPONSE": "unexpected" },
      },
    })
    const app = new Hono()
    app.route("/realms", realmRoutes)

    const response = await app.request("http://example.test/realms/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: "tutorial-cellar" }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      id: "realm-tutorial-repeat",
      template_id: "tutorial-cellar",
      is_free: true,
    })
    expect(verifyAndSettle).not.toHaveBeenCalled()
    expect(mockDb.getCalls("accounts", "update")).toHaveLength(0)
  })
})
