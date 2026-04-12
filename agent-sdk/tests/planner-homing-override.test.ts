import { describe, expect, it } from "bun:test"
import { ActionPlanner } from "../src/planner.js"
import { ExplorationModule, createAgentContext, createDefaultConfig } from "../src/index.js"
import { createModuleRegistry } from "../src/modules/index.js"
import { MockLLMAdapter } from "./helpers/mock-llm.js"
import { buildObservation } from "./helpers/mock-observation.js"

describe("ActionPlanner post-clear homing override", () => {
  const config = createDefaultConfig({
    llm: { provider: "openai", apiKey: "test" },
    wallet: { type: "env" },
  })

  it("skips tactical LLM when exploration tags extraction homing after the first observation", async () => {
    const strategic = new MockLLMAdapter({
      actionPicker: () => ({ type: "wait" }),
    })
    const tactical = new MockLLMAdapter({
      actionPicker: () => ({ type: "move", direction: "left" }),
    })
    const registry = createModuleRegistry([new ExplorationModule()])
    const planner = new ActionPlanner(strategic, tactical, registry, { strategy: "planned" })
    const context = createAgentContext(config)

    await planner.decideAction(
      buildObservation({
        realm_info: { status: "realm_cleared", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "boss", tile: { x: 2, y: 2 } },
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
      }),
      context,
    )

    tactical.clearHistory()
    const second = await planner.decideAction(
      buildObservation({
        realm_info: { status: "realm_cleared", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "boss", tile: { x: 2, y: 2 } },
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
      }),
      context,
    )

    expect(tactical.getHistory().filter((h) => h.kind === "plan")).toHaveLength(0)
    expect(second.tier).toBe("module")
    expect(second.action).toEqual({ type: "move", direction: "right" })
  })
})
