import { describe, expect, it } from "bun:test"
import type { GameState, Tile } from "@adventure-fun/schemas"
import { xpForLevel } from "@adventure-fun/engine"
import { applyExtractionOutcome } from "../src/game/session.js"

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
    turn: 12,
    realm: {
      template_id: "tutorial-cellar",
      template_version: 1,
      seed: 7,
      total_floors: 1,
    },
    character: {
      id: "char-1",
      class: "knight",
      level: 1,
      xp: 25,
      gold: 10,
      hp: { current: 40, max: 40 },
      resource: { type: "stamina", current: 10, max: 10 },
      stats: {
        hp: 40,
        attack: 20,
        defense: 8,
        accuracy: 12,
        evasion: 10,
        speed: 10,
      },
      effective_stats: {
        hp: 40,
        attack: 20,
        defense: 8,
        accuracy: 12,
        evasion: 10,
        speed: 10,
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
      tile: { x: 1, y: 1 },
    },
    inventory: [
      {
        id: "loot-1",
        template_id: "minor-healing-potion",
        name: "Minor Healing Potion",
        quantity: 2,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-1",
        slot: null,
      },
    ],
    equipment: {
      weapon: null,
      armor: null,
      accessory: null,
      "class-specific": null,
    },
    activeFloor: {
      rooms: [
        {
          id: "f1_r1_test-room",
          tiles: makeTiles(4, 4),
          enemies: [],
          items: [],
        },
      ],
    },
    discoveredTiles: { 1: [{ x: 1, y: 1 }] },
    mutatedEntities: [],
    realmStatus: "active",
    ...overrides,
  }
}

describe("applyExtractionOutcome", () => {
  it("adds completion rewards for boss-cleared realms", () => {
    const state = makeState({
      realmStatus: "boss_cleared",
    })

    const result = applyExtractionOutcome(state)

    expect(state.character.xp).toBe(50)
    expect(state.character.gold).toBe(25)
    expect(result).toMatchObject({
      xp_gained: 25,
      gold_gained: 15,
      realm_completed: true,
      completion_bonus: { xp: 25, gold: 15 },
    })
    expect(result.loot_summary).toHaveLength(1)
  })

  it("adds completion rewards for bossless realms cleared with realm_cleared", () => {
    const state = makeState({
      realmStatus: "realm_cleared",
    })

    const result = applyExtractionOutcome(state)

    expect(state.character.xp).toBe(50)
    expect(state.character.gold).toBe(25)
    expect(result).toMatchObject({
      xp_gained: 25,
      gold_gained: 15,
      realm_completed: true,
      completion_bonus: { xp: 25, gold: 15 },
    })
  })

  it("does not add completion rewards for non-completed runs", () => {
    const state = makeState({
      realmStatus: "active",
    })

    const result = applyExtractionOutcome(state)

    expect(state.character.xp).toBe(25)
    expect(state.character.gold).toBe(10)
    expect(result.completion_bonus).toBeUndefined()
    expect(result.realm_completed).toBe(false)
    expect(result.xp_gained).toBe(0)
    expect(result.gold_gained).toBe(0)
  })

  it("applies level-up growth when completion rewards cross a threshold", () => {
    const state = makeState({
      realmStatus: "boss_cleared",
      character: {
        ...makeState().character,
        xp: xpForLevel(2) - 10,
      },
    })

    const result = applyExtractionOutcome(state)

    expect(state.character.level).toBe(2)
    expect(state.character.hp.max).toBe(42)
    expect(state.character.hp.current).toBe(42)
    expect(state.character.stats.attack).toBe(21)
    expect(state.character.stats.defense).toBe(9)
    expect(result.realm_completed).toBe(true)
  })

  it("treats realm_cleared as a completed run for the extraction payload", () => {
    const state = makeState({
      realmStatus: "realm_cleared",
    })

    const result = applyExtractionOutcome(state)

    expect(result.realm_completed).toBe(true)
    expect(result.completion_bonus).toEqual({ xp: 25, gold: 15 })
  })

  it("returns frontend-ready loot summaries with item names", () => {
    const state = makeState({
      realmStatus: "boss_cleared",
    })

    const result = applyExtractionOutcome(state, new Set())

    expect(result.loot_summary).toEqual([
      {
        item_id: "loot-1",
        template_id: "minor-healing-potion",
        name: "Minor Healing Potion",
        quantity: 2,
        modifiers: {},
      },
    ])
  })

  it("excludes pre-existing inventory items from the loot summary", () => {
    const state = makeState({
      inventory: [
        {
          id: "starting-potion",
          template_id: "minor-healing-potion",
          name: "Minor Healing Potion",
          quantity: 2,
          modifiers: {},
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
        },
        {
          id: "starting-bomb",
          template_id: "bomb",
          name: "Bomb",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
        },
        {
          id: "realm-loot-1",
          template_id: "portal-scroll",
          name: "Portal Scroll",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
        },
      ],
    })

    const result = applyExtractionOutcome(
      state,
      new Set(["starting-potion", "starting-bomb"]),
    )

    expect(result.loot_summary).toEqual([
      {
        item_id: "realm-loot-1",
        template_id: "portal-scroll",
        name: "Portal Scroll",
        quantity: 1,
        modifiers: {},
      },
    ])
  })

  it("includes all inventory items when the session started empty", () => {
    const state = makeState({
      inventory: [
        {
          id: "realm-loot-1",
          template_id: "portal-scroll",
          name: "Portal Scroll",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
        },
        {
          id: "realm-loot-2",
          template_id: "minor-healing-potion",
          name: "Minor Healing Potion",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
        },
      ],
    })

    const result = applyExtractionOutcome(state, new Set())

    expect(result.loot_summary.map((item) => item.item_id)).toEqual([
      "realm-loot-1",
      "realm-loot-2",
    ])
  })

  it("excludes items that were equipped at session start and unequipped before extraction", () => {
    const state = makeState({
      inventory: [
        {
          id: "starting-weapon",
          template_id: "rusted-sword",
          name: "Rusted Sword",
          quantity: 1,
          modifiers: { attack: 2 },
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
        },
        {
          id: "realm-loot-1",
          template_id: "portal-scroll",
          name: "Portal Scroll",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "char-1",
          slot: null,
        },
      ],
    })

    const result = applyExtractionOutcome(state, new Set(["starting-weapon"]))

    expect(result.loot_summary).toEqual([
      {
        item_id: "realm-loot-1",
        template_id: "portal-scroll",
        name: "Portal Scroll",
        quantity: 1,
        modifiers: {},
      },
    ])
  })

  it("handles empty inventory gracefully", () => {
    const state = makeState({
      inventory: [],
    })

    const result = applyExtractionOutcome(state, new Set(["starting-potion"]))

    expect(result.loot_summary).toEqual([])
  })
})
