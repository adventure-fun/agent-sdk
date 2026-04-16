import { describe, expect, it } from "bun:test"
import { ClassAwareTrapModule } from "../src/modules/class-aware-trap.js"
import { createDefaultClassProfileRegistry } from "../src/classes/index.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  disarmAction,
  enemy,
  moveAction,
  trap as trapEntity,
} from "../../../tests/helpers/mock-observation.js"
import type { Tile } from "../../../src/protocol.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function floorRow(y: number, xs: number[]): Tile[] {
  return xs.map((x) => ({ x, y, type: "floor" as const, entities: [] }))
}

describe("ClassAwareTrapModule", () => {
  const module = new ClassAwareTrapModule(createDefaultClassProfileRegistry())

  it("has the correct name and priority", () => {
    expect(module.name).toBe("class-aware-trap")
    expect(module.priority).toBe(76)
  })

  it("disarms an adjacent trap as a rogue", () => {
    const obs = buildObservation({
      character: { class: "rogue" },
      visible_entities: [trapEntity("t1", { position: { x: 3, y: 3 } })],
      legal_actions: [disarmAction("t1")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "disarm_trap", item_id: "t1" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("routes toward a distant trap as a rogue", () => {
    const obs = buildObservation({
      character: { class: "rogue" },
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [trapEntity("t1", { position: { x: 5, y: 3 } })],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "move", direction: "right" })
    expect(result.reasoning).toContain("trap")
  })

  it("stays quiet for non-disarm classes (knight)", () => {
    const obs = buildObservation({
      character: { class: "knight" },
      visible_entities: [trapEntity("t1", { position: { x: 3, y: 3 } })],
      legal_actions: [disarmAction("t1")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("refuses to approach traps when HP is low", () => {
    const obs = buildObservation({
      character: { class: "rogue", hp: { current: 8, max: 30 } },
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [trapEntity("t1", { position: { x: 5, y: 3 } })],
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("defers to combat when enemies are visible", () => {
    const obs = buildObservation({
      character: { class: "rogue" },
      visible_entities: [enemy("e1"), trapEntity("t1", { position: { x: 3, y: 3 } })],
      legal_actions: [disarmAction("t1")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })
})
