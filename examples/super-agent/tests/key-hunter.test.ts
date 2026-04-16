import { describe, expect, it } from "bun:test"
import { KeyHunterModule } from "../src/modules/key-hunter.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  enemy,
  moveAction,
} from "../../../tests/helpers/mock-observation.js"
import type { InventorySlot, Tile } from "../../../src/protocol.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function floorRow(y: number, xs: number[]): Tile[] {
  return xs.map((x) => ({ x, y, type: "floor" as const, entities: [] }))
}

function keyItem(templateId = "crypt-key", name = "Crypt Key"): InventorySlot {
  return {
    item_id: "inv-key-1",
    template_id: templateId,
    name,
    quantity: 1,
    modifiers: {},
  }
}

describe("KeyHunterModule", () => {
  const module = new KeyHunterModule()

  it("has the correct name and priority", () => {
    expect(module.name).toBe("key-hunter")
    expect(module.priority).toBe(65)
  })

  it("stays quiet when inventory has no key-like items", () => {
    const obs = buildObservation({
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when enemies are visible", () => {
    const obs = buildObservation({
      inventory: [keyItem()],
      visible_entities: [enemy("e1")],
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when a remembered blocked door matches the held key", () => {
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.encounteredDoors = new Map([
      [
        "sc-iron-gate",
        {
          targetId: "sc-iron-gate",
          floor: 1,
          roomId: "sc-offering-room",
          x: 7,
          y: 3,
          requiredKeyTemplateId: "crypt-key",
          interactedTurns: [],
          firstSeenTurn: 5,
          isBlocked: true,
        },
      ],
    ])
    const obs = buildObservation({
      inventory: [keyItem()],
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain("KeyDoorModule")
  })

  it("routes toward a frontier tile when holding a key with no matching remembered door", () => {
    const ctx = createAgentContext(cfg)
    // 5-tile corridor. Tile at (5,3) is the east edge; neighbor (6,3) is unknown → frontier.
    const obs = buildObservation({
      position: { floor: 1, room_id: "sc-side-vault", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      inventory: [keyItem()],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toBeDefined()
    const action = result.suggestedAction!
    expect(action.type).toBe("move")
    if (action.type === "move") {
      // Either direction leads toward a frontier (1,3) or (5,3); we just care it's a move.
      expect(["left", "right"]).toContain(action.direction)
    }
    expect(result.confidence).toBeGreaterThanOrEqual(0.85)
    expect(result.reasoning.toLowerCase()).toContain("key")
  })

  it("idles gracefully when no frontier tile is reachable", () => {
    const ctx = createAgentContext(cfg)
    // Only the current tile is known; no neighbors → no frontier to route toward because
    // bfsDistance only considers known-or-target neighbors and we have nothing to target.
    const obs = buildObservation({
      position: { floor: 1, room_id: "closet", tile: { x: 3, y: 3 } },
      visible_tiles: [{ x: 3, y: 3, type: "floor", entities: [] }],
      inventory: [keyItem()],
      legal_actions: [],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when the realm is cleared", () => {
    const obs = buildObservation({
      inventory: [keyItem()],
      realm_info: { status: "realm_cleared" },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("activates on a key detected by template_id suffix even when name doesn't match", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      inventory: [
        {
          item_id: "inv-999",
          template_id: "sigil-of-binding-key",
          name: "Sigil of Binding",
          quantity: 1,
          modifiers: {},
        },
      ],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBeGreaterThanOrEqual(0.85)
  })
})
