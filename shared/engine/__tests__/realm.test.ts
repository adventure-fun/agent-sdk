import { describe, it, expect } from "bun:test"
import { generateRealm, replayLockedExitUnlocks } from "../src/realm.js"
import { REALMS, ROOMS } from "../src/content.js"
import type { RealmTemplate } from "@adventure-fun/schemas"

const mockTemplate: RealmTemplate = {
  id: "sunken-crypt",
  name: "The Sunken Crypt",
  description: "An ancient burial chamber filled with undead.",
  theme: "undead_crypt",
  version: 1,
  floor_count: { min: 3, max: 5 },
  difficulty_tier: 1,
  room_distribution: {
    combat: 0.4,
    treasure: 0.2,
    trap: 0.1,
    rest: 0.1,
    event: 0.1,
    boss: 0.1,
  },
  enemy_roster: ["skeleton-warrior", "zombie"],
  boss_id: "lich-king",
  loot_tables: [
    { id: "crypt_common", entries: [{ item_template_id: "iron_sword", weight: 1, quantity: { min: 1, max: 1 } }] },
  ],
  trap_types: [
    { id: "spike_trap", name: "Spike Trap", damage: 10, detection_difficulty: 5, visible_after_trigger: true },
  ],
  room_templates: ["basic_combat", "small_treasure"],
  narrative: {
    theme_description: "Cold stone and the smell of rot.",
    room_text_pool: [
      { text: "Damp stone walls glisten.", type: "combat" },
      { text: "The air is thick with dust.", type: "rest" },
    ],
    lore_pool: ["crypt_lore_01"],
    interactable_pool: ["ancient_journal"],
  },
  completion_rewards: { xp: 500, gold: 100 },
}

describe("generateRealm", () => {
  it("is deterministic — same seed produces identical realm", () => {
    const realm1 = generateRealm(mockTemplate, 42)
    const realm2 = generateRealm(mockTemplate, 42)
    expect(realm1.total_floors).toBe(realm2.total_floors)
    expect(realm1.floors.length).toBe(realm2.floors.length)
    for (let f = 0; f < realm1.floors.length; f++) {
      const floor1 = realm1.floors[f]!
      const floor2 = realm2.floors[f]!
      expect(floor1.rooms.length).toBe(floor2.rooms.length)
      for (let r = 0; r < floor1.rooms.length; r++) {
        expect(floor1.rooms[r]!.id).toBe(floor2.rooms[r]!.id)
        expect(floor1.rooms[r]!.width).toBe(floor2.rooms[r]!.width)
        expect(floor1.rooms[r]!.height).toBe(floor2.rooms[r]!.height)
      }
    }
  })

  it("different seeds produce different realms", () => {
    const realm1 = generateRealm(mockTemplate, 1)
    const realm2 = generateRealm(mockTemplate, 99999)
    // At least the first floor rooms should differ
    const rooms1 = realm1.floors[0]!.rooms
    const rooms2 = realm2.floors[0]!.rooms
    const allMatch = rooms1.every((r, i) =>
      r.width === rooms2[i]?.width && r.height === rooms2[i]?.height
    )
    expect(allMatch).toBe(false)
  })

  it("floor count is within template bounds", () => {
    for (let seed = 0; seed < 50; seed++) {
      const realm = generateRealm(mockTemplate, seed)
      expect(realm.total_floors).toBeGreaterThanOrEqual(mockTemplate.floor_count.min)
      expect(realm.total_floors).toBeLessThanOrEqual(mockTemplate.floor_count.max)
    }
  })

  it("final floor has a boss room and no exit", () => {
    const realm = generateRealm(mockTemplate, 42)
    const lastFloor = realm.floors[realm.floors.length - 1]!
    expect(lastFloor.boss_room_id).not.toBeNull()
    expect(lastFloor.exit_room_id).toBeNull()
  })

  it("non-final floors have an exit room and no boss", () => {
    const realm = generateRealm(mockTemplate, 42)
    for (let f = 0; f < realm.floors.length - 1; f++) {
      const floor = realm.floors[f]!
      expect(floor.exit_room_id).not.toBeNull()
      expect(floor.boss_room_id).toBeNull()
    }
  })

  it("all rooms have valid tile grids", () => {
    const realm = generateRealm(mockTemplate, 42)
    for (const floor of realm.floors) {
      for (const room of floor.rooms) {
        expect(room.tiles.length).toBe(room.height)
        for (const row of room.tiles) {
          expect(row.length).toBe(room.width)
        }
      }
    }
  })

  it("entity IDs follow deterministic naming scheme f{floor}_r{room}_{type}", () => {
    const realm = generateRealm(mockTemplate, 42)
    for (const floor of realm.floors) {
      for (const room of floor.rooms) {
        expect(room.id).toMatch(/^f\d+_r\d+_\w+$/)
      }
    }
  })

  it("places descent stairs on non-final floor exit rooms", () => {
    const realm = generateRealm(mockTemplate, 42)

    for (const floor of realm.floors.slice(0, -1)) {
      const exitRoom = floor.rooms.find((room) => room.id === floor.exit_room_id)
      expect(exitRoom).toBeDefined()
      const midY = Math.floor((exitRoom?.tiles.length ?? 0) / 2)
      const rightWall = exitRoom?.tiles[midY]?.[exitRoom.width - 1]
      expect(rightWall?.type).toBe("stairs")
    }
  })

  it("places ascent stairs on entrance rooms for floors above 1", () => {
    const realm = generateRealm(mockTemplate, 42)

    for (const floor of realm.floors.slice(1)) {
      const entranceRoom = floor.rooms.find((room) => room.id === floor.entrance_room_id)
      expect(entranceRoom).toBeDefined()
      const midY = Math.floor((entranceRoom?.tiles.length ?? 0) / 2)
      const leftWall = entranceRoom?.tiles[midY]?.[0]
      expect(leftWall?.type).toBe("stairs_up")
    }
  })

  it("does not place ascent stairs on the first floor entrance room", () => {
    const realm = generateRealm(mockTemplate, 42)
    const firstFloor = realm.floors[0]!
    const entranceRoom = firstFloor.rooms.find((room) => room.id === firstFloor.entrance_room_id)
    const midY = Math.floor((entranceRoom?.tiles.length ?? 0) / 2)
    const leftWall = entranceRoom?.tiles[midY]?.[0]

    expect(leftWall?.type).not.toBe("stairs_up")
  })
})

describe("replayLockedExitUnlocks", () => {
  // Use the real Collapsed Passage realm because it exercises the full
  // handcrafted-realm path: cp-locked-gate has `locked_exit: "cp-iron-gate"`
  // and cp-overseers-den is the room behind it.
  const collapsedPassage = REALMS["collapsed-passage"]!
  const lockedGateTemplate = ROOMS["cp-locked-gate"]!
  const lockedExitId = lockedGateTemplate.locked_exit!

  function findLockedGateRoom(realm: ReturnType<typeof generateRealm>) {
    for (const floor of realm.floors) {
      for (let i = 0; i < floor.rooms.length; i++) {
        const room = floor.rooms[i]!
        if (room.id.endsWith("_cp-locked-gate")) {
          return { room, nextRoom: floor.rooms[i + 1] ?? null }
        }
      }
    }
    return null
  }

  it("test fixtures: collapsed-passage exposes a locked gate followed by another room", () => {
    expect(collapsedPassage).toBeDefined()
    expect(lockedExitId).toBe("cp-iron-gate")
    const realm = generateRealm(collapsedPassage, 1)
    const found = findLockedGateRoom(realm)
    expect(found).not.toBeNull()
    expect(found!.nextRoom).not.toBeNull()
  })

  it("fresh-generated realm leaves the locked gate room unconnected and walled east", () => {
    const realm = generateRealm(collapsedPassage, 1)
    const { room, nextRoom } = findLockedGateRoom(realm)!
    expect(room.connections.includes(nextRoom!.id)).toBe(false)
    const midY = Math.floor(room.tiles.length / 2)
    const eastWall = room.tiles[midY]?.[room.tiles[0]!.length - 1]
    expect(eastWall?.type).toBe("wall")
  })

  it("replays the unlock when the gate id is in mutatedEntities", () => {
    const realm = generateRealm(collapsedPassage, 1)
    replayLockedExitUnlocks(realm, [lockedExitId])
    const { room, nextRoom } = findLockedGateRoom(realm)!
    expect(room.connections.includes(nextRoom!.id)).toBe(true)
    const midY = Math.floor(room.tiles.length / 2)
    const eastWall = room.tiles[midY]?.[room.tiles[0]!.length - 1]
    expect(eastWall?.type).toBe("door")
  })

  it("is idempotent — calling twice does not duplicate the connection", () => {
    const realm = generateRealm(collapsedPassage, 1)
    replayLockedExitUnlocks(realm, [lockedExitId])
    const { room, nextRoom } = findLockedGateRoom(realm)!
    const lengthAfterFirst = room.connections.length
    replayLockedExitUnlocks(realm, [lockedExitId])
    expect(room.connections.length).toBe(lengthAfterFirst)
    expect(room.connections.filter((c) => c === nextRoom!.id).length).toBe(1)
  })

  it("is a no-op when mutatedEntities is empty", () => {
    const realm = generateRealm(collapsedPassage, 1)
    replayLockedExitUnlocks(realm, [])
    const { room, nextRoom } = findLockedGateRoom(realm)!
    expect(room.connections.includes(nextRoom!.id)).toBe(false)
    const midY = Math.floor(room.tiles.length / 2)
    const eastWall = room.tiles[midY]?.[room.tiles[0]!.length - 1]
    expect(eastWall?.type).toBe("wall")
  })

  it("accepts a Set as well as an array", () => {
    const realm = generateRealm(collapsedPassage, 1)
    replayLockedExitUnlocks(realm, new Set([lockedExitId]))
    const { room, nextRoom } = findLockedGateRoom(realm)!
    expect(room.connections.includes(nextRoom!.id)).toBe(true)
  })
})
