import { describe, expect, it } from "bun:test"
import { PortalModule } from "../../../src/modules/portal.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  item,
  portalAction,
  pickupAction,
  retreatAction,
  moveAction,
} from "../../helpers/mock-observation.js"

const config = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function ctx() {
  return createAgentContext(config)
}

describe("PortalModule", () => {
  const module = new PortalModule()

  it("has correct name and priority", () => {
    expect(module.name).toBe("portal")
    expect(module.priority).toBe(90)
  })

  it("strongly recommends extraction when HP is critically low and portal is legal", () => {
    const obs = buildObservation({
      character: { hp: { current: 5, max: 30 } },
      legal_actions: [portalAction(), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("uses the configured emergency HP threshold for survival extraction", () => {
    const customContext = createAgentContext(createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test" },
      wallet: { type: "env" },
      decision: {
        emergencyHpPercent: 0.4,
      },
    }))
    const obs = buildObservation({
      character: { hp: { current: 10, max: 30 } },
      legal_actions: [portalAction(), moveAction("up")],
    })

    const result = module.analyze(obs, customContext)
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
  })

  it("recommends extraction when realm is cleared and portal available", () => {
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
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("also recommends extraction for realm_cleared status", () => {
    const obs = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 1,
        current_floor: 1,
        status: "realm_cleared",
      },
      legal_actions: [portalAction()],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("does not recommend extraction when loot is still visible in a cleared room", () => {
    const obs = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 1,
        current_floor: 1,
        status: "realm_cleared",
      },
      visible_entities: [item("loot-1", { position: { x: 4, y: 3 } })],
      legal_actions: [portalAction(), moveAction("right")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("does not recommend extraction when pickup remains legal in a cleared room", () => {
    const obs = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 1,
        current_floor: 1,
        status: "realm_cleared",
      },
      legal_actions: [portalAction(), pickupAction("loot-1")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("recommends retreat when HP is dire and no portal available", () => {
    const obs = buildObservation({
      character: { hp: { current: 3, max: 30 } },
      legal_actions: [retreatAction(), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "retreat" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("returns no recommendation when HP is healthy and realm not cleared", () => {
    const obs = buildObservation({
      character: { hp: { current: 28, max: 30 } },
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 2,
        current_floor: 1,
        status: "active",
      },
      legal_actions: [portalAction(), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("returns no recommendation when no portal or retreat is legal", () => {
    const obs = buildObservation({
      character: { hp: { current: 3, max: 30 } },
      legal_actions: [moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })
})
