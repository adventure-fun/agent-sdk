import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import { createMockDb } from "./helpers/mock-db.js"

async function importFreshLeaderboardRoutes(mockDb: ReturnType<typeof createMockDb>) {
  mock.module("../src/db/client.js", () => ({ db: mockDb.db }))
  return import(`../src/routes/leaderboard.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("11.1 — leaderboard routes", () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it("returns paginated leaderboard entries with nested owner data", async () => {
    mockDb.setResponse("leaderboard_entries", "select", {
      data: [
        {
          character_id: "char-1",
          character_name: "Astra",
          class: "mage",
          player_type: "human",
          level: 9,
          xp: 1200,
          deepest_floor: 5,
          realms_completed: 2,
          status: "alive",
          cause_of_death: null,
          owner_handle: "wizard",
          owner_wallet: "0xabc",
          x_handle: "@wizard",
          github_handle: "wizard",
          created_at: "2026-04-01T00:00:00Z",
          died_at: null,
        },
        {
          character_id: "char-2",
          character_name: "Bram",
          class: "knight",
          player_type: "human",
          level: 8,
          xp: 1000,
          deepest_floor: 4,
          realms_completed: 1,
          status: "dead",
          cause_of_death: "Bitten by a ghoul",
          owner_handle: "tank",
          owner_wallet: "0xdef",
          x_handle: null,
          github_handle: null,
          created_at: "2026-04-01T00:00:00Z",
          died_at: "2026-04-02T00:00:00Z",
        },
      ],
      error: null,
    })

    const { leaderboardRoutes } = await importFreshLeaderboardRoutes(mockDb)
    const app = new Hono()
    app.route("/leaderboard", leaderboardRoutes)

    const response = await app.request(
      "http://example.test/leaderboard/xp?player_type=human&class=knight&limit=1&offset=1",
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.limit).toBe(1)
    expect(body.offset).toBe(1)
    expect(body.entries).toEqual([
      {
        character_id: "char-2",
        character_name: "Bram",
        class: "knight",
        player_type: "human",
        level: 8,
        xp: 1000,
        deepest_floor: 4,
        realms_completed: 1,
        status: "dead",
        cause_of_death: "Bitten by a ghoul",
        owner: {
          handle: "tank",
          wallet: "0xdef",
          x_handle: null,
          github_handle: null,
        },
        created_at: "2026-04-01T00:00:00Z",
        died_at: "2026-04-02T00:00:00Z",
      },
    ])

    const calls = mockDb.getCalls("leaderboard_entries", "select")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.filters).toContainEqual({ method: "eq", args: ["player_type", "human"] })
    expect(calls[0]!.filters).toContainEqual({ method: "eq", args: ["class", "knight"] })
    expect(calls[0]!.filters).toContainEqual({
      method: "order",
      args: ["xp", { ascending: false }],
    })
    expect(calls[0]!.filters).toContainEqual({
      method: "order",
      args: ["level", { ascending: false }],
    })
  })

  it("rejects invalid leaderboard filters", async () => {
    const { leaderboardRoutes } = await importFreshLeaderboardRoutes(mockDb)
    const app = new Hono()
    app.route("/leaderboard", leaderboardRoutes)

    const response = await app.request("http://example.test/leaderboard/xp?player_type=ghost")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Invalid player_type. Choose: human, agent",
    })
  })

  it("serves hall of fame before the dynamic :type route", async () => {
    mockDb.setResponse("hall_of_fame", "select", {
      data: [{ id: 1, event_type: "boss_kill", created_at: "2026-04-09T00:00:00Z" }],
      error: null,
    })

    const { leaderboardRoutes } = await importFreshLeaderboardRoutes(mockDb)
    const app = new Hono()
    app.route("/leaderboard", leaderboardRoutes)

    const response = await app.request("http://example.test/leaderboard/hall-of-fame")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      events: [{ id: 1, event_type: "boss_kill", created_at: "2026-04-09T00:00:00Z" }],
    })
    expect(mockDb.getCalls("hall_of_fame", "select")).toHaveLength(1)
    expect(mockDb.getCalls("leaderboard_entries", "select")).toHaveLength(0)
  })

  it("redirects leaderboard legend lookups to the legends API", async () => {
    const { leaderboardRoutes } = await importFreshLeaderboardRoutes(mockDb)
    const app = new Hono()
    app.route("/leaderboard", leaderboardRoutes)

    const response = await app.request("http://example.test/leaderboard/legends/char-9", {
      redirect: "manual",
    })

    expect(response.status).toBe(307)
    expect(response.headers.get("Location")).toBe("/legends/char-9")
  })
})
