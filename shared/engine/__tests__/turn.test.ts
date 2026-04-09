import { describe, expect, it } from "bun:test"
import type { Action, GameState, Tile } from "@adventure-fun/schemas"
import { buildObservationFromState, computeLegalActions, resolveTurn } from "../src/turn.js"
import { SeededRng } from "../src/rng.js"
import { xpForLevel } from "../src/leveling.js"
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
      skill_tree: {},
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

function makeEnemy(
  overrides?: Partial<GameState["activeFloor"]["rooms"][number]["enemies"][number]>,
): GameState["activeFloor"]["rooms"][number]["enemies"][number] {
  return {
    id: "enemy-1",
    template_id: "hollow-rat",
    hp: 15,
    hp_max: 15,
    position: { x: 2, y: 1 },
    effects: [],
    cooldowns: {},
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

describe("enemy behaviors", () => {
  it("keeps aggressive enemies moving toward the player", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "skeleton-warrior",
                hp: 35,
                hp_max: 35,
                position: { x: 5, y: 1 },
              }),
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
      new SeededRng(11),
    )

    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.position).toEqual({ x: 4, y: 1 })
  })

  it("makes low-health defensive enemies retreat instead of attacking", () => {
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
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "necromancer",
                hp: 20,
                hp_max: 65,
                position: { x: 2, y: 1 },
              }),
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
      new SeededRng(12),
    )

    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.position).toEqual({ x: 3, y: 1 })
    expect(result.newState.character.hp.current).toBe(80)
  })

  it("makes defensive enemies favor self-buffs when they are weakened", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "necromancer",
                hp: 20,
                hp_max: 65,
                position: { x: 4, y: 1 },
              }),
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
      new SeededRng(13),
    )

    expect(result.observation.recent_events.some((event) => event.type === "enemy_attack" && (
      event.data["ability_id"] === "raise-dead" || event.data["ability_id"] === "bone-shield"
    ))).toBe(true)
    expect(
      result.newState.activeFloor.rooms[0]?.enemies[0]?.effects.some(
        (effect) => effect.type === "buff-attack" || effect.type === "buff-defense",
      ),
    ).toBe(true)
  })

  it("keeps patrol enemies idle until the player enters their detection range", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(9, 4),
            enemies: [
              makeEnemy({
                template_id: "stone-golem",
                hp: 80,
                hp_max: 80,
                position: { x: 7, y: 1 },
                cooldowns: { "stone-skin": 2 },
              }),
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
      new SeededRng(14),
    )

    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.position).toEqual({ x: 7, y: 1 })
    expect(
      result.observation.recent_events.some((event) => event.data["enemy_id"] === "enemy-1"),
    ).toBe(false)
  })

  it("lets patrol enemies engage once the player is close enough", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(9, 4),
            enemies: [
              makeEnemy({
                template_id: "stone-golem",
                hp: 80,
                hp_max: 80,
                position: { x: 5, y: 1 },
                cooldowns: { "stone-skin": 2 },
              }),
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
      new SeededRng(15),
    )

    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.position).toEqual({ x: 4, y: 1 })
  })

  it("keeps ambush enemies still until the player enters their trigger range", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "ghost",
                hp: 28,
                hp_max: 28,
                position: { x: 6, y: 1 },
                cooldowns: { "phase-shift": 2 },
              }),
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
      new SeededRng(16),
    )

    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.position).toEqual({ x: 6, y: 1 })
    expect(
      result.observation.recent_events.some((event) => event.data["enemy_id"] === "enemy-1"),
    ).toBe(false)
  })

  it("lets ambush enemies act once the player is within trigger range", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "ghost",
                hp: 28,
                hp_max: 28,
                position: { x: 3, y: 1 },
                cooldowns: { "phase-shift": 2 },
              }),
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
      new SeededRng(17),
    )

    expect(result.observation.recent_events.some((event) => event.type === "enemy_attack")).toBe(true)
  })
})

describe("boss phase transitions", () => {
  it("activates boss phases once HP crosses a threshold", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        hp: { current: 90, max: 90 },
        stats: {
          hp: 90,
          attack: 20,
          defense: 8,
          accuracy: 999,
          evasion: 10,
          speed: 10,
        },
        effective_stats: {
          hp: 90,
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
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "hollow-warden",
                hp: 70,
                hp_max: 150,
                position: { x: 4, y: 1 },
              }),
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
      new SeededRng(18),
    )

    expect(result.observation.recent_events.some((event) => event.type === "boss_phase")).toBe(true)
    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.boss_phase_index).toBe(0)
    expect(
      result.newState.activeFloor.rooms[0]?.enemies[0]?.effects.some(
        (effect) => effect.type === "buff-attack",
      ),
    ).toBe(true)
  })

  it("removes abilities excluded by later boss phases", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        hp: { current: 100, max: 100 },
        stats: {
          hp: 100,
          attack: 20,
          defense: 8,
          accuracy: 999,
          evasion: 10,
          speed: 10,
        },
        effective_stats: {
          hp: 100,
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
            tiles: makeTiles(9, 4),
            enemies: [
              makeEnemy({
                template_id: "iron-sentinel",
                hp: 100,
                hp_max: 320,
                position: { x: 5, y: 1 },
                cooldowns: {
                  "emergency-repair": 2,
                  "lockdown-protocol": 2,
                },
              }),
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
      new SeededRng(19),
    )

    expect(
      result.observation.recent_events.some(
        (event) => event.type === "enemy_attack" && event.data["ability_id"] === "cannon-blast",
      ),
    ).toBe(false)
    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.position).toEqual({ x: 4, y: 1 })
    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.boss_phase_index).toBe(1)
  })

  it("tracks the deepest active phase for multi-phase bosses", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "lich-king",
                hp: 30,
                hp_max: 280,
                position: { x: 4, y: 1 },
              }),
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
      new SeededRng(20),
    )

    expect(result.newState.activeFloor.rooms[0]?.enemies[0]?.boss_phase_index).toBe(2)
    expect(result.observation.recent_events.some((event) => event.type === "boss_phase")).toBe(true)
  })

  it("does not re-emit the same boss phase after it has already been triggered", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "hollow-warden",
                hp: 70,
                hp_max: 150,
                position: { x: 4, y: 1 },
                boss_phase_index: 0,
              }),
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
      new SeededRng(21),
    )

    expect(result.observation.recent_events.some((event) => event.type === "boss_phase")).toBe(false)
  })
})

describe("enemy observations", () => {
  it("includes enemy behavior, boss state, and effects for visible enemies", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "hollow-warden",
                hp: 90,
                hp_max: 150,
                position: { x: 4, y: 1 },
                boss_phase_index: 0,
                effects: [{ type: "buff-defense", turns_remaining: 2, magnitude: 6 }],
              }),
            ],
            items: [],
          },
        ],
      },
    })

    const observation = buildObservationFromState(state, [], makeRealm())
    const entity = observation.visible_entities.find(
      (visibleEntity) => visibleEntity.type === "enemy" && visibleEntity.id === "enemy-1",
    )

    expect(entity).toMatchObject({
      behavior: "boss",
      is_boss: true,
      hp_current: 90,
      hp_max: 150,
    })
    expect(entity?.effects).toEqual([
      { type: "buff-defense", turns_remaining: 2, magnitude: 6 },
    ])
  })

  it("adds room-text hints for distant ambush enemies", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({
                template_id: "ghost",
                hp: 28,
                hp_max: 28,
                position: { x: 4, y: 1 },
              }),
            ],
            items: [],
          },
        ],
      },
    })

    const observation = buildObservationFromState(state, [], makeRealm())

    expect(observation.room_text).toContain("lurks motionless")
  })
})

describe("level-up on enemy defeat", () => {
  it("triggers level-up when XP crosses the level 2 threshold", () => {
    const xpNeeded = xpForLevel(2) // 100
    const state = makeState({
      character: {
        ...makeState().character,
        xp: xpNeeded - 10, // 10 XP from hollow-rat will push over
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ hp: 1, hp_max: 15 })],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "knight-slash" },
      makeRealm(),
      new SeededRng(1),
    )

    expect(result.newState.character.level).toBe(2)
    expect(result.newState.character.xp).toBeGreaterThanOrEqual(xpNeeded)

    const levelUpEvent = result.observation.recent_events.find(
      (e) => e.type === "level_up",
    )
    expect(levelUpEvent).toBeDefined()
    expect(levelUpEvent!.data.new_level).toBe(2)
  })

  it("applies stat_growth from class template on level-up", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        xp: xpForLevel(2) - 10,
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ hp: 1, hp_max: 15 })],
            items: [],
          },
        ],
      },
    })

    const beforeHpMax = state.character.hp.max
    const beforeAttack = state.character.stats.attack
    const beforeDefense = state.character.stats.defense

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "knight-slash" },
      makeRealm(),
      new SeededRng(1),
    )

    // Knight stat_growth: hp: 12, attack: 2, defense: 2
    expect(result.newState.character.hp.max).toBe(beforeHpMax + 12)
    expect(result.newState.character.stats.attack).toBe(beforeAttack + 2)
    expect(result.newState.character.stats.defense).toBe(beforeDefense + 2)
  })

  it("does not level up when XP is insufficient", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        xp: 0,
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ hp: 1, hp_max: 15 })],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "knight-slash" },
      makeRealm(),
      new SeededRng(1),
    )

    expect(result.newState.character.level).toBe(1)
    const levelUpEvent = result.observation.recent_events.find(
      (e) => e.type === "level_up",
    )
    expect(levelUpEvent).toBeUndefined()
  })

  it("observation includes xp_to_next_level and skill_points", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        level: 3,
        xp: xpForLevel(3) + 50,
      },
    })

    const obs = buildObservationFromState(state, [], makeRealm())

    expect(obs.character.xp_to_next_level).toBe(
      xpForLevel(4) - state.character.xp,
    )
    expect(obs.character.skill_points).toBe(2) // level 3 → 2 points, 0 spent
    expect(obs.character.skill_tree).toEqual({})
  })
})
