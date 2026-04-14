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

// ── effective_stats: perks + skill-tree passives must survive recalc ──────────
//
// These tests pin the recalcStats behavior. Before the fix at turn.ts:2784,
// recalcStats rebuilt effective_stats from `{...stats}` plus equipment and
// buffs only — silently wiping perks and skill-tree passive-stat unlocks.
// Combat reads s.character.effective_stats, so the bug meant any character
// with stat perks (or skill-tree passives) lost those bonuses on the very
// first action of a realm and fought the rest of the dungeon at reduced
// stats. The Bruce regression in particular: base accuracy 11 + 2 from
// perk-keen-eye + 3 from gear-tomb-ring should always be 16, not 14.

describe("recalcStats preserves perks and skill-tree passives", () => {
  function makePerkState(overrides?: Partial<GameState>): GameState {
    const baseState = makeState()
    return makeState({
      character: {
        ...baseState.character,
        stats: {
          hp: 39,
          attack: 12,
          defense: 8,
          accuracy: 11,
          evasion: 10,
          speed: 10,
        },
        // Hydrate-equivalent: perks already layered in, hp.max already
        // includes the +6 from 2 stacks of perk-toughness.
        effective_stats: {
          hp: 45,
          attack: 12,
          defense: 8,
          accuracy: 13,
          evasion: 10,
          speed: 10,
        },
        hp: { current: 45, max: 45 },
        perks: { "perk-keen-eye": 2, "perk-toughness": 2 },
      },
      ...overrides,
    })
  }

  it("perk stat bonuses survive a wait turn (Bruce regression)", () => {
    const state = makePerkState()
    const result = resolveTurn(state, { type: "wait" }, makeRealm(), new SeededRng(1))

    // 11 (base) + 2 (perk-keen-eye x2) — no equipment in this case
    expect(result.newState.character.effective_stats.accuracy).toBe(13)
    // hp.max should not drift from effective_stats.hp
    expect(result.newState.character.effective_stats.hp).toBe(result.newState.character.hp.max)
    expect(result.newState.character.hp.max).toBe(45)
  })

  it("perk + equipment stack correctly across a wait turn (full Bruce case)", () => {
    // gear-tomb-ring: accessory, +3 accuracy, +2 evasion
    const state = makePerkState({
      equipment: {
        weapon: null,
        armor: null,
        helm: null,
        hands: null,
        accessory: {
          id: "inv-tomb-ring",
          template_id: "gear-tomb-ring",
          name: "Tomb Ring",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
          slot: "accessory",
        },
      },
    })
    // The hydrate snapshot needs the equipment bonus pre-applied so
    // resolveTurn's first recalcStats produces the same values.
    state.character.effective_stats = {
      ...state.character.effective_stats,
      accuracy: 16,
      evasion: 12,
    }

    const result = resolveTurn(state, { type: "wait" }, makeRealm(), new SeededRng(1))

    // 11 base + 2 perks + 3 equipment = 16 (Bruce's expected total)
    expect(result.newState.character.effective_stats.accuracy).toBe(16)
    // 10 base + 2 equip evasion = 12
    expect(result.newState.character.effective_stats.evasion).toBe(12)
    // hp.max stays at 45 (perks already baked); effective_stats.hp pinned to it
    expect(result.newState.character.effective_stats.hp).toBe(45)
    expect(result.newState.character.hp.max).toBe(45)
  })

  it("perks survive multiple consecutive turns (catches the every-tick wipe)", () => {
    let state = makePerkState()
    for (let i = 0; i < 5; i++) {
      const result = resolveTurn(state, { type: "wait" }, makeRealm(), new SeededRng(i + 1))
      state = result.newState
      expect(state.character.effective_stats.accuracy).toBe(13)
    }
  })

  it("perks survive an equip action (catches the resolveEquip wipe)", () => {
    const state = makePerkState({
      inventory: [
        {
          id: "inv-tomb-ring",
          template_id: "gear-tomb-ring",
          name: "Tomb Ring",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
          slot: null,
        },
      ],
    })

    const result = resolveTurn(
      state,
      { type: "equip", item_id: "inv-tomb-ring" },
      makeRealm(),
      new SeededRng(1),
    )

    // After equip, accuracy = 11 base + 2 perks + 3 equip = 16
    expect(result.newState.character.effective_stats.accuracy).toBe(16)
    expect(result.newState.equipment.accessory?.template_id).toBe("gear-tomb-ring")
  })

  it("perks survive an unequip action", () => {
    const state = makePerkState({
      equipment: {
        weapon: null,
        armor: null,
        helm: null,
        hands: null,
        accessory: {
          id: "inv-tomb-ring",
          template_id: "gear-tomb-ring",
          name: "Tomb Ring",
          quantity: 1,
          modifiers: {},
          owner_type: "character",
          owner_id: "player-1",
          slot: "accessory",
        },
      },
    })

    const result = resolveTurn(
      state,
      { type: "unequip", slot: "accessory" },
      makeRealm(),
      new SeededRng(1),
    )

    // After unequip, accuracy = 11 base + 2 perks = 13 (no more +3 from ring)
    expect(result.newState.character.effective_stats.accuracy).toBe(13)
  })

  it("perks survive a level-up (catches the level-up effective_stats reset)", () => {
    const state = makePerkState({
      character: {
        ...makePerkState().character,
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

    // Force a hit so the level-up trigger runs deterministically
    state.character.stats = { ...state.character.stats, accuracy: 999 }
    state.character.effective_stats = {
      ...state.character.effective_stats,
      accuracy: 999 + 2, // base + perk
    }

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "knight-slash" },
      makeRealm(),
      new SeededRng(1),
    )

    expect(result.newState.character.level).toBe(2)
    // After level-up, base.accuracy grew by some amount. The perk bonus must
    // still be present in effective_stats.
    const newBaseAccuracy = result.newState.character.stats.accuracy
    expect(result.newState.character.effective_stats.accuracy).toBe(newBaseAccuracy + 2)
    // HP perk also survives — effective_stats.hp pinned to hp.max
    expect(result.newState.character.effective_stats.hp).toBe(result.newState.character.hp.max)
  })

  it("skill-tree passive-stat unlocks survive recalc", () => {
    // Discover the first passive-stat node in the knight tree at runtime —
    // hardcoding a node id would couple this test to content shape. Skip
    // gracefully if the knight tree has no passive-stat unlocks today
    // (a content-level guarantee, not an engine one).
    const knight = CLASSES.knight!
    const tree = knight.skill_tree
    let nodeId: string | null = null
    let stat: keyof GameState["character"]["stats"] | null = null
    let value = 0
    if (tree?.tiers) {
      outer: for (const tier of tree.tiers) {
        for (const choice of tier.choices) {
          const eff = choice.effect as { type?: string; stat?: string; value?: number }
          if (eff.type === "passive-stat" && eff.stat && typeof eff.value === "number") {
            nodeId = choice.id
            stat = eff.stat as keyof GameState["character"]["stats"]
            value = eff.value
            break outer
          }
        }
      }
    }
    if (!nodeId || !stat) return // content has no passive-stat nodes — nothing to test

    const baseState = makeState()
    const state = makeState({
      character: {
        ...baseState.character,
        skill_tree: { [nodeId]: true },
        perks: {},
        effective_stats: {
          ...baseState.character.effective_stats,
          [stat]: baseState.character.stats[stat] + value,
        },
      },
    })

    const result = resolveTurn(state, { type: "wait" }, makeRealm(), new SeededRng(1))
    const baseAfter = result.newState.character.stats[stat]
    expect(result.newState.character.effective_stats[stat]).toBe(baseAfter + value)
  })
})

// ── Skill tree mechanics: Arcane Sight, Vanish, Death Mark, Riposte,
//                         Shadow Step, Disengage, Multishot ──────────────────

describe("mage Arcane Sight reveal-room-enemies", () => {
  function makeMageState(overrides?: Partial<GameState>): GameState {
    return makeState({
      character: {
        ...makeState().character,
        class: "mage",
        resource: { type: "mana", current: 20, max: 20 },
        abilities: ["mage-arcane-bolt", "mage-arcane-sight"],
      },
      ...overrides,
    })
  }

  it("activating Arcane Sight pushes an arcane-sight buff with 3 turns remaining", () => {
    const state = makeMageState()
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "self", ability_id: "mage-arcane-sight" },
      makeRealm(),
      new SeededRng(1),
    )
    const buff = result.newState.character.buffs.find((b) => b.type === "arcane-sight")
    expect(buff).toBeDefined()
    expect(buff?.turns_remaining).toBe(3)
  })

  it("Arcane Sight reveals enemies whose tile is outside the visible set", () => {
    // Place player and enemy far apart so the enemy is in fog without the buff.
    const state = makeMageState({
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(20, 20),
            enemies: [makeEnemy({ position: { x: 18, y: 18 } })],
            items: [],
          },
        ],
      },
      position: { floor: 1, room_id: "f1_r1_test-room", tile: { x: 1, y: 1 } },
    })

    // Without the buff, the enemy is not in visible_entities
    const noBuff = resolveTurn(state, { type: "wait" }, makeRealm("f1_r1_test-room"), new SeededRng(1))
    expect(
      noBuff.observation.visible_entities.some((e) => e.id === "enemy-1"),
    ).toBe(false)

    // Activate Arcane Sight
    const withBuff = resolveTurn(
      noBuff.newState,
      { type: "attack", target_id: "self", ability_id: "mage-arcane-sight" },
      makeRealm("f1_r1_test-room"),
      new SeededRng(2),
    )
    expect(
      withBuff.observation.visible_entities.some((e) => e.id === "enemy-1"),
    ).toBe(true)
  })
})

describe("rogue Vanish stealth", () => {
  function makeRogueState(overrides?: Partial<GameState>): GameState {
    return makeState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 10, max: 10 },
        abilities: ["rogue-backstab", "rogue-vanish"],
        // Make the player squishy so any enemy hit would be obvious
        hp: { current: 50, max: 50 },
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ position: { x: 2, y: 1 }, hp: 50, hp_max: 50 })],
            items: [],
          },
        ],
      },
      ...overrides,
    })
  }

  it("activating Vanish pushes a stealth buff with 1 turn remaining", () => {
    const state = makeRogueState()
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "self", ability_id: "rogue-vanish" },
      makeRealm(),
      new SeededRng(1),
    )
    const buff = result.newState.character.buffs.find((b) => b.type === "stealth")
    expect(buff).toBeDefined()
    expect(buff?.turns_remaining).toBe(1)
  })

  it("while stealthed, adjacent enemies do not damage the player", () => {
    const state = makeRogueState()
    const startHp = state.character.hp.current
    // Activate Vanish — enemy turn happens immediately after, and it should NOT deal damage
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "self", ability_id: "rogue-vanish" },
      makeRealm(),
      new SeededRng(1),
    )
    expect(result.newState.character.hp.current).toBe(startHp)
    // The enemy "loses sight" event should fire
    expect(result.observation.recent_events.some((e) => e.detail.includes("loses sight") || (e.data as Record<string, unknown>)?.["reason"] === "stealth")).toBe(true)
  })

  it("stealth expires after one full turn cycle", () => {
    const state = makeRogueState()
    const after1 = resolveTurn(state, { type: "attack", target_id: "self", ability_id: "rogue-vanish" }, makeRealm(), new SeededRng(1))
    // Wait — stealth should tick down at the start of next player turn
    const after2 = resolveTurn(after1.newState, { type: "wait" }, makeRealm(), new SeededRng(2))
    // After this wait, stealth should be gone (or about to expire)
    const stealthAfter = after2.newState.character.buffs.find((b) => b.type === "stealth")
    expect(stealthAfter).toBeUndefined()
  })
})

describe("rogue Death Mark mark-target", () => {
  function makeRogueWithMarkState(targetHp = 100): GameState {
    return makeState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 20, max: 20 },
        abilities: ["rogue-backstab", "rogue-death-mark"],
        stats: { hp: 40, attack: 15, defense: 5, accuracy: 999, evasion: 10, speed: 10 },
        effective_stats: { hp: 40, attack: 15, defense: 5, accuracy: 999, evasion: 10, speed: 10 },
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(6, 4),
            enemies: [makeEnemy({ position: { x: 2, y: 1 }, hp: targetHp, hp_max: targetHp })],
            items: [],
          },
        ],
      },
    })
  }

  it("casting Death Mark applies a death-mark debuff to the target", () => {
    const state = makeRogueWithMarkState()
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-death-mark" },
      makeRealm(),
      new SeededRng(1),
    )
    const enemy = result.newState.activeFloor.rooms[0]?.enemies[0]
    const mark = enemy?.effects.find((e) => e.type === "death-mark")
    expect(mark).toBeDefined()
    // The mark is applied with 5 but ticks down by 1 during the enemy turn
    // (status effect tick at turn.ts:1341), so by end of the cast turn it's 4.
    expect(mark?.turns_remaining).toBeGreaterThanOrEqual(4)
  })

  it("the cast itself does NOT consume the mark it applies", () => {
    const state = makeRogueWithMarkState()
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-death-mark" },
      makeRealm(),
      new SeededRng(1),
    )
    // Mark must still be on the target after the cast
    const enemy = result.newState.activeFloor.rooms[0]?.enemies[0]
    expect(enemy?.effects.some((e) => e.type === "death-mark")).toBe(true)
  })

  it("the next attack on a marked target deals 2x damage and consumes the mark", () => {
    // Hit a target with backstab, note damage. Then mark + backstab again.
    const baselineState = makeRogueWithMarkState(500)
    const baseHit = resolveTurn(
      baselineState,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-backstab" },
      makeRealm(),
      new SeededRng(42),
    )
    const baseDamage = (baselineState.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0)
      - (baseHit.newState.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0)

    // Now cast Death Mark, then backstab on the same target
    const markedState = makeRogueWithMarkState(500)
    const afterMark = resolveTurn(
      markedState,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-death-mark" },
      makeRealm(),
      new SeededRng(42),
    )
    const hpAfterMark = afterMark.newState.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0
    const afterBackstab = resolveTurn(
      afterMark.newState,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-backstab" },
      makeRealm(),
      new SeededRng(42),
    )
    const backstabDamage = hpAfterMark - (afterBackstab.newState.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0)

    // Marked backstab should deal at least double the base damage (2x +
    // ignore-defense bonus). With 5 defense, base damage is reduced by 5;
    // marked damage doubles the post-defense damage AND skips the reduction
    // entirely. So marked should be strictly more than 2 * baseDamage.
    expect(backstabDamage).toBeGreaterThanOrEqual(baseDamage * 2)

    // Mark should be consumed
    const enemy = afterBackstab.newState.activeFloor.rooms[0]?.enemies[0]
    expect(enemy?.effects.some((e) => e.type === "death-mark")).toBe(false)
  })

  it("mark applied to one target doesn't affect attacks on a different target", () => {
    const state = makeState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 20, max: 20 },
        abilities: ["rogue-backstab", "rogue-death-mark"],
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 4),
            enemies: [
              makeEnemy({ id: "enemy-1", position: { x: 2, y: 1 }, hp: 100, hp_max: 100 }),
              makeEnemy({ id: "enemy-2", position: { x: 5, y: 1 }, hp: 100, hp_max: 100 }),
            ],
            items: [],
          },
        ],
      },
    })

    const afterMark = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-death-mark" },
      makeRealm(),
      new SeededRng(1),
    )
    // Enemy 2 should NOT have a death-mark
    const enemy2 = afterMark.newState.activeFloor.rooms[0]?.enemies.find((e) => e.id === "enemy-2")
    expect(enemy2?.effects.some((e) => e.type === "death-mark")).toBe(false)
  })
})

describe("knight Riposte counter-on-hit", () => {
  function makeKnightWithRiposteState(): GameState {
    return makeState({
      character: {
        ...makeState().character,
        // Lower accuracy so attacks miss isn't 100% — but high enough that
        // the seeded rng still lands hits
        stats: { hp: 50, attack: 25, defense: 10, accuracy: 999, evasion: 5, speed: 5 },
        effective_stats: { hp: 50, attack: 25, defense: 10, accuracy: 999, evasion: 5, speed: 5 },
        hp: { current: 50, max: 50 },
        abilities: ["knight-slash", "knight-riposte"],
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(6, 4),
            enemies: [
              makeEnemy({ id: "enemy-1", position: { x: 2, y: 1 }, hp: 80, hp_max: 80 }),
            ],
            items: [],
          },
        ],
      },
    })
  }

  it("activating Riposte pushes a riposte-stance buff with 1 turn remaining", () => {
    const state = makeKnightWithRiposteState()
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "self", ability_id: "knight-riposte" },
      makeRealm(),
      new SeededRng(1),
    )
    const buff = result.newState.character.buffs.find((b) => b.type === "riposte-stance")
    expect(buff).toBeDefined()
    expect(buff?.turns_remaining).toBe(1)
  })

  it("if the player has Riposte stance and an enemy hits them, the player counter-attacks", () => {
    const state = makeKnightWithRiposteState()
    const enemyStartHp = state.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "self", ability_id: "knight-riposte" },
      makeRealm(),
      new SeededRng(1),
    )
    const enemyEndHp = result.newState.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0
    // Enemy should have taken damage from the counter (assuming the enemy hit)
    expect(enemyEndHp).toBeLessThan(enemyStartHp)
    // A counter-attack event should have been logged
    expect(
      result.observation.recent_events.some(
        (e) => (e.data as Record<string, unknown>)?.["source"] === "riposte",
      ),
    ).toBe(true)
  })

  it("Riposte stance expires after one turn cycle", () => {
    const state = makeKnightWithRiposteState()
    const after1 = resolveTurn(
      state,
      { type: "attack", target_id: "self", ability_id: "knight-riposte" },
      makeRealm(),
      new SeededRng(1),
    )
    const after2 = resolveTurn(after1.newState, { type: "wait" }, makeRealm(), new SeededRng(2))
    expect(after2.newState.character.buffs.find((b) => b.type === "riposte-stance")).toBeUndefined()
  })
})

describe("rogue Shadow Step teleport-attack", () => {
  function makeShadowStepState(playerPos = { x: 1, y: 1 }, enemyPos = { x: 4, y: 1 }): GameState {
    return makeState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 10, max: 10 },
        abilities: ["rogue-backstab", "rogue-shadow-step"],
      },
      position: { floor: 1, room_id: "f1_r1_test-room", tile: playerPos },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(8, 5),
            enemies: [makeEnemy({ id: "enemy-1", position: enemyPos, hp: 100, hp_max: 100 })],
            items: [],
          },
        ],
      },
    })
  }

  it("teleports the player to a tile adjacent to the target", () => {
    const state = makeShadowStepState({ x: 1, y: 2 }, { x: 5, y: 2 })
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-shadow-step" },
      makeRealm(),
      new SeededRng(1),
    )
    const dx = Math.abs((result.newState.position.tile.x ?? 0) - 5)
    const dy = Math.abs((result.newState.position.tile.y ?? 0) - 2)
    expect(dx + dy).toBe(1)
  })

  it("damages the target after teleporting", () => {
    const state = makeShadowStepState({ x: 1, y: 2 }, { x: 5, y: 2 })
    const enemyStartHp = state.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-shadow-step" },
      makeRealm(),
      new SeededRng(1),
    )
    const enemyEndHp = result.newState.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0
    expect(enemyEndHp).toBeLessThan(enemyStartHp)
  })

  it("fails (no resource consumed) if no walkable tile is adjacent to the target", () => {
    // Surround the target with walls on all 4 cardinal sides so Shadow Step
    // has no valid landing tile. makeTiles defaults to all-floor, so we
    // explicitly transition the 4 adjacent tiles to walls.
    const tiles = makeTilesWithTransitions(7, 7, [
      { x: 2, y: 3, type: "wall" },
      { x: 4, y: 3, type: "wall" },
      { x: 3, y: 2, type: "wall" },
      { x: 3, y: 4, type: "wall" },
    ])
    const state = makeState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 10, max: 10 },
        abilities: ["rogue-backstab", "rogue-shadow-step"],
      },
      position: { floor: 1, room_id: "f1_r1_test-room", tile: { x: 1, y: 1 } },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles,
            enemies: [
              makeEnemy({ id: "enemy-1", position: { x: 3, y: 3 }, hp: 100, hp_max: 100 }),
            ],
            items: [],
          },
        ],
      },
    })

    const startResource = state.character.resource.current
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-shadow-step" },
      makeRealm(),
      new SeededRng(1),
    )
    // Resource should NOT have been consumed
    expect(result.newState.character.resource.current).toBe(startResource)
    // Player position should not have changed
    expect(result.newState.position.tile).toEqual({ x: 1, y: 1 })
  })

  it("works when target is in line-of-sight blocked by walls (teleport bypass LOS)", () => {
    // Build a room with a wall between player and target
    const tiles = makeTilesWithTransitions(8, 5, [
      // Wall column at x=3 except for top/bottom edge so LOS is blocked
      { x: 3, y: 1, type: "wall" },
      { x: 3, y: 2, type: "wall" },
      { x: 3, y: 3, type: "wall" },
    ])
    const state = makeState({
      character: {
        ...makeState().character,
        class: "rogue",
        resource: { type: "energy", current: 10, max: 10 },
        abilities: ["rogue-backstab", "rogue-shadow-step"],
      },
      position: { floor: 1, room_id: "f1_r1_test-room", tile: { x: 1, y: 2 } },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles,
            enemies: [makeEnemy({ id: "enemy-1", position: { x: 5, y: 2 }, hp: 100, hp_max: 100 })],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "rogue-shadow-step" },
      makeRealm(),
      new SeededRng(1),
    )
    // Player should have moved adjacent to (5, 2)
    const dx = Math.abs((result.newState.position.tile.x ?? 0) - 5)
    const dy = Math.abs((result.newState.position.tile.y ?? 0) - 2)
    expect(dx + dy).toBe(1)
  })
})

describe("archer Disengage leap-back", () => {
  function makeDisengageState(): GameState {
    return makeState({
      character: {
        ...makeState().character,
        class: "archer",
        resource: { type: "focus", current: 10, max: 10 },
        abilities: ["archer-aimed-shot", "archer-disengage"],
      },
      // Place player in the middle of an open room, enemy adjacent
      position: { floor: 1, room_id: "f1_r1_test-room", tile: { x: 4, y: 3 } },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(10, 7),
            enemies: [
              makeEnemy({ id: "enemy-1", position: { x: 5, y: 3 }, hp: 100, hp_max: 100 }),
            ],
            items: [],
          },
        ],
      },
    })
  }

  it("after Disengage, player is 2 tiles away from the target", () => {
    const state = makeDisengageState()
    const targetPos = state.activeFloor.rooms[0]?.enemies[0]?.position ?? { x: 0, y: 0 }
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "archer-disengage" },
      makeRealm(),
      new SeededRng(1),
    )
    const dx = Math.abs((result.newState.position.tile.x ?? 0) - targetPos.x)
    const dy = Math.abs((result.newState.position.tile.y ?? 0) - targetPos.y)
    expect(dx + dy).toBeGreaterThanOrEqual(2)
  })

  it("Disengage still damages the target before leaping", () => {
    const state = makeDisengageState()
    const startHp = state.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "archer-disengage" },
      makeRealm(),
      new SeededRng(1),
    )
    const endHp = result.newState.activeFloor.rooms[0]?.enemies[0]?.hp ?? 0
    expect(endHp).toBeLessThan(startHp)
  })
})

describe("archer Volley & Rain of Arrows multishot", () => {
  function makeVolleyState(abilityId: "archer-volley" | "archer-rain-of-arrows" = "archer-volley"): GameState {
    return makeState({
      character: {
        ...makeState().character,
        class: "archer",
        resource: { type: "focus", current: 30, max: 30 },
        abilities: ["archer-aimed-shot", abilityId],
        // Stock arrows for the shot — archer abilities consume ammo
      },
      inventory: [
        {
          id: "ammo-stack",
          template_id: "ammo-arrows-10",
          name: "Arrows",
          quantity: 50,
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
            tiles: makeTiles(10, 7),
            enemies: [
              makeEnemy({ id: "enemy-1", position: { x: 4, y: 3 }, hp: 500, hp_max: 500 }),
              makeEnemy({ id: "enemy-2", position: { x: 5, y: 3 }, hp: 500, hp_max: 500 }),
            ],
            items: [],
          },
        ],
      },
      position: { floor: 1, room_id: "f1_r1_test-room", tile: { x: 1, y: 3 } },
    })
  }

  it("Volley fires exactly 2 shots per AoE target", () => {
    const state = makeVolleyState("archer-volley")
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "archer-volley" },
      makeRealm(),
      new SeededRng(1),
    )
    // Count attack_hit + attack_miss events tagged to enemy-1 with the volley ability
    const enemy1Events = result.observation.recent_events.filter(
      (e) =>
        (e.type === "attack_hit" || e.type === "attack_miss")
        && (e.data as Record<string, unknown>)?.["target"] === "enemy-1"
        && (e.data as Record<string, unknown>)?.["ability_id"] === "archer-volley",
    )
    expect(enemy1Events.length).toBe(2)
  })

  it("Rain of Arrows fires exactly 3 shots per AoE target", () => {
    const state = makeVolleyState("archer-rain-of-arrows")
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "archer-rain-of-arrows" },
      makeRealm(),
      new SeededRng(1),
    )
    const enemy1Events = result.observation.recent_events.filter(
      (e) =>
        (e.type === "attack_hit" || e.type === "attack_miss")
        && (e.data as Record<string, unknown>)?.["target"] === "enemy-1"
        && (e.data as Record<string, unknown>)?.["ability_id"] === "archer-rain-of-arrows",
    )
    expect(enemy1Events.length).toBe(3)
  })

  it("a killing blow stops further shots on the dead target", () => {
    const state = makeVolleyState("archer-rain-of-arrows")
    // Drop the target HP very low so the first shot kills it
    if (state.activeFloor.rooms[0]?.enemies[0]) {
      state.activeFloor.rooms[0].enemies[0].hp = 1
    }
    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "archer-rain-of-arrows" },
      makeRealm(),
      new SeededRng(1),
    )
    const enemy1Hits = result.observation.recent_events.filter(
      (e) =>
        e.type === "attack_hit"
        && (e.data as Record<string, unknown>)?.["target"] === "enemy-1"
        && (e.data as Record<string, unknown>)?.["ability_id"] === "archer-rain-of-arrows",
    )
    // At most 1 hit should land on the killed target (the other 2 are skipped)
    expect(enemy1Hits.length).toBeLessThanOrEqual(1)
  })

  it("non-multishot AoE abilities still fire once per target (regression)", () => {
    // Use a mage Frost Nova (aoe, no multishot) as a regression check
    const state = makeState({
      character: {
        ...makeState().character,
        class: "mage",
        resource: { type: "mana", current: 30, max: 30 },
        abilities: ["mage-arcane-bolt", "mage-frost-nova"],
      },
      activeFloor: {
        rooms: [
          {
            id: "f1_r1_test-room",
            tiles: makeTiles(10, 7),
            enemies: [
              makeEnemy({ id: "enemy-1", position: { x: 2, y: 1 }, hp: 500, hp_max: 500 }),
              makeEnemy({ id: "enemy-2", position: { x: 1, y: 2 }, hp: 500, hp_max: 500 }),
            ],
            items: [],
          },
        ],
      },
    })

    const result = resolveTurn(
      state,
      { type: "attack", target_id: "enemy-1", ability_id: "mage-frost-nova" },
      makeRealm(),
      new SeededRng(1),
    )
    const enemy1Events = result.observation.recent_events.filter(
      (e) =>
        (e.type === "attack_hit" || e.type === "attack_miss")
        && (e.data as Record<string, unknown>)?.["target"] === "enemy-1"
        && (e.data as Record<string, unknown>)?.["ability_id"] === "mage-frost-nova",
    )
    expect(enemy1Events.length).toBe(1)
  })
})
