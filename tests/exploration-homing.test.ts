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

  it("ExplorationModule still homes out when a floor item is visible but not yet pickup-legal", () => {
    const mod = new ExplorationModule()
    const ctx = createAgentContext(config)
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "ent", current_floor: 1 },
      position: { floor: 1, room_id: "boss-room", tile: { x: 2, y: 2 } },
      visible_entities: [{ id: "loot-1", type: "item", name: "Gold", rarity: "common" }],
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

  it("ExplorationModule skips cameFrom breadcrumb when that direction is stalled (blocked move)", () => {
    const mod = new ExplorationModule()
    const ctx = createAgentContext(config)
    ctx.mapMemory.lastRoomEntry = { roomId: "gate-room", cameFromDirection: "left" }
    ctx.mapMemory.stalledMoves.set("gate-room:left", 3)
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "ent", current_floor: 1 },
      position: { floor: 1, room_id: "gate-room", tile: { x: 1, y: 1 } },
      visible_tiles: [
        { x: 1, y: 1, type: "floor", entities: [] },
        { x: 1, y: 0, type: "door", entities: [] },
      ],
      legal_actions: [
        { type: "move", direction: "up" },
        { type: "move", direction: "left" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction).toEqual({ type: "move", direction: "up" })
    expect(rec.reasoning.toLowerCase()).toContain("door")
  })

  it("ExplorationModule applies learned loop bans so homing stops using the A↔B bridge door", () => {
    const mod = new ExplorationModule()
    const ctx = createAgentContext(config)
    ctx.mapMemory.loopTrackTemplate = "test-dungeon"
    ctx.mapMemory.loopRecentRooms = ["room-b", "room-a", "room-b"]
    ctx.mapMemory.loopDoorCrossings = [
      { fromRoomId: "room-a", toRoomId: "room-b", direction: "right" },
      { fromRoomId: "room-b", toRoomId: "room-a", direction: "left" },
    ]
    ctx.mapMemory.lastRoomEntry = { roomId: "room-a", cameFromDirection: "right" }
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "entrance", current_floor: 1 },
      position: { floor: 1, room_id: "room-a", tile: { x: 2, y: 2 } },
      visible_tiles: [
        { x: 2, y: 2, type: "floor", entities: [] },
        { x: 2, y: 1, type: "door", entities: [] },
        { x: 3, y: 2, type: "door", entities: [] },
      ],
      legal_actions: [
        { type: "move", direction: "up" },
        { type: "move", direction: "right" },
        { type: "move", direction: "down" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction?.direction).not.toBe("right")
    expect(rec.context?.extractionHoming).toBe(true)
  })

  it("ExplorationModule breaks two-room extraction ping-pong instead of retracing cameFrom", () => {
    const mod = new ExplorationModule()
    const ctx = createAgentContext(config)
    ctx.mapMemory.loopTrackTemplate = "test-dungeon"
    ctx.mapMemory.loopRecentRooms = ["room-b", "room-a", "room-b"]
    ctx.mapMemory.lastRoomEntry = { roomId: "room-a", cameFromDirection: "right" }
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "entrance", current_floor: 1 },
      position: { floor: 1, room_id: "room-a", tile: { x: 2, y: 2 } },
      visible_tiles: [
        { x: 2, y: 2, type: "floor", entities: [] },
        { x: 2, y: 1, type: "door", entities: [] },
      ],
      legal_actions: [
        { type: "move", direction: "up" },
        { type: "move", direction: "right" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction).toEqual({ type: "move", direction: "up" })
    expect(rec.reasoning.toLowerCase()).toContain("ping-pong")
    expect(rec.context?.extractionHoming).toBe(true)
  })

  it("ExplorationModule left-bias does not undo the last move east (avoids door ping-pong)", () => {
    const leftBiasConfig = createDefaultConfig({
      llm: { provider: "openai", apiKey: "test" },
      wallet: { type: "env" },
      decision: { strategy: "planned", extractionPreferLeftBiasExit: true },
    })
    const mod = new ExplorationModule()
    const ctx = createAgentContext(leftBiasConfig)
    ctx.previousActions.push({
      turn: 1,
      action: { type: "move", direction: "right" },
      reasoning: "entered room from the west",
    })
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "entrance", current_floor: 1 },
      position: { floor: 1, room_id: "gate-room", tile: { x: 1, y: 2 } },
      visible_tiles: [{ x: 1, y: 2, type: "floor", entities: [] }],
      legal_actions: [
        { type: "move", direction: "left" },
        { type: "move", direction: "up" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction).not.toEqual({ type: "move", direction: "left" })
    expect(ctx.mapMemory.extractionFloor1ExitPhase).toBe("reassess")
    expect(rec.context?.extractionHoming).not.toBe(true)
  })

  it("ExplorationModule prefers move left on floor-1 clear when extractionPreferLeftBiasExit is enabled", () => {
    const leftBiasConfig = createDefaultConfig({
      llm: { provider: "openai", apiKey: "test" },
      wallet: { type: "env" },
      decision: { strategy: "planned", extractionPreferLeftBiasExit: true },
    })
    const mod = new ExplorationModule()
    const ctx = createAgentContext(leftBiasConfig)
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "entrance", current_floor: 1 },
      position: { floor: 1, room_id: "side", tile: { x: 5, y: 2 } },
      visible_tiles: [{ x: 5, y: 2, type: "floor", entities: [] }],
      legal_actions: [
        { type: "move", direction: "left" },
        { type: "move", direction: "right" },
        { type: "wait" },
      ],
    })
    expect(mod.analyze(obs, ctx).suggestedAction).toEqual({ type: "move", direction: "left" })
  })

  it("ExplorationModule in reassess uses doorway homing when a door is visible (not cameFrom backtrack)", () => {
    const leftBiasConfig = createDefaultConfig({
      llm: { provider: "openai", apiKey: "test" },
      wallet: { type: "env" },
      decision: { strategy: "planned", extractionPreferLeftBiasExit: true },
    })
    const mod = new ExplorationModule()
    const ctx = createAgentContext(leftBiasConfig)
    ctx.mapMemory.extractionFloor1ExitPhase = "reassess"
    ctx.mapMemory.lastRoomEntry = { roomId: "side", cameFromDirection: "left" }
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "entrance", current_floor: 1 },
      position: { floor: 1, room_id: "side", tile: { x: 2, y: 2 } },
      visible_tiles: [
        { x: 2, y: 2, type: "floor", entities: [] },
        { x: 2, y: 1, type: "door", entities: [] },
      ],
      legal_actions: [
        { type: "move", direction: "up" },
        { type: "move", direction: "left" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction).toEqual({ type: "move", direction: "up" })
    expect(rec.context?.extractionHoming).toBe(true)
  })

  it("ExplorationModule in reassess after west dead-end skips auto-portal so tactician can decide", () => {
    const leftBiasConfig = createDefaultConfig({
      llm: { provider: "openai", apiKey: "test" },
      wallet: { type: "env" },
      decision: { strategy: "planned", extractionPreferLeftBiasExit: true },
    })
    const mod = new ExplorationModule()
    const ctx = createAgentContext(leftBiasConfig)
    ctx.mapMemory.extractionFloor1ExitPhase = "reassess"
    const obs = buildObservation({
      realm_info: { status: "realm_cleared", entrance_room_id: "entrance", current_floor: 1 },
      position: { floor: 1, room_id: "side", tile: { x: 2, y: 2 } },
      visible_tiles: [
        { x: 2, y: 2, type: "floor", entities: [] },
        { x: 2, y: 1, type: "floor", entities: [] },
      ],
      legal_actions: [
        { type: "move", direction: "up" },
        { type: "use_portal" },
        { type: "wait" },
      ],
    })
    const rec = mod.analyze(obs, ctx)
    expect(rec.suggestedAction?.type).not.toBe("use_portal")
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
