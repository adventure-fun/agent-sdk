import { describe, expect, it } from "bun:test"
import { ActionPlanner } from "../../src/planner.js"
import { createDefaultConfig } from "../../src/config.js"
import { createAgentContext, createModuleRegistry } from "../../src/modules/index.js"
import { InventoryModule, PortalModule } from "../../src/index.js"
import { MockLLMAdapter } from "../helpers/mock-llm.js"
import {
  buildObservation,
  item,
  moveAction,
  pickupAction,
  portalAction,
} from "../helpers/mock-observation.js"

describe("ActionPlanner", () => {
  it("collects remaining loot before extracting from a cleared room", async () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test" },
      wallet: { type: "env" },
      decision: {
        strategy: "planned",
      },
    })
    const planner = new ActionPlanner(
      new MockLLMAdapter(),
      new MockLLMAdapter(),
      createModuleRegistry([
        new PortalModule(),
        new InventoryModule(),
      ]),
      config.decision!,
    )
    const context = createAgentContext(config)
    const observation = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 1,
        current_floor: 1,
        status: "realm_cleared",
      },
      visible_entities: [
        item("loot-1", { position: { x: 4, y: 3 } }),
      ],
      legal_actions: [portalAction(), pickupAction("loot-1"), moveAction("right"), moveAction("left")],
    })

    const decision = await planner.decideAction(observation, context)
    expect(decision.action).toEqual({ type: "pickup", item_id: "loot-1" })
    expect(decision.action).not.toEqual({ type: "use_portal" })
  })
})
import { describe, expect, it } from "bun:test"
import { ActionPlanner, type PlannerDecision } from "../../src/planner.js"
import {
  createAgentContext,
  createModuleRegistry,
  type AgentContext,
  type AgentModule,
  type ModuleRecommendation,
} from "../../src/modules/index.js"
import {
  type Action,
  type ActionPlan,
  type DecisionResult,
  type LLMAdapter,
  type PlanningPrompt,
} from "../../src/adapters/llm/index.js"
import { createDefaultConfig, type AgentConfig } from "../../src/config.js"
import { buildObservation, enemy, moveAction, waitAction } from "../helpers/mock-observation.js"

class StubModule implements AgentModule {
  constructor(
    readonly name: string,
    readonly priority: number,
    private readonly recommendation: (context: {
      observation: ReturnType<typeof buildObservation>
      agentContext: AgentContext
    }) => ModuleRecommendation,
  ) {}

  analyze(
    observation: ReturnType<typeof buildObservation>,
    agentContext: AgentContext,
  ): ModuleRecommendation {
    return this.recommendation({ observation, agentContext })
  }
}

interface MockLLM extends LLMAdapter {
  decideCalls: DecisionResult[]
  planCalls: PlanningPrompt[]
}

function createConfig(
  overrides: Partial<NonNullable<AgentConfig["decision"]>> = {},
): AgentConfig {
  return createDefaultConfig({
    llm: { provider: "openai", apiKey: "test-key", model: "gpt-4o-mini" },
    wallet: { type: "env" },
    decision: overrides,
  })
}

function createMockLLM(options: {
  name?: string
  decideResult?: DecisionResult
  planResult?: ActionPlan
  planResults?: ActionPlan[]
} = {}): MockLLM {
  const decideCalls: DecisionResult[] = []
  const planCalls: PlanningPrompt[] = []
  const queuedPlanResults = [...(options.planResults ?? [])]

  return {
    name: options.name ?? "mock-llm",
    decideCalls,
    planCalls,
    async decide(): Promise<DecisionResult> {
      const result = options.decideResult ?? {
        action: waitAction(),
        reasoning: "per-turn",
      }
      decideCalls.push(result)
      return result
    },
    async plan(prompt: PlanningPrompt): Promise<ActionPlan> {
      planCalls.push(prompt)
      return (
        queuedPlanResults.shift() ??
        options.planResult ?? {
          strategy: "Hold position",
          actions: [{ action: waitAction(), reasoning: "Wait safely." }],
        }
      )
    },
  }
}

function createPlannerHarness(options: {
  decision?: Partial<NonNullable<AgentConfig["decision"]>>
  strategicPlan?: ActionPlan
    strategicPlans?: ActionPlan[]
  tacticalPlan?: ActionPlan
  moduleRecommendation?: ModuleRecommendation
}) {
  const config = createConfig(options.decision)
  const context = createAgentContext(config)
  const strategic = createMockLLM({
    name: "strategic",
    planResults: options.strategicPlans,
    planResult:
      options.strategicPlan ??
      {
        strategy: "Advance carefully",
        actions: [{ action: moveAction("right"), reasoning: "Move toward progress." }],
      },
  })
  const tactical = createMockLLM({
    name: "tactical",
    planResult:
      options.tacticalPlan ??
      {
        strategy: "Recover tactically",
        actions: [{ action: waitAction(), reasoning: "Pause and recover." }],
      },
  })
  const moduleRecommendation =
    options.moduleRecommendation ?? {
      reasoning: "No module opinion.",
      confidence: 0,
    }
  const registry = createModuleRegistry([
    new StubModule(moduleRecommendation.moduleName ?? "test-module", 10, () => moduleRecommendation),
  ])

  return {
    config,
    context,
    strategic,
    tactical,
    planner: new ActionPlanner(strategic, tactical, registry, config.decision!),
  }
}

describe("ActionPlanner", () => {
  it("uses a strategic plan on the first observation", async () => {
    const harness = createPlannerHarness({
      strategicPlan: {
        strategy: "Explore east",
        actions: [
          { action: moveAction("right"), reasoning: "Head east." },
          { action: waitAction(), reasoning: "Pause after moving." },
        ],
      },
    })

    const decision = await harness.planner.decideAction(
      buildObservation({ legal_actions: [moveAction("right"), waitAction()] }),
      harness.context,
    )

    expect(decision.action).toEqual(moveAction("right"))
    expect(decision.tier).toBe("strategic")
    expect(decision.planDepth).toBe(1)
    expect(harness.strategic.planCalls).toHaveLength(1)
    expect(harness.tactical.planCalls).toHaveLength(0)
  })

  it("reuses cached planned actions without another llm call", async () => {
    const harness = createPlannerHarness({
      strategicPlan: {
        strategy: "Explore east",
        actions: [
          { action: moveAction("right"), reasoning: "Head east." },
          { action: waitAction(), reasoning: "Pause after moving." },
        ],
      },
    })

    await harness.planner.decideAction(
      buildObservation({ legal_actions: [moveAction("right"), waitAction()] }),
      harness.context,
    )

    const decision = await harness.planner.decideAction(
      buildObservation({
        turn: 2,
        legal_actions: [waitAction(), moveAction("right")],
        position: { floor: 1, room_id: "room-1", tile: { x: 4, y: 3 } },
      }),
      harness.context,
    )

    expect(decision.action).toEqual(waitAction())
    expect(decision.tier).toBe("strategic")
    expect(decision.planDepth).toBe(0)
    expect(harness.strategic.planCalls).toHaveLength(1)
    expect(harness.tactical.planCalls).toHaveLength(0)
  })

  it("falls back to a confident legal module action when the next planned action is illegal", async () => {
    const harness = createPlannerHarness({
      strategicPlan: {
        strategy: "Keep moving",
        actions: [
          { action: moveAction("right"), reasoning: "Advance." },
          { action: moveAction("left"), reasoning: "Backtrack." },
        ],
      },
      moduleRecommendation: {
        suggestedAction: waitAction(),
        reasoning: "Waiting is safest.",
        confidence: 0.92,
      },
    })

    await harness.planner.decideAction(
      buildObservation({ legal_actions: [moveAction("right"), waitAction()] }),
      harness.context,
    )

    const decision = await harness.planner.decideAction(
      buildObservation({
        turn: 2,
        legal_actions: [waitAction()],
        position: { floor: 1, room_id: "room-1", tile: { x: 4, y: 3 } },
      }),
      harness.context,
    )

    expect(decision.action).toEqual(waitAction())
    expect(decision.tier).toBe("module")
    expect(harness.tactical.planCalls).toHaveLength(0)
  })

  it("requests a tactical re-plan when combat starts", async () => {
    const harness = createPlannerHarness({
      strategicPlan: {
        strategy: "Advance",
        actions: [
          { action: moveAction("right"), reasoning: "Advance." },
          { action: moveAction("right"), reasoning: "Keep advancing." },
        ],
      },
      tacticalPlan: {
        strategy: "Fight the goblin",
        actions: [{ action: waitAction(), reasoning: "Hold for combat." }],
      },
    })

    await harness.planner.decideAction(
      buildObservation({ legal_actions: [moveAction("right"), waitAction()] }),
      harness.context,
    )

    const decision = await harness.planner.decideAction(
      buildObservation({
        turn: 2,
        legal_actions: [waitAction()],
        visible_entities: [enemy("goblin-1")],
      }),
      harness.context,
    )

    expect(decision.tier).toBe("tactical")
    expect(decision.triggerReason).toBe("combat_start")
    expect(harness.tactical.planCalls).toHaveLength(1)
    expect(harness.tactical.planCalls[0]?.strategicContext).toBe("Advance")
  })

  it("requests a strategic re-plan on floor change", async () => {
    const harness = createPlannerHarness({
      strategicPlans: [
        {
          strategy: "Clear floor 1",
          actions: [{ action: moveAction("right"), reasoning: "Advance." }],
        },
        {
          strategy: "Scout floor 2",
          actions: [{ action: waitAction(), reasoning: "Pause and assess floor 2." }],
        },
      ],
    })

    await harness.planner.decideAction(
      buildObservation({ legal_actions: [moveAction("right"), waitAction()] }),
      harness.context,
    )

    const decision = await harness.planner.decideAction(
      buildObservation({
        turn: 2,
        legal_actions: [waitAction()],
        position: { floor: 2, room_id: "room-2", tile: { x: 1, y: 1 } },
        realm_info: { current_floor: 2 },
      }),
      harness.context,
    )

    expect(decision.tier).toBe("strategic")
    expect(decision.triggerReason).toBe("floor_change")
    expect(harness.strategic.planCalls).toHaveLength(2)
  })

  it("uses emergency module overrides for critical healing situations", async () => {
    const harness = createPlannerHarness({
      moduleRecommendation: {
        suggestedAction: { type: "use_item", item_id: "potion-1" },
        reasoning: "Critical heal now.",
        confidence: 0.93,
        moduleName: "healing",
        context: { hpRatio: 0.1, healingAvailable: true },
      },
    })

    const decision = await harness.planner.decideAction(
      buildObservation({
        character: { hp: { current: 3, max: 30 } },
        legal_actions: [{ type: "use_item", item_id: "potion-1" }, waitAction()],
      }),
      harness.context,
    )

    expect(decision.tier).toBe("emergency")
    expect(decision.action).toEqual({ type: "use_item", item_id: "potion-1" })
    expect(harness.strategic.planCalls).toHaveLength(0)
    expect(harness.tactical.planCalls).toHaveLength(0)
  })

  it("uses per-turn llm mode when configured", async () => {
    const harness = createPlannerHarness({
      decision: { strategy: "llm-every-turn" },
    })

    const decision = await harness.planner.decideAction(
      buildObservation({ legal_actions: [waitAction()] }),
      harness.context,
    )

    expect(decision.tier).toBe("per-turn")
    expect(harness.strategic.decideCalls).toHaveLength(1)
    expect(harness.strategic.planCalls).toHaveLength(0)
  })

  it("uses module-only mode without llm calls", async () => {
    const harness = createPlannerHarness({
      decision: { strategy: "module-only" },
      moduleRecommendation: {
        suggestedAction: waitAction(),
        reasoning: "Module-only fallback.",
        confidence: 0.9,
      },
    })

    const decision = await harness.planner.decideAction(
      buildObservation({ legal_actions: [waitAction()] }),
      harness.context,
    )

    expect(decision.tier).toBe("module")
    expect(decision.action).toEqual(waitAction())
    expect(harness.strategic.decideCalls).toHaveLength(0)
    expect(harness.strategic.planCalls).toHaveLength(0)
    expect(harness.tactical.planCalls).toHaveLength(0)
  })
})
