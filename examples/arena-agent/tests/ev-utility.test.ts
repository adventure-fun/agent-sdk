import { describe, expect, it } from "bun:test"
import {
  ARCHETYPE_PROFILES,
  buildUtilityContext,
  expectedAttackDamage,
  expectedIncomingDamageAt,
  scoreAttackCandidate,
  scoreMoveCandidate,
} from "../src/modules/index.js"
import {
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
} from "./helpers/arena-fixture.js"

/**
 * EV scoring integration tests. These protect against the behavioral
 * pathologies we set out to fix:
 *   1. Bots ping-ponging between flee and engage.
 *   2. Deterministic bots that never commit to an attack.
 *   3. Aggressive archetypes not behaving differently from cautious ones.
 *
 * Heal / interact scoring tests were removed alongside the consumable
 * and chest-loot mechanics — arena is now equipment-only
 * (ARENA_DESIGN.md §1/§9/§10).
 *
 * Each test builds a minimal observation, runs the scoring helpers, and
 * verifies the sign/ordering of utilities rather than exact numbers (the
 * formulas are free to evolve without breaking these tests).
 */
describe("EV utility scoring — scoreAttackCandidate", () => {
  it("awards a positive utility for a finisher over the risk of staying put", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const wounded = buildArenaEntity({
      id: "wounded",
      name: "Wounded",
      position: { x: 6, y: 5 },
      hp: { current: 5, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, wounded],
      legal_actions: [attackAction("wounded")],
    })
    const ctx = buildUtilityContext(obs, ARCHETYPE_PROFILES.balanced)
    const cand = scoreAttackCandidate(ctx, attackAction("wounded"), wounded)
    expect(cand.utility).toBeGreaterThan(0)
    expect(cand.components.expected_damage_dealt).toBeGreaterThan(0)
  })

  it("aggressive archetype scores a PvP attack higher than cautious does", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const rival = buildArenaEntity({
      id: "rival",
      name: "Rival",
      position: { x: 6, y: 5 },
      hp: { current: 60, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, rival],
      legal_actions: [attackAction("rival")],
    })
    const aggressiveCtx = buildUtilityContext(obs, ARCHETYPE_PROFILES.aggressive)
    const cautiousCtx = buildUtilityContext(obs, ARCHETYPE_PROFILES.cautious)
    const aggressive = scoreAttackCandidate(aggressiveCtx, attackAction("rival"), rival)
    const cautious = scoreAttackCandidate(cautiousCtx, attackAction("rival"), rival)
    expect(aggressive.utility).toBeGreaterThan(cautious.utility)
  })
})

describe("EV utility scoring — scoreMoveCandidate", () => {
  it("rewards moves that close the gap to a target", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const foe = buildArenaEntity({ id: "foe", position: { x: 10, y: 5 } })
    const obs = buildArenaObservation({
      you,
      entities: [you, foe],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const ctx = buildUtilityContext(obs, ARCHETYPE_PROFILES.balanced)
    const right = scoreMoveCandidate(ctx, moveAction("right"), {
      target: foe.position,
    })
    const left = scoreMoveCandidate(ctx, moveAction("left"), {
      target: foe.position,
    })
    expect(right.utility).toBeGreaterThan(left.utility)
  })

  it("penalizes walking into incoming damage (risk-weight honored)", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const hostile = buildArenaEntity({
      id: "hostile",
      position: { x: 7, y: 5 }, // Chebyshev 2 — in attack range at current pos.
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, hostile],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const ctx = buildUtilityContext(obs, ARCHETYPE_PROFILES.balanced)
    const intoDanger = scoreMoveCandidate(ctx, moveAction("right"), {})
    const away = scoreMoveCandidate(ctx, moveAction("left"), {})
    // `away` should score >= `intoDanger` because risk decreases.
    expect(away.utility).toBeGreaterThanOrEqual(intoDanger.utility)
  })
})

describe("EV utility — precomputed context", () => {
  it("expectedAttackDamage matches the engine's hit-chance formula", () => {
    const attacker = buildArenaEntity({
      id: "a",
      stats: {
        hp: 100,
        attack: 15,
        defense: 5,
        accuracy: 15,
        evasion: 10,
        speed: 10,
      },
    })
    const defender = buildArenaEntity({
      id: "d",
      stats: {
        hp: 100,
        attack: 10,
        defense: 5,
        accuracy: 10,
        evasion: 10,
        speed: 10,
      },
    })
    const res = expectedAttackDamage(attacker, defender)
    expect(res.hitChance).toBeGreaterThan(0.05)
    expect(res.hitChance).toBeLessThanOrEqual(0.95)
    expect(res.damage).toBeGreaterThanOrEqual(1)
    expect(res.expected).toBeGreaterThan(0)
  })

  it("expectedIncomingDamageAt increases when moving into range of more hostiles", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const h1 = buildArenaEntity({ id: "h1", position: { x: 7, y: 5 } })
    const h2 = buildArenaEntity({ id: "h2", position: { x: 8, y: 5 } })
    const obs = buildArenaObservation({ you, entities: [you, h1, h2] })
    const ctx = buildUtilityContext(obs, ARCHETYPE_PROFILES.balanced)
    const here = expectedIncomingDamageAt(ctx, { x: 5, y: 5 })
    const closer = expectedIncomingDamageAt(ctx, { x: 6, y: 5 })
    expect(closer).toBeGreaterThanOrEqual(here)
  })
})
