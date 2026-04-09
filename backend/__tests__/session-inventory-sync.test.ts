import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { GameState, Tile } from "@adventure-fun/schemas"
import { createMockDb } from "./helpers/mock-db.js"

const mockDb = createMockDb()

mock.module("../src/db/client.js", () => ({ db: mockDb.db }))

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
    turn: 4,
    realm: {
      template_id: "tutorial-cellar",
      template_version: 1,
      seed: 42,
      total_floors: 1,
    },
    character: {
      id: "char-1",
      class: "knight",
      level: 2,
      xp: 100,
      gold: 25,
      hp: { current: 40, max: 40 },
      resource: { type: "stamina", current: 10, max: 10 },
      stats: {
        hp: 40,
        attack: 12,
        defense: 10,
        accuracy: 12,
        evasion: 6,
        speed: 6,
      },
      effective_stats: {
        hp: 40,
        attack: 12,
        defense: 10,
        accuracy: 12,
        evasion: 6,
        speed: 6,
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
          tiles: makeTiles(4, 4),
          enemies: [],
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

function makeSession(state: GameState, characterId = "char-1") {
  return Object.assign(Object.create(GameSession.prototype), {
    characterId,
    gameState: state,
  }) as {
    syncInventory: () => Promise<void>
  }
}

let GameSession: typeof import("../src/game/session.js").GameSession

beforeEach(async () => {
  mockDb.reset()
  ;({ GameSession } = await import("../src/game/session.js"))
})

describe("syncInventory", () => {
  it("aborts and logs when any inventory item id is not a UUID", async () => {
    const session = makeSession(
      makeState({
        inventory: [
          {
            id: "f1_r1_bh-corrupted-heart_loot_00",
            template_id: "health-potion",
            name: "Health Potion",
            quantity: 1,
            modifiers: {},
            owner_type: "character",
            owner_id: "char-1",
          },
        ],
      }),
    )
    const errorSpy = mock(() => {})
    const originalError = console.error
    console.error = errorSpy as typeof console.error

    try {
      await (session as any).syncInventory()
    } finally {
      console.error = originalError
    }

    expect(mockDb.getCalls("inventory_items", "upsert")).toHaveLength(0)
    expect(mockDb.getCalls("inventory_items", "delete")).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledWith(
      "syncInventory aborted: invalid inventory item IDs",
      expect.objectContaining({
        characterId: "char-1",
        invalidItemIds: ["f1_r1_bh-corrupted-heart_loot_00"],
      }),
    )
  })

  it("upserts and prunes inventory rows when all item ids are valid UUIDs", async () => {
    const session = makeSession(
      makeState({
        inventory: [
          {
            id: "7be6bcb6-09bc-4bbb-bf17-01ebf675ffa2",
            template_id: "health-potion",
            name: "Health Potion",
            quantity: 2,
            modifiers: {},
            owner_type: "character",
            owner_id: "char-1",
          },
        ],
        equipment: {
          weapon: {
            id: "0f6a3f8c-e8ce-4c8d-88f6-d75ea3c0db6d",
            template_id: "rusted-sword",
            name: "Rusted Sword",
            quantity: 1,
            modifiers: { attack: 2 },
            owner_type: "character",
            owner_id: "char-1",
            slot: "weapon",
          },
          armor: null,
          accessory: null,
          "class-specific": null,
        },
      }),
    )

    await (session as any).syncInventory()

    const upsertCalls = mockDb.getCalls("inventory_items", "upsert")
    const deleteCalls = mockDb.getCalls("inventory_items", "delete")
    expect(upsertCalls).toHaveLength(1)
    expect(deleteCalls).toHaveLength(1)
    expect(upsertCalls[0]?.payload).toEqual([
      {
        id: "7be6bcb6-09bc-4bbb-bf17-01ebf675ffa2",
        character_id: "char-1",
        owner_type: "character",
        owner_id: "char-1",
        template_id: "health-potion",
        slot: null,
        quantity: 2,
        modifiers: {},
      },
      {
        id: "0f6a3f8c-e8ce-4c8d-88f6-d75ea3c0db6d",
        character_id: "char-1",
        owner_type: "character",
        owner_id: "char-1",
        template_id: "rusted-sword",
        slot: "weapon",
        quantity: 1,
        modifiers: { attack: 2 },
      },
    ])
    expect(deleteCalls[0]?.filters).toContainEqual({
      method: "not",
      args: [
        "id",
        "in",
        "(7be6bcb6-09bc-4bbb-bf17-01ebf675ffa2,0f6a3f8c-e8ce-4c8d-88f6-d75ea3c0db6d)",
      ],
    })
  })

  it("logs delete failures after a successful upsert", async () => {
    mockDb.setResponse("inventory_items", "delete", {
      data: null,
      error: { message: "delete failed" },
    })
    const session = makeSession(
      makeState({
        inventory: [
          {
            id: "7be6bcb6-09bc-4bbb-bf17-01ebf675ffa2",
            template_id: "health-potion",
            name: "Health Potion",
            quantity: 1,
            modifiers: {},
            owner_type: "character",
            owner_id: "char-1",
          },
        ],
      }),
    )
    const errorSpy = mock(() => {})
    const originalError = console.error
    console.error = errorSpy as typeof console.error

    try {
      await (session as any).syncInventory()
    } finally {
      console.error = originalError
    }

    expect(mockDb.getCalls("inventory_items", "upsert")).toHaveLength(1)
    expect(errorSpy).toHaveBeenCalledWith(
      "syncInventory delete failed",
      expect.objectContaining({
        characterId: "char-1",
        keepIds: ["7be6bcb6-09bc-4bbb-bf17-01ebf675ffa2"],
        error: { message: "delete failed" },
      }),
    )
  })
})
