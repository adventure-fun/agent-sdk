import { describe, expect, it } from "bun:test"
import {
  ExtractionRouterModule,
  bfsFirstStepDirection,
  buildRoomGraph,
} from "../src/modules/extraction-router.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  enemy,
  moveAction,
  retreatAction,
} from "../../../tests/helpers/mock-observation.js"
import type { Tile } from "../../../src/protocol.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function floorRow(y: number, xs: number[], type: Tile["type"] = "floor"): Tile[] {
  return xs.map((x) => ({ x, y, type, entities: [] }))
}

describe("buildRoomGraph / bfsFirstStepDirection", () => {
  it("builds bidirectional edges via inverse-direction crossings", () => {
    const graph = buildRoomGraph([
      { fromRoomId: "A", toRoomId: "B", direction: "right" },
      { fromRoomId: "B", toRoomId: "C", direction: "right" },
    ])
    expect(graph.get("A")!.map((e) => e.neighbor)).toEqual(["B"])
    // B has a forward crossing to C and an inverse crossing back to A.
    const bEdges = graph.get("B")!
    expect(bEdges.find((e) => e.neighbor === "A")?.direction).toBe("left")
    expect(bEdges.find((e) => e.neighbor === "C")?.direction).toBe("right")
  })

  it("returns the first step of the shortest backtrack", () => {
    const graph = buildRoomGraph([
      { fromRoomId: "entrance", toRoomId: "hall", direction: "right" },
      { fromRoomId: "hall", toRoomId: "boss", direction: "right" },
    ])
    const result = bfsFirstStepDirection(graph, "boss", "entrance")
    expect(result).toEqual({ direction: "left", nextRoomId: "hall" })
  })

  it("returns null when target is unreachable", () => {
    const graph = buildRoomGraph([
      { fromRoomId: "A", toRoomId: "B", direction: "right" },
    ])
    expect(bfsFirstStepDirection(graph, "A", "Z")).toBeNull()
  })
})

describe("ExtractionRouterModule", () => {
  const module = new ExtractionRouterModule()

  it("has the correct name and priority", () => {
    expect(module.name).toBe("extraction-router")
    expect(module.priority).toBe(97)
  })

  it("emits retreat when at the entrance room on floor 1 with retreat legal", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "entrance", tile: { x: 1, y: 1 } },
      realm_info: {
        status: "realm_cleared",
        entrance_room_id: "entrance",
        current_floor: 1,
      },
      legal_actions: [retreatAction()],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "retreat" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it("uses the room graph to BFS-backtrack to the entrance", () => {
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.loopDoorCrossings = [
      { fromRoomId: "entrance", toRoomId: "hall", direction: "right" },
      { fromRoomId: "hall", toRoomId: "boss", direction: "right" },
    ]
    const obs = buildObservation({
      position: { floor: 1, room_id: "boss", tile: { x: 3, y: 3 } },
      realm_info: {
        status: "boss_cleared",
        entrance_room_id: "entrance",
        current_floor: 1,
      },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      legal_actions: [moveAction("left"), moveAction("right")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "move", direction: "left" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it("stays quiet when the realm is still active", () => {
    const obs = buildObservation({
      realm_info: { status: "active" },
      legal_actions: [moveAction("left")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("defers to combat when enemies are visible even post-clear", () => {
    const obs = buildObservation({
      realm_info: { status: "boss_cleared" },
      visible_entities: [enemy("e1")],
      legal_actions: [moveAction("left")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("falls back to an entrance-tile BFS step when no crossings are recorded", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "dead-end", tile: { x: 3, y: 3 } },
      realm_info: {
        status: "realm_cleared",
        entrance_room_id: "entrance",
        current_floor: 1,
      },
      visible_tiles: [
        ...floorRow(3, [1, 2, 3, 4, 5]),
        { x: 1, y: 3, type: "entrance", entities: [] },
      ],
      legal_actions: [moveAction("left"), moveAction("right")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "move", direction: "left" })
    expect(result.reasoning).toContain("entrance")
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("falls back to a door-tile BFS step when entrance tile is not known", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "dead-end", tile: { x: 3, y: 3 } },
      realm_info: {
        status: "realm_cleared",
        entrance_room_id: "entrance",
        current_floor: 1,
      },
      visible_tiles: [
        ...floorRow(3, [1, 2, 3, 4]),
        { x: 5, y: 3, type: "door", entities: [] },
      ],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "move", direction: "right" })
    expect(result.reasoning).toContain("door")
  })

  it("stays quiet on floor > 1 (default extraction handles stairs)", () => {
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.loopDoorCrossings = [
      { fromRoomId: "f2-a", toRoomId: "f2-b", direction: "right" },
    ]
    const obs = buildObservation({
      position: { floor: 2, room_id: "f2-b", tile: { x: 3, y: 3 } },
      realm_info: {
        status: "realm_cleared",
        entrance_room_id: "entrance",
        current_floor: 2,
        floor_count: 3,
      },
      legal_actions: [moveAction("left")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
  })

  it("approaches the door tile when the needed direction is not legal from this tile", () => {
    // Room shaped like an L: player at (3,3) with corridor going down then right.
    // Needed direction is "right" (to exit toward hall), but right isn't legal from (3,3)
    // because the room has no east wall tile there; only the door tile at (5,5) leads east.
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.loopDoorCrossings = [
      { fromRoomId: "entrance", toRoomId: "hall", direction: "right" },
      { fromRoomId: "hall", toRoomId: "boss", direction: "right" },
    ]
    const obs = buildObservation({
      position: { floor: 1, room_id: "boss", tile: { x: 3, y: 3 } },
      realm_info: {
        status: "realm_cleared",
        entrance_room_id: "entrance",
        current_floor: 1,
      },
      // L-shaped room: (3,3) -> (3,4) -> (3,5) -> (4,5) -> (5,5) door
      visible_tiles: [
        { x: 3, y: 3, type: "floor", entities: [] },
        { x: 3, y: 4, type: "floor", entities: [] },
        { x: 3, y: 5, type: "floor", entities: [] },
        { x: 4, y: 5, type: "floor", entities: [] },
        { x: 5, y: 5, type: "door", entities: [] },
      ],
      // Only down/up are legal from (3,3) — we can't go left from this tile.
      legal_actions: [moveAction("down"), moveAction("up")],
    })
    const result = module.analyze(obs, ctx)
    // Primary path says "move left" but left is not legal; module should instead BFS toward
    // the door tile and emit "down" as the first step.
    expect(result.suggestedAction).toEqual({ type: "move", direction: "down" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.85)
  })
})
