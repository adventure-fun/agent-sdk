import { describe, expect, it } from "bun:test"
import {
  AntiLoopExplorationModule,
  __peekAntiLoopRoomStateForTests,
  __resetAntiLoopForTests,
} from "../src/modules/anti-loop-exploration.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  enemy,
  moveAction,
} from "../../../tests/helpers/mock-observation.js"
import type { AgentContext } from "../../../src/modules/index.js"
import type { Direction, Tile } from "../../../src/protocol.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function floorRow(y: number, xs: number[], type: Tile["type"] = "floor"): Tile[] {
  return xs.map((x) => ({ x, y, type, entities: [] }))
}

function pushMove(
  context: AgentContext,
  turn: number,
  direction: Direction,
  reasoning = "test",
): void {
  context.previousActions.push({
    turn,
    action: { type: "move", direction },
    reasoning,
  })
}

function pushCrossing(
  context: AgentContext,
  fromRoomId: string,
  toRoomId: string,
  direction: Direction,
): void {
  const log = context.mapMemory.loopDoorCrossings
    ?? (context.mapMemory.loopDoorCrossings = [])
  log.push({ fromRoomId, toRoomId, direction })
}

describe("AntiLoopExplorationModule", () => {
  it("has the correct name and priority", () => {
    const module = new AntiLoopExplorationModule()
    expect(module.name).toBe("anti-loop-exploration")
    expect(module.priority).toBe(42)
  })

  it("idles when enemies are visible (defer to combat)", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    const obs = buildObservation({
      visible_entities: [enemy("g1", { position: { x: 4, y: 3 } })],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain("Enemies visible")
  })

  it("idles when realm is cleared (defer to extraction/portal)", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    const obs = buildObservation({
      realm_info: {
        template_id: "test",
        template_name: "test",
        floor_count: 1,
        current_floor: 1,
        entrance_room_id: "room-1",
        entrance_tile: { x: 0, y: 0 },
        status: "realm_cleared",
      },
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain("Realm cleared")
  })

  it("idles when HP is critical (defer to healing)", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    const obs = buildObservation({
      character: { hp: { current: 2, max: 30 } },
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain("HP critical")
  })

  it("prefers right (east-bias) when all directions are legal with no history", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    __resetAntiLoopForTests(ctx)
    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 5, y: 5 } },
      visible_tiles: floorRow(5, [4, 5, 6, 7]),
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
        moveAction("right"),
      ],
    })
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "move", direction: "right" })
    expect(result.confidence).toBe(0.78)
    expect(result.reasoning).toContain("Anti-loop exploration")
  })

  it("bans the reversal direction after one A→B→A round-trip", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    __resetAntiLoopForTests(ctx)

    pushCrossing(ctx, "room-A", "room-B", "right")
    pushCrossing(ctx, "room-B", "room-A", "left")
    pushMove(ctx, 5, "left")

    const obs = buildObservation({
      turn: 6,
      position: { floor: 1, room_id: "room-A", tile: { x: 3, y: 5 } },
      visible_tiles: floorRow(5, [2, 3, 4, 5]),
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("right"),
      ],
    })

    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction?.type).toBe("move")
    expect((result.suggestedAction as { direction?: Direction })?.direction).not.toBe("right")
    expect(result.reasoning).toContain("reversal banned")

    const state = __peekAntiLoopRoomStateForTests(ctx, "room-A")
    expect(state?.bannedReversal?.direction).toBe("right")
    expect(state?.bannedReversal?.expiresAtTurn).toBeGreaterThan(6)
  })

  it("increments door-burn when the agent successfully crosses a room", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    __resetAntiLoopForTests(ctx)

    pushCrossing(ctx, "room-A", "room-B", "right")
    pushMove(ctx, 10, "right")

    const obs = buildObservation({
      turn: 11,
      position: { floor: 1, room_id: "room-B", tile: { x: 2, y: 5 } },
      visible_tiles: floorRow(5, [1, 2, 3, 4]),
      legal_actions: [moveAction("left"), moveAction("right"), moveAction("up")],
    })

    module.analyze(obs, ctx)

    const fromState = __peekAntiLoopRoomStateForTests(ctx, "room-A")
    expect(fromState?.doorBurn?.right).toBe(1)
  })

  it("applies a stall penalty so known-walled directions are skipped", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    __resetAntiLoopForTests(ctx)

    ctx.mapMemory.stalledMoves.set("room-1:right", 3)

    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 5, y: 5 } },
      visible_tiles: floorRow(5, [4, 5, 6, 7]),
      legal_actions: [moveAction("right"), moveAction("down"), moveAction("up")],
    })

    const result = module.analyze(obs, ctx)
    expect((result.suggestedAction as { direction?: Direction })?.direction).not.toBe(
      "right",
    )
  })

  it("avoids the immediate reverse direction when another option exists", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    __resetAntiLoopForTests(ctx)

    pushMove(ctx, 3, "right")

    const obs = buildObservation({
      turn: 4,
      position: { floor: 1, room_id: "room-1", tile: { x: 5, y: 5 } },
      visible_tiles: floorRow(5, [4, 5, 6, 7]),
      legal_actions: [moveAction("left"), moveAction("up"), moveAction("down")],
    })

    const result = module.analyze(obs, ctx)
    expect((result.suggestedAction as { direction?: Direction })?.direction).not.toBe(
      "left",
    )
  })

  it("takes the least-bad move even when every direction is banned", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    __resetAntiLoopForTests(ctx)

    ctx.mapMemory.loopEdgeBans = { "room-1": "right" }

    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 5, y: 5 } },
      visible_tiles: floorRow(5, [4, 5, 6]),
      legal_actions: [moveAction("right")],
    })

    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "move", direction: "right" })
    expect(result.reasoning).toContain("least-bad")
    expect(result.confidence).toBe(0.5)
  })

  it("prefers unvisited tiles over visited ones at equal preference", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    __resetAntiLoopForTests(ctx)

    ctx.mapMemory.visitedTiles.add("1:6,5")

    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 5, y: 5 } },
      visible_tiles: [
        { x: 6, y: 5, type: "floor", entities: [] },
        { x: 5, y: 6, type: "floor", entities: [] },
      ],
      legal_actions: [moveAction("right"), moveAction("down")],
    })

    const result = module.analyze(obs, ctx)
    expect((result.suggestedAction as { direction?: Direction })?.direction).toBe("down")
  })

  it("respects legacy loopEdgeBans from the built-in exploration module", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    __resetAntiLoopForTests(ctx)

    ctx.mapMemory.loopEdgeBans = { "room-1": "right" }

    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 5, y: 5 } },
      visible_tiles: floorRow(5, [4, 5, 6]),
      legal_actions: [moveAction("right"), moveAction("down"), moveAction("up")],
    })

    const result = module.analyze(obs, ctx)
    expect((result.suggestedAction as { direction?: Direction })?.direction).not.toBe(
      "right",
    )
  })

  it("expires the reversal ban once a new crossing breaks the A→B→A pattern", () => {
    const module = new AntiLoopExplorationModule()
    const ctx = createAgentContext(cfg)
    __resetAntiLoopForTests(ctx)

    pushCrossing(ctx, "room-A", "room-B", "right")
    pushCrossing(ctx, "room-B", "room-A", "left")
    pushMove(ctx, 5, "left")

    module.analyze(
      buildObservation({
        turn: 6,
        position: { floor: 1, room_id: "room-A", tile: { x: 3, y: 5 } },
        visible_tiles: floorRow(5, [2, 3, 4, 5]),
        legal_actions: [moveAction("right"), moveAction("up"), moveAction("down")],
      }),
      ctx,
    )

    const state = __peekAntiLoopRoomStateForTests(ctx, "room-A")
    expect(state?.bannedReversal).toBeTruthy()

    // Agent escapes down to room-C; the last two crossings are now (B→A, left) + (A→C, down)
    // — no longer an A→B→A reversal, and the ban's cooldown is allowed to expire on its own.
    pushCrossing(ctx, "room-A", "room-C", "down")
    pushMove(ctx, 7, "down")

    const expireTurn = (state?.bannedReversal?.expiresAtTurn ?? 0) + 1
    const later = module.analyze(
      buildObservation({
        turn: expireTurn,
        position: { floor: 1, room_id: "room-A", tile: { x: 3, y: 5 } },
        visible_tiles: floorRow(5, [2, 3, 4, 5]),
        legal_actions: [moveAction("right"), moveAction("up"), moveAction("down")],
      }),
      ctx,
    )
    expect(later.reasoning).not.toContain("reversal banned")
  })
})
