import { describe, expect, it } from "bun:test"
import { AbilityCombatModule } from "../src/modules/ability-combat.js"
import { createDefaultClassProfileRegistry } from "../src/classes/index.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  attackAction,
  buildObservation,
  enemy,
} from "../../../tests/helpers/mock-observation.js"
import type { AbilitySummary } from "../../../src/protocol.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function ctx() {
  return createAgentContext(cfg)
}

function ability(
  id: string,
  overrides: Partial<AbilitySummary> = {},
): AbilitySummary {
  return {
    id,
    name: overrides.name ?? id,
    description: overrides.description ?? "",
    resource_cost: overrides.resource_cost ?? 10,
    cooldown_turns: overrides.cooldown_turns ?? 3,
    current_cooldown: overrides.current_cooldown ?? 0,
    range: overrides.range ?? "melee",
    target: overrides.target ?? "single",
  }
}

describe("AbilityCombatModule (rogue profile)", () => {
  const module = new AbilityCombatModule(createDefaultClassProfileRegistry())

  it("has the correct name and priority", () => {
    expect(module.name).toBe("ability-combat")
    expect(module.priority).toBe(91)
  })

  it("uses an AoE ability when 3+ enemies are visible and Fan of Knives is ready", () => {
    const obs = buildObservation({
      character: {
        class: "rogue",
        abilities: [
          ability("rogue-fan-of-knives", { target: "aoe", resource_cost: 15 }),
          ability("rogue-backstab"),
        ],
        resource: { type: "energy", current: 100, max: 100 },
      },
      visible_entities: [
        enemy("g1", { hp_current: 10 }),
        enemy("g2", { hp_current: 10 }),
        enemy("g3", { hp_current: 10 }),
      ],
      legal_actions: [attackAction("g1"), attackAction("g2"), attackAction("g3")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeDefined()
    const action = result.suggestedAction!
    expect(action.type).toBe("attack")
    if (action.type === "attack") {
      expect(action.ability_id).toBe("rogue-fan-of-knives")
    }
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("uses a burst ability on a boss target", () => {
    const obs = buildObservation({
      character: {
        class: "rogue",
        effective_stats: { hp: 30, attack: 10, defense: 5, accuracy: 13, evasion: 14, speed: 16 },
        abilities: [ability("rogue-shadow-strike", { resource_cost: 20 })],
        resource: { type: "energy", current: 100, max: 100 },
      },
      visible_entities: [
        enemy("boss", { name: "Sentinel", is_boss: true, hp_current: 80, hp_max: 80 }),
      ],
      legal_actions: [attackAction("boss")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeDefined()
    const action = result.suggestedAction!
    if (action.type === "attack") {
      expect(action.target_id).toBe("boss")
      expect(action.ability_id).toBe("rogue-shadow-strike")
    }
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("falls through to basic attack when all abilities are on cooldown", () => {
    const obs = buildObservation({
      character: {
        class: "rogue",
        abilities: [
          ability("rogue-backstab", { current_cooldown: 2 }),
          ability("rogue-fan-of-knives", { current_cooldown: 3, target: "aoe" }),
        ],
      },
      visible_entities: [enemy("g1", { hp_current: 10 })],
      legal_actions: [attackAction("g1")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.confidence).toBe(0)
    expect(result.suggestedAction).toBeUndefined()
  })

  it("falls through when the character has no abilities at all", () => {
    const obs = buildObservation({
      character: { class: "rogue", abilities: [] },
      visible_entities: [enemy("g1", { hp_current: 10 })],
      legal_actions: [attackAction("g1")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.confidence).toBe(0)
  })

  it("ignores abilities the character cannot afford", () => {
    const obs = buildObservation({
      character: {
        class: "rogue",
        abilities: [ability("rogue-fan-of-knives", { resource_cost: 80, target: "aoe" })],
        resource: { type: "energy", current: 20, max: 100 },
      },
      visible_entities: [
        enemy("g1"),
        enemy("g2"),
        enemy("g3"),
      ],
      legal_actions: [attackAction("g1"), attackAction("g2"), attackAction("g3")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.confidence).toBe(0)
  })

  it("does nothing when there are no enemies", () => {
    const obs = buildObservation({
      character: {
        class: "rogue",
        abilities: [ability("rogue-backstab")],
      },
      visible_entities: [],
      legal_actions: [],
    })
    const result = module.analyze(obs, ctx())
    expect(result.confidence).toBe(0)
  })
})
