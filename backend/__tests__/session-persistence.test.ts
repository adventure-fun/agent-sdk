import { describe, expect, it, beforeEach, mock } from "bun:test"
import type { GameState, GameEvent, Tile, ActiveEffect } from "@adventure-fun/schemas"
import { SeededRng } from "@adventure-fun/engine"
import { createMockDb } from "./helpers/mock-db.js"

function makeTiles(width: number, height: number): Tile[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      x,
      y,
      type: "floor" as const,
      entities: [],
    })),
  )
}

function makeState(overrides?: Partial<GameState>): GameState {
  return {
    turn: 5,
    realm: {
      template_id: "tutorial-cellar",
      template_version: 1,
      seed: 42,
      total_floors: 1,
    },
    character: {
      id: "char-1",
      class: "knight",
      level: 3,
      xp: 150,
      gold: 50,
      hp: { current: 40, max: 50 },
      resource: { type: "stamina", current: 8, max: 10 },
      stats: {
        hp: 50,
        attack: 22,
        defense: 10,
        accuracy: 14,
        evasion: 12,
        speed: 11,
      },
      effective_stats: {
        hp: 50,
        attack: 22,
        defense: 10,
        accuracy: 14,
        evasion: 12,
        speed: 11,
      },
      buffs: [],
      debuffs: [],
      abilities: ["knight-slash"],
      cooldowns: {},
      skill_tree: {},
    },
    position: {
      floor: 1,
      room_id: "f1_r1_test-room",
      tile: { x: 3, y: 2 },
    },
    inventory: [],
    equipment: {
      weapon: null,
      armor: null,
      helm: null,
      hands: null,
      accessory: null,
    },
    activeFloor: {
      rooms: [
        {
          id: "f1_r1_test-room",
          tiles: makeTiles(6, 6),
          enemies: [
            {
              id: "f1_r1_encounter_01_enemy_00",
              template_id: "goblin",
              hp: 15,
              hp_max: 20,
              position: { x: 4, y: 3 },
              effects: [{ type: "poison", turns_remaining: 2, magnitude: 3 }],
              cooldowns: { "goblin-strike": 1 },
            },
            {
              id: "f1_r1_encounter_01_enemy_01",
              template_id: "skeleton",
              hp: 0,
              hp_max: 18,
              position: { x: 1, y: 1 },
              effects: [],
              cooldowns: {},
            },
          ],
          items: [
            {
              id: "f1_r1_loot_00",
              template_id: "health-potion",
              quantity: 1,
              position: { x: 2, y: 2 },
            },
          ],
        },
      ],
    },
    discoveredTiles: { 1: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
    roomsVisited: { 1: ["f1_r1_test-room", "f1_r2_test-room"] },
    loreDiscovered: [],
    mutatedEntities: ["f1_r1_encounter_01_enemy_01"],
    realmStatus: "active",
    ...overrides,
  }
}

// ── 8.1 — Batch mutation persistence ────────────────────────────────────────

describe("8.1 — batchPersistMutations", () => {
  it("inserts all mutations in a single DB call", async () => {
    const { batchPersistMutations } = await import("../src/game/session-persistence.js")
    const { db, getCalls } = createMockDb()

    const mutations = [
      { entity_id: "e1", mutation: "killed" as const, floor: 1, metadata: {} },
      { entity_id: "e2", mutation: "looted" as const, floor: 1, metadata: { template_id: "potion" } },
      { entity_id: "e3", mutation: "used" as const, floor: 1, metadata: { name: "lever" } },
    ]

    await batchPersistMutations(db as any, "realm-1", 5, mutations)

    const insertCalls = getCalls("realm_mutations", "insert")
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0]!.payload).toHaveLength(3)
  })

  it("updates realm_instances position exactly once", async () => {
    const { batchPersistMutations } = await import("../src/game/session-persistence.js")
    const { db, getCalls } = createMockDb()

    const mutations = [
      { entity_id: "e1", mutation: "killed" as const, floor: 1, metadata: {} },
      { entity_id: "e2", mutation: "killed" as const, floor: 1, metadata: {} },
    ]

    await batchPersistMutations(db as any, "realm-1", 3, mutations, {
      room_id: "f1_r2",
      tile: { x: 4, y: 2 },
      floor: 1,
    })

    const updateCalls = getCalls("realm_instances", "update")
    expect(updateCalls).toHaveLength(1)
    const payload = updateCalls[0]!.payload as Record<string, unknown>
    expect(payload.last_turn).toBe(3)
    expect(payload.current_room_id).toBe("f1_r2")
    expect(payload.tile_x).toBe(4)
    expect(payload.tile_y).toBe(2)
  })

  it("skips DB calls when mutation list is empty", async () => {
    const { batchPersistMutations } = await import("../src/game/session-persistence.js")
    const { db, getCalls } = createMockDb()

    await batchPersistMutations(db as any, "realm-1", 2, [])

    expect(getCalls("realm_mutations", "insert")).toHaveLength(0)
  })

  it("persistRealmProgress writes last_turn + position unconditionally (even for wait turns)", async () => {
    // Regression: a wait-loop used to freeze last_turn at the last mutation-bearing turn, so
    // an ungraceful disconnect would rewind the resume point by hundreds of turns. This is the
    // per-turn cursor write that guarantees worst-case regression of 1 turn.
    const { persistRealmProgress } = await import("../src/game/session-persistence.js")
    const { db, getCalls } = createMockDb()

    await persistRealmProgress(db as any, "realm-1", 42, {
      room_id: "f2_r0_sc-rest-shrine",
      tile: { x: 1, y: 1 },
      floor: 2,
    })

    const updates = getCalls("realm_instances", "update")
    expect(updates).toHaveLength(1)
    const payload = updates[0]?.payload as Record<string, unknown>
    expect(payload.last_turn).toBe(42)
    expect(payload.current_room_id).toBe("f2_r0_sc-rest-shrine")
    expect(payload.tile_x).toBe(1)
    expect(payload.tile_y).toBe(1)
    expect(payload.floor_reached).toBe(2)
  })
})

// ── 8.2 — Disconnect recovery (enemy state serialization) ───────────────────

describe("8.2 — session state serialization", () => {
  it("serializes live enemy positions, HP, effects, and cooldowns", async () => {
    const { serializeSessionState } = await import("../src/game/session-persistence.js")
    const state = makeState()
    const result = serializeSessionState(state)

    expect(result.rooms).toHaveLength(1)
    const room = result.rooms[0]!
    expect(room.room_id).toBe("f1_r1_test-room")
    expect(room.enemies).toHaveLength(1)

    const enemy = room.enemies[0]!
    expect(enemy.id).toBe("f1_r1_encounter_01_enemy_00")
    expect(enemy.hp).toBe(15)
    expect(enemy.position).toEqual({ x: 4, y: 3 })
    expect(enemy.effects).toHaveLength(1)
    expect(enemy.cooldowns).toEqual({ "goblin-strike": 1 })
    expect(result.roomsVisited).toEqual({ 1: ["f1_r1_test-room", "f1_r2_test-room"] })
  })

  it("excludes dead enemies from serialized state", async () => {
    const { serializeSessionState } = await import("../src/game/session-persistence.js")
    const state = makeState()
    const result = serializeSessionState(state)

    const room = result.rooms[0]!
    const deadEnemy = room.enemies.find(
      (e: any) => e.id === "f1_r1_encounter_01_enemy_01",
    )
    expect(deadEnemy).toBeUndefined()
  })

  it("restores enemy positions from session state onto rebuilt rooms", async () => {
    const { applySessionState } = await import("../src/game/session-persistence.js")
    const state = makeState()

    state.activeFloor.rooms[0]!.enemies[0]!.position = { x: 1, y: 1 }
    state.activeFloor.rooms[0]!.enemies[0]!.hp = 20
    state.activeFloor.rooms[0]!.enemies[0]!.effects = []

    const sessionState = {
      rooms: [
        {
          room_id: "f1_r1_test-room",
          enemies: [
            {
              id: "f1_r1_encounter_01_enemy_00",
              hp: 15,
              position: { x: 4, y: 3 },
              effects: [{ type: "poison", turns_remaining: 2, magnitude: 3 }],
              cooldowns: { "goblin-strike": 1 },
              boss_phase_index: undefined,
            },
          ],
        },
      ],
      roomsVisited: { 1: ["f1_r1_test-room", "f1_r2_test-room"] },
    }

    applySessionState(state, sessionState)

    const enemy = state.activeFloor.rooms[0]!.enemies[0]!
    expect(enemy.position).toEqual({ x: 4, y: 3 })
    expect(enemy.hp).toBe(15)
    expect(enemy.effects).toHaveLength(1)
    expect(enemy.effects[0]!.type).toBe("poison")
    expect(enemy.cooldowns).toEqual({ "goblin-strike": 1 })
    expect(state.roomsVisited).toEqual({ 1: ["f1_r1_test-room", "f1_r2_test-room"] })
  })

  it("handles rooms with no matching session state gracefully", async () => {
    const { applySessionState } = await import("../src/game/session-persistence.js")
    const state = makeState()
    const originalHp = state.activeFloor.rooms[0]!.enemies[0]!.hp

    applySessionState(state, { rooms: [] })

    expect(state.activeFloor.rooms[0]!.enemies[0]!.hp).toBe(originalHp)
  })
})

// ── 8.3 — updateLeaderboard realms_completed ────────────────────────────────

describe("8.3 — countCompletedRealms", () => {
  it("returns count from DB query", async () => {
    const { countCompletedRealms } = await import("../src/game/session-persistence.js")
    const { db, setResponse } = createMockDb()

    setResponse("realm_instances", "select", {
      data: [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { id: "r4" }],
      error: null,
    })

    const count = await countCompletedRealms(db as any, "char-1")
    expect(count).toBe(4)
  })

  it("returns 0 when no completed realms exist", async () => {
    const { countCompletedRealms } = await import("../src/game/session-persistence.js")
    const { db, setResponse } = createMockDb()

    setResponse("realm_instances", "select", { data: [], error: null })

    const count = await countCompletedRealms(db as any, "char-1")
    expect(count).toBe(0)
  })

  it("returns 0 on query error", async () => {
    const { countCompletedRealms } = await import("../src/game/session-persistence.js")
    const { db, setResponse } = createMockDb()

    setResponse("realm_instances", "select", { data: null, error: { message: "fail" } })

    const count = await countCompletedRealms(db as any, "char-1")
    expect(count).toBe(0)
  })
})

// ── 8.4 — buildRunSummary categorization ────────────────────────────────────

describe("8.4 — categorizeRunEvents", () => {
  it("counts only 'chest' interact events as chestsOpened", async () => {
    const { buildRunSummaryFromEvents } = await import("../src/game/session-persistence.js")

    const events: GameEvent[] = [
      { turn: 1, type: "interact", detail: "Opened chest", data: { target: "c1", category: "chest" } },
      { turn: 2, type: "interact", detail: "Read tome", data: { target: "l1", category: "lore" } },
      { turn: 3, type: "interact", detail: "Pulled lever", data: { target: "m1", category: "mechanism" } },
      { turn: 4, type: "interact", detail: "Opened chest 2", data: { target: "c2", category: "chest" } },
    ]

    const summary = buildRunSummaryFromEvents(events, { floor: 2 })
    expect(summary.chests_opened).toBe(2)
  })

  it("counts enemy kills and XP correctly", async () => {
    const { buildRunSummaryFromEvents } = await import("../src/game/session-persistence.js")

    const events: GameEvent[] = [
      { turn: 1, type: "enemy_killed", detail: "Goblin defeated", data: { enemy_id: "g1", xp: 10 } },
      { turn: 2, type: "enemy_killed", detail: "Skeleton defeated", data: { enemy_id: "s1", xp: 15 } },
    ]

    const summary = buildRunSummaryFromEvents(events, { floor: 1 })
    expect(summary.enemies_killed).toBe(2)
    expect(summary.xp_earned).toBe(25)
  })

  it("records cause of death from last fatal enemy attack", async () => {
    const { buildRunSummaryFromEvents } = await import("../src/game/session-persistence.js")

    const events: GameEvent[] = [
      { turn: 1, type: "enemy_attack", detail: "Goblin strikes", data: { damage: 10, player_hp: 30 } },
      { turn: 2, type: "enemy_attack", detail: "Dragon breathes fire", data: { damage: 30, player_hp: 0 } },
    ]

    const summary = buildRunSummaryFromEvents(events, { floor: 3 })
    expect(summary.cause_of_death).toBe("Dragon breathes fire")
    expect(summary.damage_taken).toBe(40)
  })

  it("counts traps disarmed separately", async () => {
    const { buildRunSummaryFromEvents } = await import("../src/game/session-persistence.js")

    const events: GameEvent[] = [
      { turn: 1, type: "trap_disarmed", detail: "Disarmed trap", data: { item_id: "t1" } },
      { turn: 2, type: "interact", detail: "Chest", data: { target: "c1", category: "chest" } },
    ]

    const summary = buildRunSummaryFromEvents(events, { floor: 1 })
    expect(summary.traps_disarmed).toBe(1)
    expect(summary.chests_opened).toBe(1)
  })

  it("handles events with missing category (legacy) as non-chest", async () => {
    const { buildRunSummaryFromEvents } = await import("../src/game/session-persistence.js")

    const events: GameEvent[] = [
      { turn: 1, type: "interact", detail: "Something", data: { target: "x1" } },
    ]

    const summary = buildRunSummaryFromEvents(events, { floor: 1 })
    expect(summary.chests_opened).toBe(0)
  })
})

// ── 8.5 — SeededRng state serialization ─────────────────────────────────────

describe("8.5 — SeededRng state persistence", () => {
  it("getState returns the internal state value", () => {
    const rng = new SeededRng(12345)
    const state = rng.getState()
    expect(typeof state).toBe("number")
    expect(state).toBe(12345 >>> 0)
  })

  it("setState restores RNG to produce identical sequence", () => {
    const rng1 = new SeededRng(42)
    rng1.next()
    rng1.next()
    rng1.next()
    const savedState = rng1.getState()

    const seq1 = [rng1.next(), rng1.next(), rng1.next()]

    const rng2 = new SeededRng(0)
    rng2.setState(savedState)
    const seq2 = [rng2.next(), rng2.next(), rng2.next()]

    expect(seq1).toEqual(seq2)
  })

  it("resumed RNG diverges from fresh seed+turn RNG after mid-turn advances", () => {
    const seed = 100
    const turn = 5

    const rngOriginal = new SeededRng(seed + turn)
    rngOriginal.next()
    rngOriginal.next()
    const savedState = rngOriginal.getState()
    const nextFromSaved = rngOriginal.next()

    const rngFresh = new SeededRng(seed + turn)
    const nextFromFresh = rngFresh.next()

    const rngRestored = new SeededRng(0)
    rngRestored.setState(savedState)
    const nextFromRestored = rngRestored.next()

    expect(nextFromRestored).toBe(nextFromSaved)
    expect(nextFromFresh).not.toBe(nextFromSaved)
  })
})
