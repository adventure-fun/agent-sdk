import { describe, expect, it } from "bun:test"
import { ActionPlanner } from "../src/planner.js"
import {
  ExplorationModule,
  PortalModule,
  createAgentContext,
  createDefaultConfig,
} from "../src/index.js"
import { createModuleRegistry } from "../src/modules/index.js"
import { MockLLMAdapter } from "./helpers/mock-llm.js"
import { buildObservation } from "./helpers/mock-observation.js"

describe("ActionPlanner post-clear homing override", () => {
  const config = createDefaultConfig({
    llm: { provider: "openai", apiKey: "test" },
    wallet: { type: "env" },
    // Disable west-bias so these tests can verify "homing picks east-door under default rules"
    // independently of the left-bias behavior, which has its own dedicated tests.
    decision: { strategy: "planned", extractionPreferLeftBiasExit: false },
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

  it("yields one tactical plan after extractionHomingOverrideMaxStreak consecutive homing overrides", async () => {
    const strategic = new MockLLMAdapter({
      actionPicker: () => ({ type: "wait" }),
    })
    const tactical = new MockLLMAdapter({
      actionPicker: () => ({ type: "move", direction: "left" }),
    })
    const registry = createModuleRegistry([new ExplorationModule()])
    const planner = new ActionPlanner(strategic, tactical, registry, {
      strategy: "planned",
      extractionHomingOverrideMaxStreak: 2,
    })
    const context = createAgentContext(config)

    const clearedObs = () =>
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
      })

    await planner.decideAction(clearedObs(), context)
    tactical.clearHistory()

    await planner.decideAction(clearedObs(), context)
    await planner.decideAction(clearedObs(), context)
    expect(tactical.getHistory().filter((h) => h.kind === "plan")).toHaveLength(0)

    await planner.decideAction(clearedObs(), context)
    expect(tactical.getHistory().filter((h) => h.kind === "plan")).toHaveLength(1)
  })

  it("still yields to tactical LLM at max streak even when a loop edge ban is active", async () => {
    const strategic = new MockLLMAdapter({
      actionPicker: () => ({ type: "wait" }),
    })
    const tactical = new MockLLMAdapter({
      actionPicker: () => ({ type: "move", direction: "up" }),
    })
    const registry = createModuleRegistry([new ExplorationModule()])
    const planner = new ActionPlanner(strategic, tactical, registry, {
      strategy: "planned",
      extractionHomingOverrideMaxStreak: 2,
    })
    const context = createAgentContext(config)
    // Pre-seed a loop ban as if the agent had already detected oscillation. Under the old
    // `999` special case this would cause the planner to skip tactical effectively forever.
    context.mapMemory.loopEdgeBans = { boss: "right" }

    const clearedObs = () =>
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
      })

    await planner.decideAction(clearedObs(), context)
    tactical.clearHistory()
    await planner.decideAction(clearedObs(), context)
    await planner.decideAction(clearedObs(), context)
    // After hitting maxStreak=2 the tactical LLM MUST be consulted at least once even with a
    // loop ban in place.
    await planner.decideAction(clearedObs(), context)
    expect(tactical.getHistory().filter((h) => h.kind === "plan").length).toBeGreaterThanOrEqual(1)
  })

  it("reset() drops stale strategic plan so next realm does not replay old queue", async () => {
    const strategicHistory: Array<{ trigger?: string }> = []
    const strategic = new MockLLMAdapter({
      actionPicker: () => ({ type: "move", direction: "right" }),
    })
    const tactical = new MockLLMAdapter({
      actionPicker: () => ({ type: "wait" }),
    })
    const registry = createModuleRegistry([new ExplorationModule()])
    const planner = new ActionPlanner(strategic, tactical, registry, { strategy: "planned" })
    let context = createAgentContext(config)

    // Turn 1 of realm A — this is an "initial_observation" so strategic plans.
    await planner.decideAction(
      buildObservation({
        turn: 1,
        realm_info: { status: "active", entrance_room_id: "room-a" },
        position: { floor: 1, room_id: "room-a", tile: { x: 1, y: 1 } },
        legal_actions: [
          { type: "move", direction: "right" },
          { type: "move", direction: "down" },
          { type: "wait" },
        ],
      }),
      context,
    )
    strategicHistory.push(...strategic.getHistory().filter((h) => h.kind === "plan"))
    expect(strategicHistory.length).toBeGreaterThanOrEqual(1)

    // Simulate realm boundary: after extraction the outer agent loop calls reset() + rebuilds
    // the context. Pre-reset, a follow-up observation with no floor/status change would NOT
    // trigger a new strategic plan and would replay the queued action.
    strategic.clearHistory()
    planner.reset()
    context = createAgentContext(config)

    // Turn 1 of realm B — same template, looks "active", HP normal. Under the old code this
    // would not re-trigger strategic planning and would consume the stale plan. After reset(),
    // `previousObservation` is null so the planner MUST treat this as initial_observation.
    await planner.decideAction(
      buildObservation({
        turn: 1,
        realm_info: { status: "active", entrance_room_id: "room-a" },
        position: { floor: 1, room_id: "room-a", tile: { x: 1, y: 1 } },
        legal_actions: [
          { type: "move", direction: "right" },
          { type: "move", direction: "down" },
          { type: "wait" },
        ],
      }),
      context,
    )
    const postResetPlans = strategic.getHistory().filter((h) => h.kind === "plan")
    expect(postResetPlans.length).toBeGreaterThanOrEqual(1)
  })

  it("emergency retreat clears the current plan so the next realm cannot replay it", async () => {
    const strategic = new MockLLMAdapter({
      actionPicker: (obs) => {
        const moveLeft = obs.legal_actions.find(
          (a): a is Extract<typeof a, { type: "move" }> =>
            a.type === "move" && a.direction === "left",
        )
        return moveLeft ?? { type: "wait" }
      },
    })
    const tactical = new MockLLMAdapter({
      actionPicker: () => ({ type: "wait" }),
    })
    const registry = createModuleRegistry([new ExplorationModule(), new PortalModule()])
    const planner = new ActionPlanner(strategic, tactical, registry, { strategy: "planned" })
    const context = createAgentContext(config)

    // Prime a strategic plan.
    await planner.decideAction(
      buildObservation({
        turn: 1,
        realm_info: { status: "active", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "ent", tile: { x: 2, y: 2 } },
        character: { hp: { current: 20, max: 20 } },
        legal_actions: [
          { type: "move", direction: "left" },
          { type: "move", direction: "right" },
          { type: "wait" },
        ],
      }),
      context,
    )

    // Low-HP observation with `retreat` legal: PortalModule fires emergency with confidence >=
    // 0.95 and the planner should null its current plan as it returns the retreat.
    const emergency = await planner.decideAction(
      buildObservation({
        turn: 2,
        realm_info: { status: "active", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "ent", tile: { x: 2, y: 2 } },
        character: { hp: { current: 1, max: 20 } },
        legal_actions: [
          { type: "retreat" },
          { type: "move", direction: "left" },
          { type: "wait" },
        ],
      }),
      context,
    )
    expect(emergency.tier).toBe("emergency")
    expect(emergency.action).toEqual({ type: "retreat" })
    expect(emergency.planDepth).toBe(0)
  })
})
