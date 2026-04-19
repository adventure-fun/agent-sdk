import { describe, expect, it } from "bun:test"
import {
  ARCHETYPE_PROFILES,
  getArchetypeProfile,
  parseBotArchetype,
  resolveAggression,
} from "../src/modules/archetypes.js"
import { createArenaAgentContext } from "../src/modules/base.js"
import { ArenaCombatModule } from "../src/modules/arena-combat.js"
import {
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
} from "./helpers/arena-fixture.js"

describe("archetype profiles", () => {
  it("every archetype exposes the full knob schema", () => {
    for (const key of Object.keys(ARCHETYPE_PROFILES) as Array<keyof typeof ARCHETYPE_PROFILES>) {
      const profile = ARCHETYPE_PROFILES[key]
      expect(profile.archetype).toBe(key)
      expect(typeof profile.aggression).toBe("number")
      expect(profile.aggression).toBeGreaterThanOrEqual(0)
      expect(profile.aggression).toBeLessThanOrEqual(1)
      expect(typeof profile.combatConfidenceBoost).toBe("number")
      expect(typeof profile.emergencyHpShift).toBe("number")
      expect(typeof profile.safeHealHpShift).toBe("number")
      expect(typeof profile.fleeDistanceBonus).toBe("number")
      expect(typeof profile.chestGreedMultiplier).toBe("number")
    }
  })

  it("getArchetypeProfile falls back to balanced on unknown input", () => {
    expect(getArchetypeProfile(undefined).archetype).toBe("balanced")
    // @ts-expect-error deliberately wrong
    expect(getArchetypeProfile("not-a-real-archetype").archetype).toBe("balanced")
  })

  it("parseBotArchetype tolerates typos", () => {
    expect(parseBotArchetype("aggressive")).toBe("aggressive")
    expect(parseBotArchetype("cautious")).toBe("cautious")
    expect(parseBotArchetype("opportunist")).toBe("opportunist")
    expect(parseBotArchetype(undefined)).toBe("balanced")
    expect(parseBotArchetype("bananas")).toBe("balanced")
  })

  it("resolveAggression respects env override and clamps to [0,1]", () => {
    expect(resolveAggression(undefined, 0.5)).toBe(0.5)
    expect(resolveAggression("0.8", 0.5)).toBe(0.8)
    expect(resolveAggression("1.9", 0.5)).toBe(1)
    expect(resolveAggression("-0.1", 0.5)).toBe(0)
    expect(resolveAggression("banana", 0.5)).toBe(0.5)
  })
})

describe("archetype wiring into modules", () => {
  it("ArenaCombatModule confidence reflects combatConfidenceBoost", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const opp = buildArenaEntity({
      id: "opp",
      position: { x: 6, y: 5 },
      hp: { current: 100, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, opp],
      legal_actions: [attackAction("opp")],
    })

    const mod = new ArenaCombatModule()
    const baseline = mod.analyze(obs, createArenaAgentContext())
    const aggressive = mod.analyze(
      obs,
      createArenaAgentContext({ archetype: ARCHETYPE_PROFILES.aggressive }),
    )
    const cautious = mod.analyze(
      obs,
      createArenaAgentContext({ archetype: ARCHETYPE_PROFILES.cautious }),
    )
    expect(aggressive.confidence).toBeGreaterThan(baseline.confidence)
    expect(cautious.confidence).toBeLessThan(baseline.confidence)
  })
})
