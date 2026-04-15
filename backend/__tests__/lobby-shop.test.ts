import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import { createMockDb } from "./helpers/mock-db.js"
import { getInventoryCapacity } from "@adventure-fun/schemas"

async function importFreshLobbyRoutes(
  mockDb: ReturnType<typeof createMockDb>,
  options?: { activeSession?: boolean },
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
    hasLockedRealm: async () => options?.activeSession ?? false,
    getActiveSession: () => undefined,
    registerActiveSession: () => {},
    unregisterActiveSession: () => {},
    clearActiveSessions: () => {},
    listSpectatableSessions: () => [],
  }))
  mock.module("../src/payments/x402.js", () => ({
    getRequestedNetworks: () => ["base"],
    isActionFree: () => false,
    verifyAndSettle: async () => null,
    return402: () => new Response(),
    logPayment: async () => {},
    mapPaymentError: (err: unknown) => ({
      error: err instanceof Error ? err.message : String(err),
      code: "unknown" as const,
    }),
  }))

  return import(`../src/routes/lobby.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("11.2 — lobby shop routes", () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it("returns grouped shop catalog data", async () => {
    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/shops")
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.sections).toHaveLength(2)
    expect(body.sections[0].id).toBe("consumable")
    expect(body.sections[1].id).toBe("equipment")
    expect(body.featured.length).toBeGreaterThan(0)
  })

  it("returns the authenticated character inventory for selling", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "mage",
        gold: 41,
        hp_current: 30,
        hp_max: 50,
        resource_current: 20,
        resource_max: 20,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [
        {
          id: "item-1",
          template_id: "mana-potion",
          quantity: 2,
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
          modifiers: {},
        },
      ],
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/shop/inventory")

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.gold).toBe(41)
    expect(body.inventory).toEqual([
      {
        id: "item-1",
        template_id: "mana-potion",
        name: "Mana Potion",
        quantity: 2,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-1",
        slot: null,
      },
    ])
    expect(body.templates).toBeDefined()
    expect(body.templates["mana-potion"]).toBeDefined()
    expect(body.templates["mana-potion"].id).toBe("mana-potion")
  })

  it("purchases an item into a new inventory slot", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "mage",
        gold: 80,
        hp_current: 25,
        hp_max: 40,
        resource_current: 10,
        resource_max: 20,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", { data: [], error: null })
    mockDb.setResponse("inventory_items", "insert", {
      data: {
        id: "item-1",
        template_id: "health-potion",
        quantity: 2,
        owner_type: "character",
        owner_id: "char-1",
        slot: null,
        modifiers: {},
      },
      error: null,
    })
    mockDb.setResponse("characters", "update", { data: null, error: null })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/shop/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: "health-potion", quantity: 2 }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      gold: 56,
      item: {
        id: "item-1",
        template_id: "health-potion",
        name: "Health Potion",
        quantity: 2,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-1",
        slot: null,
      },
      message: "Purchased 2 Health Potions.",
    })

    const insertCall = mockDb.getCalls("inventory_items", "insert")[0]
    expect(insertCall?.payload).toEqual({
      character_id: "char-1",
      owner_type: "character",
      owner_id: "char-1",
      template_id: "health-potion",
      quantity: 2,
      modifiers: {},
      slot: null,
    })
  })

  it("rejects buying while an active session is running", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "mage",
        gold: 80,
        hp_current: 25,
        hp_max: 40,
        resource_current: 10,
        resource_max: 20,
      },
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb, { activeSession: true })
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/shop/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: "health-potion" }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "Leave the dungeon before shopping." })
  })

  it("rejects selling equipped items", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "knight",
        gold: 20,
        hp_current: 30,
        hp_max: 50,
        resource_current: 8,
        resource_max: 10,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [
        {
          id: "item-1",
          template_id: "iron-sword",
          quantity: 1,
          owner_type: "character",
          owner_id: "char-1",
          slot: "weapon",
          modifiers: {},
        },
      ],
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/shop/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: "item-1" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Unequip this item before selling it.",
    })
  })

  it("sells a stackable item and updates character gold", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "mage",
        gold: 20,
        hp_current: 30,
        hp_max: 50,
        resource_current: 8,
        resource_max: 20,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [
        {
          id: "item-2",
          template_id: "mana-potion",
          quantity: 3,
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
          modifiers: {},
        },
      ],
      error: null,
    })
    mockDb.setResponse("inventory_items", "update", { data: null, error: null })
    mockDb.setResponse("characters", "update", { data: null, error: null })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/shop/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: "item-2", quantity: 2 }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      gold: 32,
      sold: {
        item_id: "item-2",
        template_id: "mana-potion",
        quantity: 2,
        total_gold: 12,
      },
      message: "Sold 2 Mana Potions.",
    })
  })

  it("equips a lobby item into its slot", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "knight",
        gold: 20,
        hp_current: 30,
        hp_max: 50,
        resource_current: 8,
        resource_max: 10,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [
        {
          id: "item-1",
          template_id: "iron-sword",
          quantity: 1,
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
          modifiers: {},
        },
      ],
      error: null,
    })
    mockDb.setResponse("inventory_items", "update", { data: null, error: null })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/equip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: "item-1" }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      inventory: expect.any(Array),
      message: "Equipped Iron Sword.",
    })

    const updateCalls = mockDb.getCalls("inventory_items", "update")
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]?.payload).toEqual({ slot: "weapon" })
    expect(updateCalls[0]?.filters).toContainEqual({
      method: "eq",
      args: ["id", "item-1"],
    })
  })

  it("swaps equipped lobby gear when equipping into an occupied slot", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "knight",
        gold: 20,
        hp_current: 30,
        hp_max: 50,
        resource_current: 8,
        resource_max: 10,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [
        {
          id: "item-old",
          template_id: "weapon-iron-sword",
          quantity: 1,
          owner_type: "character",
          owner_id: "char-1",
          slot: "weapon",
          modifiers: {},
        },
        {
          id: "item-new",
          template_id: "iron-sword",
          quantity: 1,
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
          modifiers: {},
        },
      ],
      error: null,
    })
    mockDb.setResponse("inventory_items", "update", { data: null, error: null })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/equip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: "item-new" }),
    })

    expect(response.status).toBe(200)

    const updateCalls = mockDb.getCalls("inventory_items", "update")
    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[0]?.payload).toEqual({ slot: null })
    expect(updateCalls[0]?.filters).toContainEqual({
      method: "eq",
      args: ["id", "item-old"],
    })
    expect(updateCalls[1]?.payload).toEqual({ slot: "weapon" })
    expect(updateCalls[1]?.filters).toContainEqual({
      method: "eq",
      args: ["id", "item-new"],
    })
  })

  it("rejects class-restricted items for the wrong class", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "mage",
        gold: 20,
        hp_current: 30,
        hp_max: 50,
        resource_current: 20,
        resource_max: 20,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [
        {
          id: "item-1",
          template_id: "wooden-shield",
          quantity: 1,
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
          modifiers: {},
        },
      ],
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/equip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: "item-1" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Wooden Shield can only be equipped by knights.",
    })
  })

  it("rejects equipping while an active session is running", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "knight",
        gold: 20,
        hp_current: 30,
        hp_max: 50,
        resource_current: 8,
        resource_max: 10,
      },
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb, { activeSession: true })
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/equip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: "item-1" }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "Leave the dungeon before changing equipment." })
  })

  it("unequips lobby gear back into the bag", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "knight",
        gold: 20,
        hp_current: 30,
        hp_max: 50,
        resource_current: 8,
        resource_max: 10,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [
        {
          id: "item-1",
          template_id: "iron-sword",
          quantity: 1,
          owner_type: "character",
          owner_id: "char-1",
          slot: "weapon",
          modifiers: {},
        },
      ],
      error: null,
    })
    mockDb.setResponse("inventory_items", "update", { data: null, error: null })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/unequip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: "weapon" }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      inventory: expect.any(Array),
      message: "Unequipped Iron Sword.",
    })

    const updateCalls = mockDb.getCalls("inventory_items", "update")
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]?.payload).toEqual({ slot: null })
    expect(updateCalls[0]?.filters).toContainEqual({
      method: "eq",
      args: ["id", "item-1"],
    })
  })

  it("rejects unequipping when the bag is full", async () => {
    const bagRows = Array.from({ length: getInventoryCapacity() }, (_, index) => ({
      id: `bag-${index}`,
      template_id: "health-potion",
      quantity: 1,
      owner_type: "character",
      owner_id: "char-1",
      slot: null,
      modifiers: {},
    }))

    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "knight",
        gold: 20,
        hp_current: 30,
        hp_max: 50,
        resource_current: 8,
        resource_max: 10,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [
        ...bagRows,
        {
          id: "item-equipped",
          template_id: "iron-sword",
          quantity: 1,
          owner_type: "character",
          owner_id: "char-1",
          slot: "weapon",
          modifiers: {},
        },
      ],
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/unequip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: "weapon" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Inventory full." })
  })

  it("rejects unequipping an empty slot", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        class: "knight",
        gold: 20,
        hp_current: 30,
        hp_max: 50,
        resource_current: 8,
        resource_max: 10,
      },
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [],
      error: null,
    })

    const { lobbyRoutes } = await importFreshLobbyRoutes(mockDb)
    const app = new Hono()
    app.route("/lobby", lobbyRoutes)

    const response = await app.request("http://example.test/lobby/unequip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: "weapon" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Nothing is equipped in that slot." })
  })
})
