import { describe, expect, it } from "bun:test"
import {
  createAgentContext,
  createMapMemory,
  createModuleRegistry,
  type AgentModule,
  type ModuleRecommendation,
} from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import { buildObservation, attackAction } from "../../helpers/mock-observation.js"

function stubModule(
  name: string,
  priority: number,
  recommendation: Partial<ModuleRecommendation> = {},
): AgentModule {
  return {
    name,
    priority,
    analyze: () => ({
      reasoning: recommendation.reasoning ?? `${name} reasoning`,
      confidence: recommendation.confidence ?? 0.5,
      suggestedAction: recommendation.suggestedAction,
      context: recommendation.context,
    }),
  }
}

describe("MapMemory", () => {
  it("initializes with empty collections", () => {
    const memory = createMapMemory()
    expect(memory.visitedRooms.size).toBe(0)
    expect(memory.knownTiles.size).toBe(0)
    expect(memory.discoveredExits.size).toBe(0)
  })
})

describe("AgentContext", () => {
  it("creates with default state", () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test" },
      wallet: { type: "env" },
    })
    const ctx = createAgentContext(config)
    expect(ctx.turn).toBe(0)
    expect(ctx.previousActions).toHaveLength(0)
    expect(ctx.mapMemory.visitedRooms.size).toBe(0)
    expect(ctx.config).toBe(config)
  })
})

describe("ModuleRegistry", () => {
  it("sorts modules by descending priority", () => {
    const low = stubModule("low", 10)
    const high = stubModule("high", 90)
    const mid = stubModule("mid", 50)

    const registry = createModuleRegistry([low, high, mid])
    expect(registry.modules.map((m) => m.name)).toEqual(["high", "mid", "low"])
  })

  it("runs all modules and returns recommendations", () => {
    const combat = stubModule("combat", 80, {
      suggestedAction: attackAction("e1"),
      confidence: 0.9,
    })
    const explore = stubModule("explore", 40, { confidence: 0.4 })
    const registry = createModuleRegistry([explore, combat])

    const obs = buildObservation()
    const ctx = createAgentContext(
      createDefaultConfig({ llm: { provider: "openrouter", apiKey: "k" }, wallet: { type: "env" } }),
    )

    const results = registry.analyzeAll(obs, ctx)
    expect(results).toHaveLength(2)
    expect(results[0]!.confidence).toBe(0.9)
    expect(results[1]!.confidence).toBe(0.4)
  })

  it("returns empty array for empty registry", () => {
    const registry = createModuleRegistry([])
    const obs = buildObservation()
    const ctx = createAgentContext(
      createDefaultConfig({ llm: { provider: "openrouter", apiKey: "k" }, wallet: { type: "env" } }),
    )
    expect(registry.analyzeAll(obs, ctx)).toEqual([])
  })

  it("preserves module name in recommendations", () => {
    const mod = stubModule("healing", 70, { confidence: 0.8 })
    const registry = createModuleRegistry([mod])
    const obs = buildObservation()
    const ctx = createAgentContext(
      createDefaultConfig({ llm: { provider: "openrouter", apiKey: "k" }, wallet: { type: "env" } }),
    )

    const results = registry.analyzeAll(obs, ctx)
    expect(results[0]!.moduleName).toBe("healing")
  })
})
