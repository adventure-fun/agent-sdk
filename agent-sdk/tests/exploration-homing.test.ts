import { describe, expect, it } from "bun:test"
import {
  ExplorationModule,
  PortalModule,
  createAgentContext,
  createDefaultConfig,
} from "../src/index.js"
import { buildObservation } from "./helpers/mock-observation.js"

describe("extraction homing after dungeon clear", () => {
  const config = createDefaultConfig({
    llm: { provider: "openai", apiKey: "test" },
    wallet: { type: "env" },
  })

  it("ExplorationModule steps onto visible stairs_up when cleared on a deeper floor", () => {
    const mod = new ExplorationModule()
    const ctx = createAgentContext(config)
    const obs = buildObservation({
      realm_info: {
        status: "boss_cleared",
        current_floor: 2,
        floor_count: 3,
        entrance_room_id: "entry-room",
      },
      position: { floor: 2, room_id: "deep", tile: { x: 2, y: 2 } },
      visible_tiles: [
        { x: 2, y: 2, type: "floor", entities: [] },
        { x: 2, y: 1, type: "stairs_up", entities: [] },
      ],
      legal_actions: [
        { type: "move", direction: "up" },
        { type: "move", direction: "down" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction).toEqual({ type: "move", direction: "up" })
    expect(rec.reasoning.toLowerCase()).toContain("stairs")
    expect(rec.context?.extractionHoming).toBe(true)
  })

  it("ExplorationModule prefers a door on deeper floors when stairs_up is not visible (e.g. boss room)", () => {
    const mod = new ExplorationModule()
    const ctx = createAgentContext(config)
    ctx.mapMemory.lastRoomEntry = { roomId: "boss-room", cameFromDirection: "left" }
    const obs = buildObservation({
      realm_info: {
        status: "boss_cleared",
        current_floor: 2,
        floor_count: 2,
        entrance_room_id: "f1_r0_test-dungeon-entry",
      },
      position: { floor: 2, room_id: "boss-room", tile: { x: 3, y: 3 } },
      visible_tiles: [
        { x: 3, y: 3, type: "floor", entities: [] },
        { x: 2, y: 3, type: "door", entities: [] },
      ],
      legal_actions: [
        { type: "move", direction: "left" },
        { type: "move", direction: "right" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction).toEqual({ type: "move", direction: "left" })
    expect(rec.reasoning.toLowerCase()).toContain("door")
    expect(rec.context?.extractionHoming).toBe(true)
  })

  it("ExplorationModule steps along floor toward a non-adjacent visible door on floor 1 after clear", () => {
    const mod = new ExplorationModule()
    const ctx = createAgentContext(config)
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "ent", current_floor: 1 },
      position: { floor: 1, room_id: "boss-room", tile: { x: 2, y: 2 } },
      visible_tiles: [
        { x: 2, y: 2, type: "floor", entities: [] },
        { x: 3, y: 2, type: "floor", entities: [] },
        { x: 4, y: 2, type: "floor", entities: [] },
        { x: 5, y: 2, type: "door", entities: [] },
      ],
      legal_actions: [
        { type: "move", direction: "left" },
        { type: "move", direction: "right" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction).toEqual({ type: "move", direction: "right" })
    expect(rec.context?.extractionHoming).toBe(true)
  })

  it("ExplorationModule retraces breadcrumb on floor 1 when cleared outside entrance_room_id", () => {
    const mod = new ExplorationModule()
    const ctx = createAgentContext(config)
    ctx.mapMemory.lastRoomEntry = { roomId: "side", cameFromDirection: "left" }
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "ent", current_floor: 1 },
      position: { floor: 1, room_id: "side", tile: { x: 2, y: 2 } },
      visible_tiles: [{ x: 2, y: 2, type: "floor", entities: [] }],
      legal_actions: [
        { type: "move", direction: "left" },
        { type: "move", direction: "right" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction).toEqual({ type: "move", direction: "left" })
    expect(rec.context?.extractionHoming).toBe(true)
  })

  it("PortalModule defers use_portal when cleared, healthy, and not at entrance", () => {
    const mod = new PortalModule()
    const ctx = createAgentContext(config)
    const obs = buildObservation({
      realm_info: { status: "boss_cleared", entrance_room_id: "ent" },
      position: { floor: 2, room_id: "boss", tile: { x: 1, y: 1 } },
      character: { hp: { current: 50, max: 50 } },
      legal_actions: [{ type: "use_portal" }],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.confidence).toBe(0)
    expect(rec.reasoning).toContain("entrance")
  })

  it("PortalModule still uses portal when HP is critical and retreat is not legal", () => {
    const mod = new PortalModule()
    const ctx = createAgentContext(config)
    const obs = buildObservation({
      realm_info: { status: "boss_cleared", entrance_room_id: "ent" },
      position: { floor: 3, room_id: "deep", tile: { x: 1, y: 1 } },
      character: { hp: { current: 1, max: 50 } },
      legal_actions: [{ type: "use_portal" }],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction).toEqual({ type: "use_portal" })
    expect(rec.confidence).toBeGreaterThan(0.9)
  })
})
