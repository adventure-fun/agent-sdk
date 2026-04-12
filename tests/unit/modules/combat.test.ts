import { describe, expect, it } from "bun:test"
import { CombatModule } from "../../../src/modules/combat.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  enemy,
  attackAction,
  retreatAction,
} from "../../helpers/mock-observation.js"

const config = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function ctx() {
  return createAgentContext(config)
}

describe("CombatModule", () => {
  const module = new CombatModule()

  it("has correct name and priority", () => {
    expect(module.name).toBe("combat")
    expect(module.priority).toBe(80)
  })

  it("recommends attacking the lowest-HP enemy when enemies are visible", () => {
    const obs = buildObservation({
      visible_entities: [
        enemy("e1", { hp_current: 15 }),
        enemy("e2", { hp_current: 5 }),
      ],
      legal_actions: [
        attackAction("e1"),
        attackAction("e2"),
      ],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "attack", target_id: "e2" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("recommends retreat when HP is critically low and retreat is legal", () => {
    const obs = buildObservation({
      character: { hp: { current: 3, max: 30 } },
      visible_entities: [enemy("e1")],
      legal_actions: [
        attackAction("e1"),
        retreatAction(),
      ],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "retreat" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("uses the configured emergency HP threshold for retreat decisions", () => {
    const customContext = createAgentContext(createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test" },
      wallet: { type: "env" },
      decision: {
        emergencyHpPercent: 0.4,
      },
    }))
    const obs = buildObservation({
      character: { hp: { current: 10, max: 30 } },
      visible_entities: [enemy("e1")],
      legal_actions: [
        attackAction("e1"),
        retreatAction(),
      ],
    })

    const result = module.analyze(obs, customContext)
    expect(result.suggestedAction).toEqual({ type: "retreat" })
  })

  it("returns no recommendation when no enemies are visible", () => {
    const obs = buildObservation({
      visible_entities: [],
      legal_actions: [{ type: "move", direction: "up" }],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("returns no recommendation when enemies are visible but no attack is legal", () => {
    const obs = buildObservation({
      visible_entities: [enemy("e1")],
      legal_actions: [{ type: "move", direction: "up" }],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("has medium confidence for ambiguous situations with multiple enemies", () => {
    const obs = buildObservation({
      character: { hp: { current: 15, max: 30 } },
      visible_entities: [
        enemy("e1", { hp_current: 14 }),
        enemy("e2", { hp_current: 14 }),
        enemy("e3", { hp_current: 14 }),
      ],
      legal_actions: [
        attackAction("e1"),
        attackAction("e2"),
        attackAction("e3"),
        retreatAction(),
      ],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeDefined()
    expect(result.confidence).toBeLessThan(0.8)
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it("targets boss enemies with higher priority when present", () => {
    const obs = buildObservation({
      visible_entities: [
        enemy("e1", { hp_current: 5, is_boss: false }),
        enemy("boss", { hp_current: 50, is_boss: true, behavior: "boss" }),
      ],
      legal_actions: [
        attackAction("e1"),
        attackAction("boss"),
      ],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "attack", target_id: "boss" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })
})
