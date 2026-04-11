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
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
      ],
    })

    const context = ctx()
    const result = module.analyze(obs, context)
    expect(result.suggestedAction?.type).toBe("move")
    expect(result.confidence).toBeGreaterThanOrEqual(0.4)
    expect(result.confidence).toBeLessThanOrEqual(0.6)
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

  it("prefers directions not recently visited", () => {
    const context = ctx()
    context.mapMemory.visitedRooms.add("room-up")
    context.mapMemory.discoveredExits.set("room-1", ["up", "down"])

    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      legal_actions: [moveAction("up"), moveAction("down")],
    })

    const result = module.analyze(obs, context)
    expect(result.suggestedAction).toEqual({ type: "move", direction: "down" })
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

  it("returns low confidence recommendation when all directions explored", () => {
    const context = ctx()
    context.mapMemory.visitedRooms.add("room-up")
    context.mapMemory.visitedRooms.add("room-down")

    const obs = buildObservation({
      legal_actions: [moveAction("up"), moveAction("down")],
    })

    const result = module.analyze(obs, context)
    expect(result.suggestedAction?.type).toBe("move")
    expect(result.confidence).toBeLessThanOrEqual(0.5)
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
