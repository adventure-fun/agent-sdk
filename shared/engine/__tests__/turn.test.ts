import { describe, expect, it } from "bun:test"
import { getInventoryCapacity, type Action, type GameState, type Tile } from "@adventure-fun/schemas"
import { CLASSES } from "../src/content.js"
import { buildObservationFromState, buildRoomState, computeLegalActions, resolveTurn } from "../src/turn.js"
import { SeededRng } from "../src/rng.js"
import { xpForLevel } from "../src/leveling.js"
import type { GeneratedRealm, GeneratedRoom } from "../src/realm.js"

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function makeTilesWithTransitions(
  width: number,
  height: number,
  transitions: Array<{ x: number; y: number; type: Tile["type"] }>,
): Tile[][] {
  const tiles = makeTiles(width, height)
  for (const transition of transitions) {
    const row = tiles[transition.y]
    const tile = row?.[transition.x]
    if (row && tile) {
      row[transition.x] = { ...tile, type: transition.type }
    }
  }
  return tiles
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

function makeBosslessRealm(): GeneratedRealm {
  return {
    template_id: "tutorial-cellar",
    template_version: 1,
    seed: 1,
    total_floors: 2,
    floors: [
      {
        floor_number: 1,
        entrance_room_id: "f1_r1_entry",
        exit_room_id: "f1_r2_mid",
        boss_room_id: null,
        rooms: [
          makeGeneratedRoom("f1_r1_entry", 6, 4),
          makeGeneratedRoom("f1_r2_mid", 6, 4),
        ],
      },
      {
        floor_number: 2,
        entrance_room_id: "f2_r1_entry",
        exit_room_id: null,
        boss_room_id: null,
        rooms: [
          makeGeneratedRoom("f2_r1_entry", 6, 4),
          makeGeneratedRoom("f2_r2_final", 6, 4),
        ],
      },
    ],
  }
}

function makeTraversalRealm(): GeneratedRealm {
  return {
    template_id: "tutorial-cellar",
    template_version: 1,
    seed: 7,
    total_floors: 2,
    floors: [
      {
        floor_number: 1,
        entrance_room_id: "f1_r1_entry",
        exit_room_id: "f1_r1_entry",
        boss_room_id: null,
        rooms: [
          makeGeneratedRoom("f1_r1_entry", 6, 5, {
            tiles: makeTilesWithTransitions(6, 5, [{ x: 5, y: 2, type: "stairs" }]),
          }),
        ],
      },
      {
        floor_number: 2,
        entrance_room_id: "f2_r1_entry",
        exit_room_id: null,
        boss_room_id: null,
        rooms: [
          makeGeneratedRoom("f2_r1_entry", 6, 5, {
            tiles: makeTilesWithTransitions(6, 5, [{ x: 0, y: 2, type: "stairs_up" }]),
          }),
        ],
      },
    ],
  }
}

function makeGeneratedRoom(
  roomId: string,
  width: number,
  height: number,
  overrides?: Partial<GeneratedRoom>,
): GeneratedRoom {
  return {
    id: roomId,
    type: "test-room",
    width,
    height,
    tiles: makeTiles(width, height),
    enemy_ids: [],
    item_ids: [],
    trap_ids: [],
    connections: [],
    description_first_visit: "Test room",
    description_revisit: "Visited room",
    ...overrides,
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
      helm: null,
      hands: null,
      accessory: null,
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
    roomsVisited: {},
    loreDiscovered: [],
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

function makeFloorItem(
  overrides?: Partial<GameState["activeFloor"]["rooms"][number]["items"][number]>,
): GameState["activeFloor"]["rooms"][number]["items"][number] {
  return {
    id: "f1_r1_bh-corrupted-heart_loot_00",
    template_id: "health-potion",
    quantity: 1,
    position: { x: 2, y: 1 },
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
      inventory: [
        {
          id: "arrows-1",
          template_id: "ammo-arrows-10",
          name: "Normal Arrow",
          quantity: 10,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
          slot: null,
        },
      ],
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

describe("equipment legal actions", () => {
  it("offers equip and unequip actions for usable gear", () => {
    const state = makeState({
      inventory: [
        {
          id: "bag-weapon",
          template_id: "iron-sword",
          name: "Iron Sword",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
          slot: null,
        },
      ],
      equipment: {
        weapon: {
          id: "equipped-ring",
          template_id: "iron-ring",
          name: "Iron Ring",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
          slot: "weapon",
        },
        armor: null,
        helm: null,
        hands: null,
        accessory: null,
      },
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())

    expect(actions).toContainEqual({ type: "equip", item_id: "bag-weapon" })
    expect(actions).toContainEqual({ type: "unequip", slot: "weapon" })
  })

  it("omits off-class equipment from legal actions and rejects equipping it", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        class: "mage",
      },
      inventory: [
        {
          id: "bag-shield",
          template_id: "wooden-shield",
          name: "Wooden Shield",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
          slot: null,
        },
      ],
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())
    expect(actions).not.toContainEqual({ type: "equip", item_id: "bag-shield" })

    const result = resolveTurn(
      state,
      { type: "equip", item_id: "bag-shield" },
      makeRealm(),
      new SeededRng(34),
    )
    expect(result.summary).toContain("cannot equip")
    expect(result.newState.equipment.armor).toBeNull()
  })
})

describe("portal, retreat, and extraction legal actions", () => {
  function makePortalScroll() {
    return {
      id: "portal-scroll-1",
      template_id: "portal-scroll",
      name: "Portal Scroll",
      quantity: 1,
      modifiers: {},
      owner_type: "character" as const,
      owner_id: "player-1",
      slot: null,
    }
  }

  it("does not offer use_portal when the room is clear but no portal is available", () => {
    const state = makeState({
      activeFloor: {
        rooms: [{ ...makeState().activeFloor.rooms[0]!, enemies: [] }],
      },
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())

    expect(actions.some((action) => action.type === "use_portal")).toBe(false)
  })

  it("offers use_portal when the player has a portal scroll", () => {
    const state = makeState({
      inventory: [makePortalScroll()],
      activeFloor: {
        rooms: [{ ...makeState().activeFloor.rooms[0]!, enemies: [] }],
      },
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())

    expect(actions.some((action) => action.type === "use_portal")).toBe(true)
  })

  it("offers use_portal when a portal is already active", () => {
    const state = makeState({
      activeFloor: {
        rooms: [{ ...makeState().activeFloor.rooms[0]!, enemies: [] }],
      },
    }) as GameState & { portalActive?: boolean }
    state.portalActive = true

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())

    expect(actions.some((action) => action.type === "use_portal")).toBe(true)
  })

  it("does not offer use_portal while enemies are alive even with a portal scroll", () => {
    const state = makeState({
      inventory: [makePortalScroll()],
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())

    expect(actions.some((action) => action.type === "use_portal")).toBe(false)
  })

  it("only offers retreat from the entrance on floor 1", () => {
    const state = makeState({
      activeFloor: {
        rooms: [{ ...makeState().activeFloor.rooms[0]!, enemies: [] }],
      },
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())

    expect(actions.some((action) => action.type === "retreat")).toBe(true)
  })

  it("does not offer retreat outside the entrance room", () => {
    const state = makeState({
      activeFloor: {
        rooms: [{ ...makeState().activeFloor.rooms[0]!, enemies: [] }],
      },
    })
    const realm = {
      ...makeRealm(),
      floors: [
        {
          ...makeRealm().floors[0]!,
          entrance_room_id: "f1_r0_entrance",
        },
      ],
    }

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], realm)

    expect(actions.some((action) => action.type === "retreat")).toBe(false)
  })

  it("does not offer retreat on deeper floors", () => {
    const state = makeState({
      position: {
        floor: 2,
        room_id: "f1_r1_test-room",
        tile: { x: 1, y: 1 },
      },
      activeFloor: {
        rooms: [{ ...makeState().activeFloor.rooms[0]!, enemies: [] }],
      },
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())

    expect(actions.some((action) => action.type === "retreat")).toBe(false)
  })

  it("consumes a portal scroll when use_portal resolves", () => {
    const state = makeState({
      inventory: [makePortalScroll()],
      activeFloor: {
        rooms: [{ ...makeState().activeFloor.rooms[0]!, enemies: [] }],
      },
    })

    const result = resolveTurn(
      state,
      { type: "use_portal" },
      makeRealm(),
      new SeededRng(22),
    )

    expect(result.newState.inventory).toHaveLength(0)
  })

  it("activates a portal when a portal scroll item is used", () => {
    const state = makeState({
      inventory: [makePortalScroll()],
      activeFloor: {
        rooms: [{ ...makeState().activeFloor.rooms[0]!, enemies: [] }],
      },
    }) as GameState & { portalActive?: boolean }

    const result = resolveTurn(
      state,
      { type: "use_item", item_id: "portal-scroll-1" },
      makeRealm(),
      new SeededRng(23),
    )

    expect((result.newState as GameState & { portalActive?: boolean }).portalActive).toBe(true)
  })
})

describe("bossless realm completion", () => {
  it("marks a bossless realm as cleared after the final room is defeated", () => {
    const state = makeState({
      position: {
        floor: 2,
        room_id: "f2_r2_final",
        tile: { x: 1, y: 1 },
      },
      activeFloor: {
        rooms: [
          {
            id: "f2_r2_final",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ id: "enemy-final", hp: 1, hp_max: 1 })],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-final" },
      makeBosslessRealm(),
      new SeededRng(1),
    )

    expect(result.newState.realmStatus).toBe("realm_cleared")
    expect(result.notableEvents).toContainEqual(
      expect.objectContaining({
        type: "realm_clear",
      }),
    )
  })

  it("does not mark a bossless realm as cleared when other rooms still have enemies", () => {
    const state = makeState({
      position: {
        floor: 2,
        room_id: "f2_r1_entry",
        tile: { x: 1, y: 1 },
      },
      activeFloor: {
        rooms: [
          {
            id: "f2_r1_entry",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ id: "enemy-mid", hp: 1, hp_max: 1 })],
            items: [],
          },
          {
            id: "f2_r2_final",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ id: "enemy-final", hp: 5, hp_max: 5 })],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-mid" },
      makeBosslessRealm(),
      new SeededRng(1),
    )

    expect(result.newState.realmStatus).toBe("active")
    expect(result.notableEvents).toEqual([])
  })

  it("does not mark a bossless realm as cleared on a non-final floor", () => {
    const state = makeState({
      position: {
        floor: 1,
        room_id: "f1_r2_mid",
        tile: { x: 1, y: 1 },
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r2_mid",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ id: "enemy-floor1", hp: 1, hp_max: 1 })],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-floor1" },
      makeBosslessRealm(),
      new SeededRng(1),
    )

    expect(result.newState.realmStatus).toBe("active")
    expect(result.notableEvents).toEqual([])
  })

  it("still marks boss realms with boss_cleared", () => {
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ id: "boss-1", template_id: "hollow-warden", hp: 1, hp_max: 1 })],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "boss-1" },
      makeRealm(),
      new SeededRng(1),
    )

    expect(result.newState.realmStatus).toBe("boss_cleared")
    expect(result.notableEvents).toContainEqual(
      expect.objectContaining({
        type: "boss_kill",
      }),
    )
  })
})

describe("floor traversal", () => {
  it("descends onto the next floor when stepping onto stairs", () => {
    const realm = makeTraversalRealm()
    const floorOneRoom = realm.floors[0]!.rooms[0]!
    const state = makeState({
      realm: {
        ...makeState().realm,
        total_floors: 2,
      },
      position: {
        floor: 1,
        room_id: floorOneRoom.id,
        tile: { x: 4, y: 2 },
      },
      activeFloor: {
        rooms: [
          {
            id: floorOneRoom.id,
            tiles: floorOneRoom.tiles,
            enemies: [],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "move", direction: "right" },
      realm,
      new SeededRng(3),
    )

    expect(result.newState.position.floor).toBe(2)
    expect(result.newState.position.room_id).toBe("f2_r1_entry")
    expect(result.newState.position.tile).toEqual({ x: 1, y: 2 })
    expect(result.summary).toContain("descend")
    expect(result.observation.recent_events).toContainEqual(
      expect.objectContaining({
        type: "floor_change",
        detail: "Descended to floor 2",
      }),
    )
  })

  it("ascends onto the previous floor when stepping onto stairs_up", () => {
    const realm = makeTraversalRealm()
    const floorTwoRoom = realm.floors[1]!.rooms[0]!
    const state = makeState({
      realm: {
        ...makeState().realm,
        total_floors: 2,
      },
      position: {
        floor: 2,
        room_id: floorTwoRoom.id,
        tile: { x: 1, y: 2 },
      },
      activeFloor: {
        rooms: [
          {
            id: floorTwoRoom.id,
            tiles: floorTwoRoom.tiles,
            enemies: [],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "move", direction: "left" },
      realm,
      new SeededRng(4),
    )

    expect(result.newState.position.floor).toBe(1)
    expect(result.newState.position.room_id).toBe("f1_r1_entry")
    expect(result.newState.position.tile).toEqual({ x: 4, y: 2 })
    expect(result.summary).toContain("ascend")
    expect(result.observation.recent_events).toContainEqual(
      expect.objectContaining({
        type: "floor_change",
        detail: "Ascended to floor 1",
      }),
    )
  })

  it("does not ascend above floor 1 even if a stairs_up tile is present", () => {
    const roomId = "f1_r1_entry"
    const roomTiles = makeTilesWithTransitions(6, 5, [{ x: 0, y: 2, type: "stairs_up" }])
    const state = makeState({
      position: {
        floor: 1,
        room_id: roomId,
        tile: { x: 1, y: 2 },
      },
      activeFloor: {
        rooms: [
          {
            id: roomId,
            tiles: roomTiles,
            enemies: [],
            items: [],
          },
        ],
      },
    })
    const realm = {
      ...makeRealm(roomId),
      floors: [
        {
          ...makeRealm(roomId).floors[0]!,
          rooms: [
            makeGeneratedRoom(roomId, 6, 5, {
              tiles: roomTiles,
            }),
          ],
        },
      ],
    }

    const result = resolveTurn(
      state,
      { type: "move", direction: "left" },
      realm,
      new SeededRng(5),
    )

    expect(result.newState.position.floor).toBe(1)
    expect(result.summary).toBe("You move left.")
  })

  it("does not descend past the final floor when no deeper floor exists", () => {
    const roomId = "f1_r1_entry"
    const roomTiles = makeTilesWithTransitions(6, 5, [{ x: 5, y: 2, type: "stairs" }])
    const state = makeState({
      position: {
        floor: 1,
        room_id: roomId,
        tile: { x: 4, y: 2 },
      },
      activeFloor: {
        rooms: [
          {
            id: roomId,
            tiles: roomTiles,
            enemies: [],
            items: [],
          },
        ],
      },
    })
    const realm = {
      ...makeRealm(roomId),
      floors: [
        {
          ...makeRealm(roomId).floors[0]!,
          rooms: [
            makeGeneratedRoom(roomId, 6, 5, {
              tiles: roomTiles,
            }),
          ],
        },
      ],
    }

    const result = resolveTurn(
      state,
      { type: "move", direction: "right" },
      realm,
      new SeededRng(6),
    )

    expect(result.newState.position.floor).toBe(1)
    expect(result.summary).toBe("You move right.")
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
    const beforeAccuracy = state.character.stats.accuracy
    const growth = CLASSES.knight!.stat_growth
    const expectedHpGain = Math.max(1, Math.round(beforeHpMax * growth.hp))
    const expectedAttackGain = Math.max(1, Math.round(beforeAttack * growth.attack))
    const expectedDefenseGain = Math.max(1, Math.round(beforeDefense * growth.defense))
    const expectedAccuracyGain = Math.max(1, Math.round(beforeAccuracy * growth.accuracy))

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "knight-slash" },
      makeRealm(),
      new SeededRng(1),
    )

    expect(result.newState.character.hp.max).toBe(beforeHpMax + expectedHpGain)
    expect(result.newState.character.stats.attack).toBe(beforeAttack + expectedAttackGain)
    expect(result.newState.character.stats.defense).toBe(beforeDefense + expectedDefenseGain)
    expect(result.newState.character.stats.accuracy).toBe(beforeAccuracy + expectedAccuracyGain)

    const levelUpEvent = result.observation.recent_events.find((event) => event.type === "level_up")
    expect(levelUpEvent?.data.stat_gains).toEqual({
      hp: expectedHpGain,
      attack: expectedAttackGain,
      defense: expectedDefenseGain,
      accuracy: expectedAccuracyGain,
      evasion: Math.max(1, Math.round(state.character.stats.evasion * growth.evasion)),
      speed: Math.max(1, Math.round(state.character.stats.speed * growth.speed)),
    })
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

describe("trap system", () => {
  const trapRoomId = "f1_r1_bh-corrupted-heart"

  function makeTrapRealm() {
    return makeRealm(trapRoomId)
  }

  function makeTrapState(
    overrides?: Partial<GameState>,
    itemOverrides?: Partial<GameState["activeFloor"]["rooms"][number]["items"][number]>,
  ) {
    return makeState({
      position: {
        floor: 1,
        room_id: trapRoomId,
        tile: { x: 2, y: 1 },
      },
      activeFloor: {
        rooms: [
          {
            id: trapRoomId,
            tiles: makeTiles(7, 7),
            enemies: [],
            items: [
              makeFloorItem({
                trapped: true,
                trap_damage: 12,
                trap_effect: {
                  type: "poison",
                  duration_turns: 3,
                  magnitude: 3,
                  apply_chance: 1,
                },
                ...itemOverrides,
              }),
            ],
          },
        ],
      },
      ...overrides,
    })
  }

  it("trapped chest triggers damage on pickup", () => {
    const state = makeTrapState()

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(result.newState.character.hp.current).toBe(28)
  })

  it("trapped chest applies status effect", () => {
    const state = makeTrapState()

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(result.newState.character.debuffs).toContainEqual({
      type: "poison",
      turns_remaining: 3,
      magnitude: 3,
    })
  })

  it("non-trapped item does not trigger trap", () => {
    const state = makeTrapState({}, { trapped: false, trap_effect: null })

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(result.newState.character.hp.current).toBe(40)
    expect(result.newState.character.debuffs).toEqual([])
  })

  it("rogue disarm neutralizes trap", () => {
    const state = makeTrapState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 5, max: 5 },
        abilities: ["rogue-backstab", "rogue-disarm-trap"],
      },
    })

    const disarm = resolveTurn(
      state,
      { type: "disarm_trap", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )
    const pickup = resolveTurn(
      disarm.newState,
      { type: "pickup", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(8),
    )

    expect(pickup.newState.character.hp.current).toBe(40)
    expect(pickup.newState.character.debuffs).toEqual([])
  })

  it("disarm costs resource", () => {
    const state = makeTrapState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 5, max: 5 },
        abilities: ["rogue-backstab", "rogue-disarm-trap"],
      },
    })

    const result = resolveTurn(
      state,
      { type: "disarm_trap", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(result.newState.character.resource.current).toBe(4)
  })

  it("disarm rejects non-adjacent item", () => {
    const state = makeTrapState({
      position: {
        floor: 1,
        room_id: trapRoomId,
        tile: { x: 6, y: 6 },
      },
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 5, max: 5 },
        abilities: ["rogue-backstab", "rogue-disarm-trap"],
      },
    })

    const result = resolveTurn(
      state,
      { type: "disarm_trap", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(result.summary).toContain("Too far away")
  })

  it("disarm rejects if ability not known", () => {
    const state = makeTrapState()

    const result = resolveTurn(
      state,
      { type: "disarm_trap", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(result.summary).toContain("cannot disarm")
  })

  it("emits a trap_triggered mutation on pickup", () => {
    const state = makeTrapState()

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(
      result.worldMutations.some(
        (mutation) =>
          mutation.entity_id === "f1_r1_bh-corrupted-heart_loot_00_trap" &&
          mutation.mutation === "trap_triggered",
      ),
    ).toBe(true)
  })

  it("emits a trap_disarmed event on disarm", () => {
    const state = makeTrapState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 5, max: 5 },
        abilities: ["rogue-backstab", "rogue-disarm-trap"],
      },
    })

    const result = resolveTurn(
      state,
      { type: "disarm_trap", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(result.observation.recent_events.some((event) => event.type === "trap_disarmed")).toBe(true)
  })

  it("computeLegalActions includes disarm_trap for Rogues near trapped chests", () => {
    const state = makeTrapState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 5, max: 5 },
        abilities: ["rogue-backstab", "rogue-disarm-trap"],
      },
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeTrapRealm())

    expect(
      actions.some(
        (action) => action.type === "disarm_trap" && action.item_id === "f1_r1_bh-corrupted-heart_loot_00",
      ),
    ).toBe(true)
  })

  it("computeLegalActions omits disarm_trap for non-Rogues", () => {
    const state = makeTrapState()

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeTrapRealm())

    expect(actions.some((action) => action.type === "disarm_trap")).toBe(false)
  })

  it("player can die from trap damage", () => {
    const state = makeTrapState({
      character: {
        ...makeState().character,
        hp: { current: 12, max: 40 },
      },
    })

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(result.newState.character.hp.current).toBe(0)
  })

  it("trap with null effect only deals damage", () => {
    const state = makeTrapState({}, { trap_effect: null })

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: "f1_r1_bh-corrupted-heart_loot_00" },
      makeTrapRealm(),
      new SeededRng(7),
    )

    expect(result.newState.character.hp.current).toBe(28)
    expect(result.newState.character.debuffs).toEqual([])
  })
})

describe("realm pickup persistence", () => {
  it("assigns picked-up floor loot a fresh UUID inventory id", () => {
    const floorItemId = "f1_r1_pickup-room_loot_00"
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            ...makeState().activeFloor.rooms[0]!,
            enemies: [],
            items: [makeFloorItem({ id: floorItemId, template_id: "antidote" })],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: floorItemId },
      makeRealm(),
      new SeededRng(31),
    )

    expect(result.newState.inventory).toHaveLength(1)
    expect(result.newState.inventory[0]?.id).toMatch(UUID_REGEX)
    expect(result.newState.inventory[0]?.id).not.toBe(floorItemId)
  })

  it("keeps the looted world mutation keyed by the floor entity id", () => {
    const floorItemId = "f1_r1_pickup-room_loot_01"
    const state = makeState({
      activeFloor: {
        rooms: [
          {
            ...makeState().activeFloor.rooms[0]!,
            enemies: [],
            items: [makeFloorItem({ id: floorItemId, template_id: "portal-scroll" })],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: floorItemId },
      makeRealm(),
      new SeededRng(32),
    )

    expect(result.worldMutations).toContainEqual(
      expect.objectContaining({
        entity_id: floorItemId,
        mutation: "looted",
      }),
    )
    expect(result.newState.mutatedEntities).toContain(floorItemId)
  })

  it("merges stacked pickups without creating a new inventory entry", () => {
    const existingItemId = "0f6a3f8c-e8ce-4c8d-88f6-d75ea3c0db6d"
    const floorItemId = "f1_r1_pickup-room_loot_02"
    const state = makeState({
      inventory: [
        {
          id: existingItemId,
          template_id: "health-potion",
          name: "Health Potion",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
        },
      ],
      activeFloor: {
        rooms: [
          {
            ...makeState().activeFloor.rooms[0]!,
            enemies: [],
            items: [makeFloorItem({ id: floorItemId, template_id: "health-potion" })],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: floorItemId },
      makeRealm(),
      new SeededRng(33),
    )

    expect(result.newState.inventory).toHaveLength(1)
    expect(result.newState.inventory[0]).toMatchObject({
      id: existingItemId,
      quantity: 2,
    })
  })

  it("marks freshly collected bag items in the observation payload", () => {
    const acquiredItemId = "7be6bcb6-09bc-4bbb-bf17-01ebf675ffa2"
    const state = makeState({
      inventory: [
        {
          id: "c3de3c0d-15e4-46bc-9a6c-b6d53590a6e4",
          template_id: "minor-healing-potion",
          name: "Minor Healing Potion",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
        },
        {
          id: acquiredItemId,
          template_id: "portal-scroll",
          name: "Portal Scroll",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
        },
      ],
      activeFloor: {
        rooms: [{ ...makeState().activeFloor.rooms[0]!, enemies: [], items: [] }],
      },
    })

    const observation = buildObservationFromState(
      state,
      [],
      makeRealm(),
      new Set(["c3de3c0d-15e4-46bc-9a6c-b6d53590a6e4"]),
    )

    expect(observation.new_item_ids).toEqual([acquiredItemId])
  })
})

describe("Group 13 — placement polish", () => {
  it("buildRoomState places random enemies on unique tiles deterministically", () => {
    const genRoom = makeGeneratedRoom("f1_r1_bh-wolf-den", 9, 7, {
      enemy_ids: [
        "f1_r1_bh-wolf-den_enemy_00",
        "f1_r1_bh-wolf-den_enemy_01",
      ],
      item_ids: ["f1_r1_bh-wolf-den_loot_00"],
    })

    const first = buildRoomState(genRoom, [], "blighted-hollow", 1234)
    const second = buildRoomState(genRoom, [], "blighted-hollow", 1234)

    expect(first.enemies).toHaveLength(2)
    expect(first.enemies.map((enemy) => enemy.position)).toEqual(
      second.enemies.map((enemy) => enemy.position),
    )
    expect(
      new Set(first.enemies.map((enemy) => `${enemy.position.x},${enemy.position.y}`)).size,
    ).toBe(2)
    expect(
      first.items.every(
        (item) =>
          !first.enemies.some(
            (enemy) =>
              enemy.position.x === item.position.x
              && enemy.position.y === item.position.y,
          ),
      ),
    ).toBe(true)
  })
})

describe("Group 13 — interactables, inventory, visits, and lore", () => {
  const tutorialRoomId = "f1_r1_tutorial-burrow"

  function makeTutorialRealm(): GeneratedRealm {
    return {
      template_id: "tutorial-cellar",
      template_version: 1,
      seed: 9,
      total_floors: 1,
      floors: [
        {
          floor_number: 1,
          entrance_room_id: tutorialRoomId,
          exit_room_id: null,
          boss_room_id: null,
          rooms: [
            makeGeneratedRoom(tutorialRoomId, 7, 7, {
              enemy_ids: ["f1_r1_tutorial-burrow_enemy_00"],
              description_first_visit: "The cellar opens into a dug-out burrow.",
              description_revisit: "The burrow is still.",
            }),
          ],
        },
      ],
    }
  }

  function makeTutorialState(overrides?: Partial<GameState>): GameState {
    const room = buildRoomState(
      makeTutorialRealm().floors[0]!.rooms[0]!,
      [],
      "tutorial-cellar",
      9,
    )
    return makeState({
      position: {
        floor: 1,
        room_id: tutorialRoomId,
        tile: { x: 1, y: 1 },
      },
      activeFloor: { rooms: [room] },
      discoveredTiles: { 1: [{ x: 1, y: 1 }] },
      roomsVisited: {},
      ...overrides,
    })
  }

  it("does not offer interact actions for a non-current room", () => {
    const state = makeTutorialState({
      position: {
        floor: 1,
        room_id: "f1_r9_somewhere-else",
        tile: { x: 1, y: 1 },
      },
    })

    const actions = computeLegalActions(
      state,
      state.activeFloor.rooms[0],
      makeTutorialRealm(),
    )

    expect(actions.some((action) => action.type === "interact")).toBe(false)
  })

  it("renders room-wide interactables at the room center", () => {
    const state = makeTutorialState()
    const realm = makeTutorialRealm()
    const observation = buildObservationFromState(state, [], realm)
    const interactable = observation.visible_entities.find(
      (entity) => entity.type === "interactable" && entity.id === "tutorial-wall-scratches",
    )

    expect(interactable?.position).toEqual({ x: 3, y: 3 })
    expect(observation.realm_info.entrance_room_id).toBe(realm.floors[0]?.entrance_room_id ?? "")
  })

  it("blocks pickups when inventory is full and the item cannot stack", () => {
    const fullInventory = Array.from({ length: getInventoryCapacity() }, (_, index) => ({
      id: `item-${index}`,
      template_id: `unique-item-${index}`,
      name: `Item ${index}`,
      quantity: 1,
      modifiers: {},
      owner_type: "character" as const,
      owner_id: "player-1",
    }))
    const baseState = makeState()
    const state = makeState({
      inventory: fullInventory,
      activeFloor: {
        rooms: [
          {
            ...baseState.activeFloor.rooms[0]!,
            items: [makeFloorItem({ id: "loot-full", template_id: "antidote", position: { x: 2, y: 1 } })],
          },
        ],
      },
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())
    expect(actions.some((action) => action.type === "pickup" && action.item_id === "loot-full")).toBe(false)

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: "loot-full" },
      makeRealm(),
      new SeededRng(1),
    )

    expect(result.summary).toContain("Inventory full")
    expect(result.newState.activeFloor.rooms[0]?.items).toHaveLength(1)
    expect(result.observation.inventory_slots_used).toBe(getInventoryCapacity())
    expect(result.observation.inventory_capacity).toBe(getInventoryCapacity())
  })

  it("still allows pickups to merge into an existing stack when inventory is full", () => {
    const fullInventory = Array.from({ length: getInventoryCapacity() }, (_, index) => ({
      id: `item-${index}`,
      template_id: index === 0 ? "health-potion" : `unique-item-${index}`,
      name: index === 0 ? "Health Potion" : `Item ${index}`,
      quantity: 1,
      modifiers: {},
      owner_type: "character" as const,
      owner_id: "player-1",
    }))
    const baseState = makeState()
    const state = makeState({
      inventory: fullInventory,
      activeFloor: {
        rooms: [
          {
            ...baseState.activeFloor.rooms[0]!,
            items: [makeFloorItem({ id: "loot-stack", template_id: "health-potion", position: { x: 2, y: 1 } })],
          },
        ],
      },
    })

    const actions = computeLegalActions(state, state.activeFloor.rooms[0], makeRealm())
    expect(actions.some((action) => action.type === "pickup" && action.item_id === "loot-stack")).toBe(true)

    const result = resolveTurn(
      state,
      { type: "pickup", item_id: "loot-stack" },
      makeRealm(),
      new SeededRng(1),
    )

    expect(result.newState.inventory[0]?.quantity).toBe(2)
    expect(result.newState.activeFloor.rooms[0]?.items).toHaveLength(0)
  })

  it("tracks rooms visited and switches to revisit text after the first observation", () => {
    const state = makeTutorialState()

    const firstTurn = resolveTurn(
      state,
      { type: "wait" },
      makeTutorialRealm(),
      new SeededRng(1),
    )
    const secondTurn = resolveTurn(
      firstTurn.newState,
      { type: "wait" },
      makeTutorialRealm(),
      new SeededRng(2),
    )

    expect(firstTurn.observation.room_text).toContain("dug-out burrow")
    expect(firstTurn.newState.roomsVisited?.[1]).toContain(tutorialRoomId)
    expect(secondTurn.observation.room_text).toContain("The burrow is still")
    expect(secondTurn.observation.known_map.floors[1]?.rooms_visited).toContain(tutorialRoomId)
  })

  it("records lore discoveries when interacting with lore objects", () => {
    const currentRoom = makeTutorialState().activeFloor.rooms[0]!
    const state = makeTutorialState({
      activeFloor: {
        rooms: [{ ...currentRoom, enemies: [] }],
      },
    })

    const result = resolveTurn(
      state,
      { type: "interact", target_id: "tutorial-wall-scratches" },
      makeTutorialRealm(),
      new SeededRng(4),
    )

    expect(result.newState.loreDiscovered).toContainEqual({
      lore_entry_id: "cellar-warning-01",
      discovered_at_turn: 1,
    })
    expect(
      result.worldMutations.some(
        (mutation) =>
          mutation.entity_id === "tutorial-wall-scratches"
          && mutation.metadata.lore_entry_id === "cellar-warning-01",
      ),
    ).toBe(true)
    expect(result.summary).toContain("Cellar Warning 01")
  })
})
