import { describe, it, expect } from "bun:test"
import { resolveAttack, resolveStatusEffectTick, calcHitThreshold } from "../src/combat.js"
import { SeededRng } from "../src/rng.js"
import type { Combatant } from "../src/combat.js"

const makeAttacker = (overrides?: Partial<Combatant>): Combatant => ({
  id: "attacker",
  stats: { hp: 100, attack: 20, defense: 5, accuracy: 80, evasion: 10, speed: 10 },
  hp: 100,
  active_effects: [],
  ...overrides,
})

const makeDefender = (overrides?: Partial<Combatant>): Combatant => ({
  id: "defender",
  stats: { hp: 50, attack: 10, defense: 3, accuracy: 50, evasion: 15, speed: 5 },
  hp: 50,
  active_effects: [],
  ...overrides,
})

describe("resolveAttack", () => {
  it("always deals minimum 1 damage on hit even with very high defense", () => {
    const attacker = makeAttacker({ stats: { hp: 100, attack: 1, defense: 0, accuracy: 999, evasion: 0, speed: 0 } })
    const defender = makeDefender({ stats: { hp: 100, attack: 0, defense: 9999, accuracy: 0, evasion: 0, speed: 0 } })
    // Force a hit by using a seed that produces a near-zero first value
    const rng = new SeededRng(1)
    // Try many times — at least one must be a hit with min damage 1
    let gotHitWithDamage1 = false
    for (let i = 0; i < 200; i++) {
      const result = resolveAttack(makeAttacker({ stats: { hp: 100, attack: 1, defense: 0, accuracy: 999, evasion: 0, speed: 0 } }), makeDefender({ stats: { hp: 100, attack: 0, defense: 9999, accuracy: 0, evasion: 0, speed: 0 } }), new SeededRng(i))
      if (result.hit && result.damage >= 1) { gotHitWithDamage1 = true; break }
    }
    expect(gotHitWithDamage1).toBe(true)
  })

  it("is deterministic — same seed produces same result", () => {
    const attacker = makeAttacker()
    const defender = makeDefender()
    const result1 = resolveAttack(attacker, defender, new SeededRng(42))
    const result2 = resolveAttack(attacker, defender, new SeededRng(42))
    expect(result1.hit).toBe(result2.hit)
    expect(result1.damage).toBe(result2.damage)
    expect(result1.critical).toBe(result2.critical)
  })

  it("damage = max(1, attack - defense) on a normal hit", () => {
    // Use known-hit seed (attacker has very high accuracy)
    const attacker = makeAttacker({ stats: { hp: 100, attack: 20, defense: 0, accuracy: 999, evasion: 0, speed: 0 } })
    const defender = makeDefender({ stats: { hp: 50, attack: 0, defense: 5, accuracy: 0, evasion: 0, speed: 0 } })
    // Find a seed that gives a non-crit hit
    for (let seed = 0; seed < 100; seed++) {
      const result = resolveAttack(attacker, defender, new SeededRng(seed))
      if (result.hit && !result.critical) {
        expect(result.damage).toBe(Math.max(1, 20 - 5))
        return
      }
    }
    // If we reach here, every roll was a crit — that's statistically impossible with 5% crit
    throw new Error("Could not find a non-crit hit in 100 seeds")
  })

  it("critical hit deals 1.5x damage", () => {
    const attacker = makeAttacker()
    const defender = makeDefender({ stats: { hp: 50, attack: 0, defense: 0, accuracy: 0, evasion: 0, speed: 0 } })
    for (let seed = 0; seed < 1000; seed++) {
      const result = resolveAttack(attacker, defender, new SeededRng(seed))
      if (result.critical) {
        // base damage would be max(1, 20 - 0) = 20, crit = floor(20 * 1.5) = 30
        expect(result.damage).toBe(30)
        return
      }
    }
    throw new Error("No critical hit found in 1000 seeds")
  })

  it("applies on-hit status effects based on apply_chance", () => {
    const attacker = makeAttacker({ stats: { hp: 100, attack: 20, defense: 0, accuracy: 999, evasion: 0, speed: 0 } })
    const defender = makeDefender({ stats: { hp: 500, attack: 0, defense: 0, accuracy: 0, evasion: 0, speed: 0 } })
    const poisonEffect = { type: "poison" as const, duration_turns: 3, magnitude: 5, apply_chance: 1.0 }
    let foundPoison = false
    for (let seed = 0; seed < 200; seed++) {
      const result = resolveAttack(attacker, defender, new SeededRng(seed), undefined, [poisonEffect])
      if (result.hit && result.effects_applied.some(e => e.type === "poison")) {
        foundPoison = true
        break
      }
    }
    expect(foundPoison).toBe(true)
  })

  it("reports death event when defender hp reaches 0", () => {
    const attacker = makeAttacker({ stats: { hp: 100, attack: 9999, defense: 0, accuracy: 999, evasion: 0, speed: 0 } })
    const defender = makeDefender({ hp: 1 })
    for (let seed = 0; seed < 200; seed++) {
      const result = resolveAttack(attacker, defender, new SeededRng(seed))
      if (result.hit) {
        expect(result.defender_hp_after).toBeLessThanOrEqual(0)
        expect(result.events.some(e => e.type === "death")).toBe(true)
        return
      }
    }
  })
})

describe("resolveStatusEffectTick", () => {
  it("deals poison damage each turn", () => {
    const combatant: Combatant = {
      ...makeDefender(),
      active_effects: [{ type: "poison", turns_remaining: 3, magnitude: 5 }],
    }
    const { damage } = resolveStatusEffectTick(combatant)
    expect(damage).toBe(5)
  })

  it("decrements effect duration each tick", () => {
    const combatant: Combatant = {
      ...makeDefender(),
      active_effects: [{ type: "poison", turns_remaining: 2, magnitude: 5 }],
    }
    const { updated_effects } = resolveStatusEffectTick(combatant)
    expect(updated_effects).toHaveLength(1)
    expect(updated_effects[0]?.turns_remaining).toBe(1)
  })

  it("removes expired effects", () => {
    const combatant: Combatant = {
      ...makeDefender(),
      active_effects: [{ type: "poison", turns_remaining: 1, magnitude: 5 }],
    }
    const { updated_effects } = resolveStatusEffectTick(combatant)
    expect(updated_effects).toHaveLength(0)
  })
})

describe("calcHitThreshold", () => {
  it("returns value between 0.05 and 0.95", () => {
    const threshold = calcHitThreshold(
      { hp: 100, attack: 10, defense: 5, accuracy: 80, evasion: 10, speed: 10 },
      { hp: 50, attack: 5, defense: 3, accuracy: 50, evasion: 15, speed: 5 },
    )
    expect(threshold).toBeGreaterThanOrEqual(0.05)
    expect(threshold).toBeLessThanOrEqual(0.95)
  })
})
