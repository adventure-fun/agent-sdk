import { describe, expect, it } from "bun:test"
import { ActionPlanner } from "../src/planner.js"
import {
  ExplorationModule,
  HealingModule,
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

  it("combat_start does not re-fire within 5-turn cooldown as same enemy flickers", async () => {
    const strategic = new MockLLMAdapter({
      actionPicker: () => ({ type: "wait" }),
    })
    const tactical = new MockLLMAdapter({
      actionPicker: () => ({ type: "wait" }),
    })
    const registry = createModuleRegistry([new ExplorationModule()])
    const planner = new ActionPlanner(strategic, tactical, registry, { strategy: "planned" })
    const context = createAgentContext(config)

    // Turn 1: room with enemy visible (initial_observation → strategic plan).
    await planner.decideAction(
      buildObservation({
        turn: 1,
        realm_info: { status: "active", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "r1", tile: { x: 1, y: 4 } },
        visible_entities: [
          { id: "husk", type: "enemy", name: "Husk", hp_current: 5, hp_max: 5, behavior: "aggressive", position: { x: 1, y: 7 } },
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

    // Turn 2: stepped into r2 (no enemy) — combat_end fires once.
    await planner.decideAction(
      buildObservation({
        turn: 2,
        realm_info: { status: "active", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "r2", tile: { x: 1, y: 3 } },
        visible_entities: [],
        legal_actions: [
          { type: "move", direction: "left" },
          { type: "move", direction: "right" },
          { type: "wait" },
        ],
      }),
      context,
    )

    // Turn 3: stepped back into r1, husk visible again. WITHOUT debounce, this would re-fire
    // combat_start (trigger reason) and wipe the plan. WITH debounce, combat_start is suppressed
    // — the planner can still fall through to plan_exhausted if the queue is empty, but the
    // reason won't be combat_start.
    const decision = await planner.decideAction(
      buildObservation({
        turn: 3,
        realm_info: { status: "active", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "r1", tile: { x: 1, y: 4 } },
        visible_entities: [
          { id: "husk", type: "enemy", name: "Husk", hp_current: 5, hp_max: 5, behavior: "aggressive", position: { x: 1, y: 7 } },
        ],
        legal_actions: [
          { type: "move", direction: "left" },
          { type: "move", direction: "right" },
          { type: "wait" },
        ],
      }),
      context,
    )
    expect(decision.triggerReason).not.toBe("combat_start")
  })

  it("exploration override forces east-bias during active play past tactical LLM", async () => {
    const strategic = new MockLLMAdapter({
      actionPicker: () => ({ type: "wait" }),
    })
    const tactical = new MockLLMAdapter({
      actionPicker: () => ({ type: "move", direction: "left" }),
    })
    const registry = createModuleRegistry([new ExplorationModule()])
    const planner = new ActionPlanner(strategic, tactical, registry, { strategy: "planned" })
    const context = createAgentContext(config)

    // Turn 1: initial_observation, strategic plan runs.
    await planner.decideAction(
      buildObservation({
        turn: 1,
        realm_info: { status: "active", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "side", tile: { x: 2, y: 2 } },
        visible_tiles: [{ x: 2, y: 2, type: "floor", entities: [] }],
        legal_actions: [
          { type: "move", direction: "left" },
          { type: "move", direction: "right" },
          { type: "wait" },
        ],
      }),
      context,
    )

    // Turn 2: no trigger. Exploration recommends east-bias. Override should force `right`
    // even though tactical LLM would have picked `left`.
    const second = await planner.decideAction(
      buildObservation({
        turn: 2,
        realm_info: { status: "active", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "side", tile: { x: 2, y: 2 } },
        visible_tiles: [{ x: 2, y: 2, type: "floor", entities: [] }],
        legal_actions: [
          { type: "move", direction: "left" },
          { type: "move", direction: "right" },
          { type: "wait" },
        ],
      }),
      context,
    )
    expect(second.tier).toBe("module")
    expect(second.action).toEqual({ type: "move", direction: "right" })
    expect(context.mapMemory.explorationHomingOverrideStreak).toBeGreaterThanOrEqual(1)
  })

  it("does NOT re-trigger strategic resources_critical on every turn while HP stays critical", async () => {
    const strategic = new MockLLMAdapter({
      actionPicker: () => ({ type: "move", direction: "left" }),
    })
    const tactical = new MockLLMAdapter({
      actionPicker: () => ({ type: "move", direction: "left" }),
    })
    const registry = createModuleRegistry([new HealingModule(), new ExplorationModule()])
    const planner = new ActionPlanner(strategic, tactical, registry, {
      strategy: "planned",
      maxPlanLength: 10,
    })
    const context = createAgentContext(config)

    // Turn 1: HP full — initial_observation strategic call.
    await planner.decideAction(
      buildObservation({
        turn: 1,
        realm_info: { status: "active", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "side", tile: { x: 5, y: 3 } },
        character: { hp: { current: 27, max: 27 } },
        legal_actions: [
          { type: "move", direction: "left" },
          { type: "move", direction: "right" },
          { type: "wait" },
        ],
      }),
      context,
    )
    strategic.clearHistory()

    // Turn 2: HP drops to 4/27 (~15%, below CRITICAL_THRESHOLD=0.25). Inventory empty — no heal
    // item. HealingModule reports criticalHP=true, healingAvailable=false. This is a TRANSITION
    // from non-critical to critical and SHOULD fire one strategic replan.
    await planner.decideAction(
      buildObservation({
        turn: 2,
        realm_info: { status: "active", entrance_room_id: "ent" },
        position: { floor: 1, room_id: "side", tile: { x: 5, y: 3 } },
        character: { hp: { current: 4, max: 27 } },
        legal_actions: [
          { type: "move", direction: "left" },
          { type: "move", direction: "right" },
          { type: "wait" },
        ],
      }),
      context,
    )
    expect(strategic.getHistory().filter((h) => h.kind === "plan").length).toBe(1)
    strategic.clearHistory()

    // Turns 3..6: HP still 4/27. These are PERSISTENT critical — strategic MUST NOT fire again.
    for (let turn = 3; turn <= 6; turn++) {
      await planner.decideAction(
        buildObservation({
          turn,
          realm_info: { status: "active", entrance_room_id: "ent" },
          position: { floor: 1, room_id: "side", tile: { x: 5 - turn, y: 3 } },
          character: { hp: { current: 4, max: 27 } },
          legal_actions: [
            { type: "move", direction: "left" },
            { type: "move", direction: "right" },
            { type: "wait" },
          ],
        }),
        context,
      )
    }
    expect(strategic.getHistory().filter((h) => h.kind === "plan").length).toBe(0)
  })
})
