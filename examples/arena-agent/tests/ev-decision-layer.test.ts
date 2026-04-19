import { describe, expect, it } from "bun:test"
import {
  collectAllCandidates,
  LEGACY_UTILITY_SCALE,
  pickTopEvCandidate,
  type ArenaModuleRecommendation,
} from "../src/modules/base.js"
import {
  ARCHETYPE_PROFILES,
  ArenaApproachModule,
  ArenaCombatModule,
  ArenaCowardiceAvoidanceModule,
  ArenaPositioningModule,
  ArenaWavePredictorModule,
  createArenaAgentContext,
  createArenaModuleRegistry,
} from "../src/modules/index.js"
import {
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
  proximityWarning,
} from "./helpers/arena-fixture.js"

/**
 * Integration tests exercising the full module roster + EV decision
 * layer. These verify the behavioral invariants that motivated the
 * rewrite:
 *
 *   (A) Bots actually commit to attacks when one is profitable.
 *   (B) Cowardice-avoidance no longer ping-pongs — attack wins when
 *       HP advantage is real, flee wins when it isn't.
 *   (C) Aggressive archetypes reach targets faster than cautious ones.
 *
 * The D-case (chest-looter opportunism) was retired alongside the
 * `ArenaChestLooterModule` — arena is now equipment-only, see
 * ARENA_DESIGN.md §1/§9/§10.
 */
describe("EV decision layer — pickTopEvCandidate", () => {
  it("projects legacy confidence-only recommendations into utility space via LEGACY_UTILITY_SCALE", () => {
    const recs: ArenaModuleRecommendation[] = [
      {
        moduleName: "legacy-high",
        confidence: 0.9,
        reasoning: "legacy high conf",
        suggestedAction: { type: "wait" },
      },
      {
        moduleName: "legacy-low",
        confidence: 0.3,
        reasoning: "legacy low conf",
        suggestedAction: moveAction("up"),
      },
    ]
    const flat = collectAllCandidates(recs)
    expect(flat.length).toBe(2)
    const top = pickTopEvCandidate(recs)
    expect(top).toBeDefined()
    expect(top!.moduleName).toBe("legacy-high")
    expect(top!.utility).toBeCloseTo(0.9 * LEGACY_UTILITY_SCALE)
  })

  it("argmaxes utility across EV candidates from multiple modules", () => {
    const recs: ArenaModuleRecommendation[] = [
      {
        moduleName: "combat",
        confidence: 0.6,
        reasoning: "combat rec",
        candidates: [
          {
            action: attackAction("rival"),
            reasoning: "ev attack rival",
            utility: 55,
            moduleName: "combat",
            components: {
              expected_damage_dealt: 20,
              expected_damage_taken: 5,
              expected_heal: 0,
              strategic_bonus: 10,
              risk_weight: 0.7,
            },
          },
        ],
      },
      {
        moduleName: "positioning",
        confidence: 0.3,
        reasoning: "positioning rec",
        candidates: [
          {
            action: moveAction("left"),
            reasoning: "ev move left",
            utility: 10,
            moduleName: "positioning",
            components: {
              expected_damage_dealt: 0,
              expected_damage_taken: 1,
              expected_heal: 0,
              strategic_bonus: 5,
              risk_weight: 0.7,
            },
          },
        ],
      },
    ]
    const top = pickTopEvCandidate(recs)
    expect(top?.action.type).toBe("attack")
    expect(top?.moduleName).toBe("combat")
  })
})

describe("EV integration — module roster on a single turn", () => {
  const balanced = ARCHETYPE_PROFILES.balanced
  const aggressive = ARCHETYPE_PROFILES.aggressive
  const cautious = ARCHETYPE_PROFILES.cautious

  function buildRegistry() {
    return createArenaModuleRegistry([
      new ArenaCowardiceAvoidanceModule(),
      new ArenaCombatModule(),
      new ArenaPositioningModule(),
      new ArenaApproachModule(),
      new ArenaWavePredictorModule(),
    ])
  }

  it("A: commits to an attack when a PvP opponent is adjacent and attack is legal", () => {
    const you = buildArenaEntity({
      id: "you",
      position: { x: 5, y: 5 },
      hp: { current: 90, max: 100 },
    })
    const foe = buildArenaEntity({
      id: "foe",
      position: { x: 6, y: 5 },
      hp: { current: 50, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, foe],
      legal_actions: [
        attackAction("foe"),
        moveAction("left"),
        moveAction("up"),
        moveAction("down"),
        { type: "wait" },
      ],
    })
    const recs = buildRegistry().analyzeAll(
      obs,
      createArenaAgentContext({ archetype: balanced }),
    )
    const top = pickTopEvCandidate(recs)
    expect(top?.action.type).toBe("attack")
  })

  it("B: cowardice avoidance commits to attack at HP advantage, flees at disadvantage", () => {
    const fightingYou = buildArenaEntity({
      id: "you",
      position: { x: 5, y: 5 },
      hp: { current: 95, max: 100 },
    })
    const woundedRival = buildArenaEntity({
      id: "rival",
      position: { x: 6, y: 5 },
      hp: { current: 20, max: 100 },
    })
    const fightingObs = buildArenaObservation({
      you: fightingYou,
      entities: [fightingYou, woundedRival],
      legal_actions: [
        attackAction("rival"),
        moveAction("left"),
        moveAction("up"),
        moveAction("down"),
      ],
      proximity_warnings: [proximityWarning("you", "rival", 1)],
    })
    const fightRecs = buildRegistry().analyzeAll(
      fightingObs,
      createArenaAgentContext({ archetype: balanced }),
    )
    expect(pickTopEvCandidate(fightRecs)?.action.type).toBe("attack")

    // Same geometry but we're near death — flee must win.
    const dyingYou = buildArenaEntity({
      id: "you",
      position: { x: 5, y: 5 },
      hp: { current: 15, max: 100 },
    })
    const healthyRival = buildArenaEntity({
      id: "rival",
      position: { x: 6, y: 5 },
      hp: { current: 95, max: 100 },
    })
    const fleeObs = buildArenaObservation({
      you: dyingYou,
      entities: [dyingYou, healthyRival],
      legal_actions: [
        attackAction("rival"),
        moveAction("left"),
        moveAction("up"),
        moveAction("down"),
      ],
      proximity_warnings: [proximityWarning("you", "rival", 1)],
    })
    const fleeRecs = buildRegistry().analyzeAll(
      fleeObs,
      createArenaAgentContext({ archetype: balanced }),
    )
    // Either the self-care module fires OR a flee move wins; crucially,
    // attacking the full-HP rival must NOT be the top EV pick.
    const top = pickTopEvCandidate(fleeRecs)
    expect(top?.action.type).not.toBe("attack")
  })

  it("C: aggressive archetype picks a move candidate when no attack is legal (approach kicks in)", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 3, y: 5 } })
    const rival = buildArenaEntity({
      id: "rival",
      position: { x: 9, y: 5 },
      hp: { current: 30, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, rival],
      legal_actions: [
        moveAction("right"),
        moveAction("up"),
        moveAction("down"),
        { type: "wait" },
      ],
    })
    const recs = buildRegistry().analyzeAll(
      obs,
      createArenaAgentContext({ archetype: aggressive }),
    )
    const top = pickTopEvCandidate(recs)
    expect(top?.action.type).toBe("move")
    if (top?.action.type === "move") {
      expect(top.action.direction).toBe("right")
    }
  })

  it("C': cautious archetype with a far-away rival prefers waiting/positioning over chasing", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 3, y: 5 } })
    const rival = buildArenaEntity({
      id: "rival",
      position: { x: 9, y: 5 }, // distance 6 — beyond cautious(4), within aggressive(8)
      hp: { current: 80, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, rival],
      legal_actions: [
        moveAction("right"),
        moveAction("up"),
        moveAction("down"),
        { type: "wait" },
      ],
    })
    const cautiousRecs = buildRegistry().analyzeAll(
      obs,
      createArenaAgentContext({ archetype: cautious }),
    )
    // The approach module must not fire for cautious at this distance.
    // Other modules may still move the bot (e.g. positioning to center),
    // but chasing-via-approach is the specific behavior we want to suppress.
    const cautiousApproachRec = cautiousRecs.find(
      (r) => r.moduleName === "arena-approach",
    )
    expect(cautiousApproachRec?.suggestedAction).toBeUndefined()

    // Same scenario for aggressive: approach SHOULD fire.
    const aggRecs = buildRegistry().analyzeAll(
      obs,
      createArenaAgentContext({ archetype: aggressive }),
    )
    const aggApproachRec = aggRecs.find(
      (r) => r.moduleName === "arena-approach",
    )
    expect(aggApproachRec?.suggestedAction).toBeDefined()
  })

})
