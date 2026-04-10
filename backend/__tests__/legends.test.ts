import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import { createMockDb } from "./helpers/mock-db.js"

async function importFreshLegendsRoutes(mockDb: ReturnType<typeof createMockDb>) {
  mock.module("../src/db/client.js", () => ({ db: mockDb.db }))
  return import(`../src/routes/legends.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("11.6 — legends route", () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it("returns a full legend page payload for dead characters", async () => {
    mockDb.setResponse("characters", "select", {
      data: {
        id: "char-1",
        name: "Astra",
        class: "mage",
        level: 9,
        xp: 1400,
        stats: { hp: 42, attack: 14, defense: 8, accuracy: 16, evasion: 10, speed: 11 },
        skill_tree: { "mage-sigil": true },
        created_at: "2026-04-01T00:00:00Z",
        died_at: "2026-04-04T00:00:00Z",
        accounts: {
          handle: "wizard",
          player_type: "human",
          wallet_address: "0xabc",
          x_handle: "@wizard",
          github_handle: "wizard",
        },
      },
      error: null,
    })
    mockDb.setResponse("corpse_containers", "select", {
      data: {
        id: "corpse-1",
        floor: 4,
        room_id: "crypt-boss",
        gold_amount: 77,
      },
      error: null,
    })
    mockDb.setResponse("leaderboard_entries", "select", {
      data: {
        realms_completed: 3,
        deepest_floor: 6,
        cause_of_death: "The Warden split the air and the mage with it.",
      },
      error: null,
    })
    mockDb.setResponse("run_logs", "select", {
      data: [
        {
          total_turns: 64,
          ended_at: "2026-04-04T00:00:00Z",
          summary: { enemies_killed: 8, cause_of_death: "The Warden split the air and the mage with it." },
        },
        {
          total_turns: 31,
          ended_at: "2026-04-02T00:00:00Z",
          summary: { enemies_killed: 5, cause_of_death: null },
        },
      ],
      error: null,
    })
    mockDb.setResponse("inventory_items", "select", {
      data: [
        {
          id: "item-weapon",
          template_id: "oak-staff",
          quantity: 1,
          owner_type: "corpse",
          owner_id: "corpse-1",
          slot: "weapon",
          modifiers: {},
        },
      ],
      error: null,
    })

    const { legendsRoutes } = await importFreshLegendsRoutes(mockDb)
    const app = new Hono()
    app.route("/legends", legendsRoutes)

    const response = await app.request("http://example.test/legends/char-1")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      character: {
        id: "char-1",
        name: "Astra",
        class: "mage",
        level: 9,
        xp: 1400,
        stats: { hp: 42, attack: 14, defense: 8, accuracy: 16, evasion: 10, speed: 11 },
        skill_tree: { "mage-sigil": "unlocked" },
        equipment_at_death: {
          weapon: {
            id: "item-weapon",
            template_id: "oak-staff",
            name: "Runed Oak Staff",
            quantity: 1,
            modifiers: {},
            owner_type: "corpse",
            owner_id: "corpse-1",
            slot: "weapon",
          },
          armor: null,
          helm: null,
          hands: null,
          accessory: null,
        },
        gold_at_death: 77,
      },
      owner: {
        handle: "wizard",
        player_type: "human",
        wallet: "0xabc",
        x_handle: "@wizard",
        github_handle: "wizard",
      },
      history: {
        realms_completed: 3,
        deepest_floor: 6,
        enemies_killed: 13,
        turns_survived: 95,
        cause_of_death: "The Warden split the air and the mage with it.",
        death_floor: 4,
        death_room: "crypt-boss",
        created_at: "2026-04-01T00:00:00Z",
        died_at: "2026-04-04T00:00:00Z",
      },
    })
  })

  it("returns 404 when the legend does not exist", async () => {
    mockDb.setResponse("characters", "select", { data: null, error: null })

    const { legendsRoutes } = await importFreshLegendsRoutes(mockDb)
    const app = new Hono()
    app.route("/legends", legendsRoutes)

    const response = await app.request("http://example.test/legends/missing")

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Legend not found" })
  })
})
