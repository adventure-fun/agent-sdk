import { describe, expect, it } from "bun:test"
import { StuckEscapeModule } from "../src/modules/stuck-escape.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  enemy,
  moveAction,
  portalAction,
  retreatAction,
} from "../../../tests/helpers/mock-observation.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

describe("StuckEscapeModule", () => {
  it("has the correct name and priority", () => {
    const module = new StuckEscapeModule()
    expect(module.name).toBe("stuck-escape")
    expect(module.priority).toBe(98)
  })

  it("stays quiet when not stuck", () => {
    const module = new StuckEscapeModule()
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.turnsWithoutNewRoom = 5
    ctx.mapMemory.turnsWithoutPositionChange = 0
    const obs = buildObservation({
      legal_actions: [moveAction("right"), portalAction(), retreatAction()],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
  })

  it("fires use_portal when stuck 35+ turns in active play and portal is legal", () => {
    const module = new StuckEscapeModule()
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.turnsWithoutNewRoom = 40
    ctx.mapMemory.turnsWithoutPositionChange = 2
    const obs = buildObservation({
      legal_actions: [moveAction("right"), portalAction()],
    })
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    expect(result.reasoning).toContain("40 turns")
  })

  it("falls back to retreat when portal is not legal but retreat is", () => {
    const module = new StuckEscapeModule()
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.turnsWithoutNewRoom = 50
    ctx.mapMemory.turnsWithoutPositionChange = 1
    const obs = buildObservation({
      legal_actions: [moveAction("left"), retreatAction()],
    })
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "retreat" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("fires on position-stuck threshold even when turnsWithoutNewRoom is lower", () => {
    const module = new StuckEscapeModule()
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.turnsWithoutNewRoom = 10
    ctx.mapMemory.turnsWithoutPositionChange = 12
    const obs = buildObservation({
      legal_actions: [portalAction()],
    })
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
    expect(result.reasoning).toContain("12 turns without tile movement")
  })

  it("idles when stuck but neither portal nor retreat is legal", () => {
    const module = new StuckEscapeModule()
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.turnsWithoutNewRoom = 40
    const obs = buildObservation({
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain("neither use_portal nor retreat is legal")
  })

  it("defers to combat when enemies are visible even if stuck", () => {
    const module = new StuckEscapeModule()
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.turnsWithoutNewRoom = 40
    const obs = buildObservation({
      visible_entities: [enemy("e1")],
      legal_actions: [portalAction()],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
  })

  it("stays quiet post-clear so ExtractionRouter handles retreat", () => {
    const module = new StuckEscapeModule()
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.turnsWithoutNewRoom = 40
    const obs = buildObservation({
      realm_info: { status: "realm_cleared" },
      legal_actions: [portalAction()],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
  })

  it("respects custom thresholds via options", () => {
    const module = new StuckEscapeModule({ activeStuckThreshold: 10 })
    const ctx = createAgentContext(cfg)
    ctx.mapMemory.turnsWithoutNewRoom = 12
    const obs = buildObservation({
      legal_actions: [portalAction()],
    })
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
  })
})
