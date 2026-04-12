import { describe, expect, it } from "bun:test"
import { ExplorationModule } from "../../../src/modules/exploration.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import { buildObservation, moveAction, portalAction } from "../../helpers/mock-observation.js"

const config = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function ctx() {
  return createAgentContext(config)
}

describe("ExplorationModule", () => {
  const module = new ExplorationModule()

  it("has correct name and priority", () => {
    expect(module.name).toBe("exploration")
    expect(module.priority).toBe(40)
  })

  it("recommends moving toward an unexplored direction", () => {
    const obs = buildObservation({
      visible_tiles: [
        { x: 3, y: 2, type: "floor" },
        { x: 3, y: 4, type: "floor" },
        { x: 2, y: 3, type: "floor" },
      ],
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
      ],
    })

    const context = ctx()
    const result = module.analyze(obs, context)
    expect(result.suggestedAction?.type).toBe("move")
    expect(result.confidence).toBe(0.72)
  })

  it("updates visited rooms in map memory", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      legal_actions: [moveAction("up")],
    })

    const context = ctx()
    module.analyze(obs, context)
    expect(context.mapMemory.visitedRooms.has("room-1")).toBe(true)
  })

  it("avoids immediately backtracking after entering a new room when another path is available", () => {
    const context = ctx()

    module.analyze(buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 2, y: 3 } },
      visible_tiles: [
        { x: 2, y: 3, type: "floor" },
        { x: 3, y: 3, type: "door" },
      ],
      legal_actions: [moveAction("right")],
    }), context)

    context.previousActions.push({
      turn: 1,
      action: moveAction("right"),
      reasoning: "Entered the next room.",
    })

    const obs = buildObservation({
      position: { floor: 1, room_id: "room-2", tile: { x: 4, y: 3 } },
      visible_tiles: [
        { x: 4, y: 3, type: "floor" },
        { x: 3, y: 3, type: "door" },
        { x: 5, y: 3, type: "door" },
        { x: 4, y: 4, type: "floor" },
      ],
      legal_actions: [moveAction("left"), moveAction("right"), moveAction("down")],
    })

    const result = module.analyze(obs, context)
    expect(result.suggestedAction).not.toEqual({ type: "move", direction: "left" })
  })

  it("falls back to the first legal move when no tile context is available", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      legal_actions: [moveAction("up"), moveAction("down")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "move", direction: "up" })
  })

  it("recommends portal when realm status indicates completion", () => {
    const obs = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 2,
        current_floor: 2,
        status: "boss_cleared",
      },
      legal_actions: [portalAction(), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.6)
  })

  it("returns medium confidence recommendation when only explored visible tiles remain", () => {
    const context = ctx()
    context.mapMemory.visitedTiles.add("1:3,2")
    context.mapMemory.visitedTiles.add("1:3,4")

    const obs = buildObservation({
      visible_tiles: [
        { x: 3, y: 3, type: "floor" },
        { x: 3, y: 2, type: "floor" },
        { x: 3, y: 1, type: "wall" },
        { x: 2, y: 2, type: "wall" },
        { x: 4, y: 2, type: "wall" },
        { x: 3, y: 4, type: "floor" },
        { x: 3, y: 5, type: "wall" },
        { x: 2, y: 4, type: "wall" },
        { x: 4, y: 4, type: "wall" },
      ],
      legal_actions: [moveAction("up"), moveAction("down")],
    })

    const result = module.analyze(obs, context)
    expect(result.suggestedAction?.type).toBe("move")
    expect(result.confidence).toBe(0.45)
  })

  it("returns no recommendation when no movement is legal", () => {
    const obs = buildObservation({
      legal_actions: [{ type: "wait" }],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })
})
