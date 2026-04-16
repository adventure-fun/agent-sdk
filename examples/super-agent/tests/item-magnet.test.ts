import { describe, expect, it } from "bun:test"
import { ItemMagnetModule } from "../src/modules/item-magnet.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  enemy,
  item,
  moveAction,
  pickupAction,
} from "../../../tests/helpers/mock-observation.js"
import type { Tile } from "../../../src/protocol.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function floorRow(y: number, xs: number[]): Tile[] {
  return xs.map((x) => ({ x, y, type: "floor" as const, entities: [] }))
}

/**
 * Builds a simple 5x1 corridor at y=3 spanning x=1..5. Player starts at (3,3). The corridor
 * is fully visible so BFS can always path across it.
 */
function corridorObservation(
  overrides: Parameters<typeof buildObservation>[0] = {},
): ReturnType<typeof buildObservation> {
  return buildObservation({
    position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
    visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
    ...overrides,
  })
}

describe("ItemMagnetModule", () => {
  const module = new ItemMagnetModule()

  it("has the correct name and priority", () => {
    expect(module.name).toBe("item-magnet")
    expect(module.priority).toBe(78)
  })

  it("picks up an adjacent rare item when pickup is legal", () => {
    const obs = corridorObservation({
      visible_entities: [
        item("i1", { name: "Ruby", rarity: "rare", position: { x: 3, y: 3 } }),
      ],
      legal_actions: [pickupAction("i1")],
    })

    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "pickup", item_id: "i1" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("routes toward a remembered item when pickup is not legal", () => {
    const ctx = createAgentContext(cfg)
    const seenItems = new Map()
    seenItems.set("i2", {
      itemId: "i2",
      floor: 1,
      roomId: "room-1",
      x: 5,
      y: 3,
      name: "Epic Amulet",
      rarity: "epic",
      isLikelyKey: false,
      lastSeenTurn: 1,
    })
    ctx.mapMemory.seenItems = seenItems

    const obs = corridorObservation({
      turn: 5,
      visible_entities: [],
      legal_actions: [moveAction("right"), moveAction("left")],
    })

    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "move", direction: "right" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("prefers key items over non-key items when both remembered", () => {
    const ctx = createAgentContext(cfg)
    const seenItems = new Map()
    seenItems.set("rare1", {
      itemId: "rare1",
      floor: 1,
      roomId: "room-1",
      x: 4,
      y: 3,
      name: "Ruby",
      rarity: "rare",
      isLikelyKey: false,
      lastSeenTurn: 1,
    })
    seenItems.set("key1", {
      itemId: "key1",
      floor: 1,
      roomId: "room-1",
      x: 5,
      y: 3,
      name: "Brass Key",
      rarity: "common",
      isLikelyKey: true,
      lastSeenTurn: 1,
    })
    ctx.mapMemory.seenItems = seenItems

    const obs = corridorObservation({
      turn: 5,
      visible_entities: [],
      legal_actions: [moveAction("right"), moveAction("left")],
    })

    const result = module.analyze(obs, ctx)
    // Both items are to the east, but key item has priority, so route should step toward (5,3).
    expect(result.suggestedAction).toEqual({ type: "move", direction: "right" })
    expect(result.reasoning).toContain("Brass Key")
  })

  it("stays quiet when enemies are visible", () => {
    const obs = corridorObservation({
      visible_entities: [enemy("e1")],
      legal_actions: [],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when HP is critical", () => {
    const obs = corridorObservation({
      character: { hp: { current: 3, max: 30 } },
      visible_entities: [
        item("i1", { name: "Ruby", rarity: "rare", position: { x: 3, y: 3 } }),
      ],
      legal_actions: [pickupAction("i1")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when the realm is cleared", () => {
    const obs = corridorObservation({
      realm_info: { status: "realm_cleared" },
      visible_entities: [item("i1", { position: { x: 3, y: 3 } })],
      legal_actions: [pickupAction("i1")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })
})
