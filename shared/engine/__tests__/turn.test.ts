import { describe, expect, it } from "bun:test"
import type { Action, GameState, Tile } from "@adventure-fun/schemas"
import { computeLegalActions, resolveTurn } from "../src/turn.js"
import { SeededRng } from "../src/rng.js"
import type { GeneratedRealm } from "../src/realm.js"

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

function makeRealm(roomId = "f1_r1_test-room"): GeneratedRealm {
  return {
    template_id: "tutorial-cellar",
    template_version: 1,
    seed: 1,
    total_floors: 1,
    floors: [
      {
        floor_number: 1,
        entrance_room_id: roomId,
        exit_room_id: null,
        boss_room_id: null,
        rooms: [
          {
            id: roomId,
            type: "test-room",
            width: 6,
            height: 4,
            tiles: makeTiles(6, 4),
            enemy_ids: [],
            item_ids: [],
            trap_ids: [],
            connections: [],
            description_first_visit: "Test room",
            description_revisit: null,
          },
        ],
      },
    ],
  }
}

function makeState(overrides?: Partial<GameState>): GameState {
  return {
    turn: 0,
    realm: {
      template_id: "tutorial-cellar",
      template_version: 1,
      seed: 1,
      total_floors: 1,
    },
    character: {
      id: "player-1",
      class: "knight",
      level: 1,
      xp: 0,
      gold: 0,
      hp: { current: 40, max: 40 },
      resource: { type: "stamina", current: 10, max: 10 },
      stats: {
        hp: 40,
        attack: 20,
        defense: 8,
        accuracy: 999,
        evasion: 10,
        speed: 10,
      },
      effective_stats: {
        hp: 40,
        attack: 20,
        defense: 8,
        accuracy: 999,
        evasion: 10,
        speed: 10,
      },
      buffs: [],
      debuffs: [],
      abilities: ["knight-slash", "knight-shield-block"],
      cooldowns: {},
    },
    position: {
      floor: 1,
      room_id: "f1_r1_test-room",
      tile: { x: 1, y: 1 },
    },
    inventory: [],
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
          tiles: makeTiles(6, 4),
          enemies: [
            {
              id: "enemy-1",
              template_id: "hollow-rat",
              hp: 15,
              hp_max: 15,
              position: { x: 2, y: 1 },
              effects: [],
              cooldowns: {},
            },
          ],
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

describe("resolveTurn ability system", () => {
  it("uses player abilities with resource costs and cooldowns", () => {
    const state = makeState()
    const realm = makeRealm()

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "knight-slash" },
      realm,
      new SeededRng(1),
    )

    expect(result.newState.character.resource.current).toBe(8)
    expect(result.newState.character.cooldowns["knight-slash"]).toBeUndefined()
    expect(
      result.newState.activeFloor.rooms[0]?.enemies[0]?.hp,
    ).toBeLessThan(15)
  })

  it("prevents a stunned player from acting", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        debuffs: [{ type: "stun", turns_remaining: 1, magnitude: 1 }],
      },
    })

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "knight-slash" },
      makeRealm(),
      new SeededRng(1),
    )

    expect(result.summary).toContain("stunned")
    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.hp).toBe(15)
  })
})

describe("computeLegalActions ranged abilities", () => {
  it("offers ranged attacks for distant valid targets", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        class: "archer",
        resource: { type: "focus", current: 8, max: 8 },
        abilities: ["archer-aimed-shot", "archer-quick-shot"],
        stats: {
          hp: 35,
          attack: 16,
          defense: 6,
          accuracy: 999,
          evasion: 12,
          speed: 12,
        },
        effective_stats: {
          hp: 35,
          attack: 16,
          defense: 6,
          accuracy: 999,
          evasion: 12,
          speed: 12,
        },
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(6, 4),
            enemies: [
              {
                id: "enemy-1",
                template_id: "hollow-rat",
                hp: 15,
                hp_max: 15,
                position: { x: 4, y: 1 },
                effects: [],
                cooldowns: {},
              },
            ],
            items: [],
          },
        ],
      },
    })

    const actions = computeLegalActions(
      state,
      state.activeFloor.rooms[0],
      makeRealm(),
    )

    expect(
      actions.some(
        (action) =>
          action.type === "attack" &&
          action.ability_id === "archer-aimed-shot" &&
          action.target_id === "enemy-1",
      ),
    ).toBe(true)
    expect(
      actions.some(
        (action) =>
          action.type === "attack" &&
          (action.ability_id === undefined || action.ability_id === "basic-attack") &&
          action.target_id === "enemy-1",
      ),
    ).toBe(false)
  })
})

describe("resource regeneration", () => {
  it("regenerates knight stamina each turn", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        resource: { type: "stamina", current: 5, max: 10 },
      },
    })

    const result = resolveTurn(
      state,
      { type: "wait" },
      makeRealm(),
      new SeededRng(2),
    )

    expect(result.newState.character.resource.current).toBe(6)
  })

  it("resets rogue energy on burst turns", () => {
    const rogueState = makeState({
      turn: 2,
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 1, max: 6 },
        abilities: ["rogue-backstab", "rogue-dodge-roll"],
      },
    })

    const result = resolveTurn(
      rogueState,
      { type: "wait" },
      makeRealm(),
      new SeededRng(3),
    )

    expect(result.newState.character.resource.current).toBe(6)
  })
})

describe("enemy ability turns", () => {
  it("lets enemies use ranged abilities instead of only moving adjacent", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        hp: { current: 80, max: 80 },
        stats: {
          hp: 80,
          attack: 20,
          defense: 8,
          accuracy: 999,
          evasion: 10,
          speed: 10,
        },
        effective_stats: {
          hp: 80,
          attack: 20,
          defense: 8,
          accuracy: 999,
          evasion: 10,
          speed: 10,
        },
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(6, 4),
            enemies: [
              {
                id: "enemy-1",
                template_id: "necromancer",
                hp: 65,
                hp_max: 65,
                position: { x: 4, y: 1 },
                effects: [],
                cooldowns: {},
              },
            ],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "wait" },
      makeRealm(),
      new SeededRng(1),
    )

    expect(result.newState.character.hp.current).toBeLessThan(80)
    expect(
      result.observation.recent_events.some(
        (event) =>
          event.type === "enemy_attack" &&
          event.data["ability_id"] === "death-bolt",
      ),
    ).toBe(true)
  })
})
