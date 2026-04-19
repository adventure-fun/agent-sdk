import { describe, expect, it } from "bun:test"
import {
  ARCHETYPE_PROFILES,
  createArenaAgentContext,
} from "../src/modules/index.js"
import { ArenaApproachModule } from "../src/modules/arena-approach.js"
import {
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
} from "./helpers/arena-fixture.js"

describe("ArenaApproachModule", () => {
  const mod = new ArenaApproachModule()

  it("emits move candidates toward the weakest player when no attack is legal", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const strong = buildArenaEntity({
      id: "strong",
      position: { x: 9, y: 5 },
      hp: { current: 100, max: 100 },
    })
    const weak = buildArenaEntity({
      id: "weak",
      position: { x: 8, y: 5 },
      hp: { current: 20, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, strong, weak],
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
        moveAction("right"),
      ],
    })
    const rec = mod.analyze(
      obs,
      createArenaAgentContext({ archetype: ARCHETYPE_PROFILES.aggressive }),
    )
    expect(rec.candidates).toBeDefined()
    expect(rec.suggestedAction?.type).toBe("move")
    if (rec.suggestedAction?.type === "move") {
      // Approaching the weak player at (8,5) means moving right.
      expect(rec.suggestedAction.direction).toBe("right")
    }
  })

  it("defers when a legal attack already exists (combat owns the turn)", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const foe = buildArenaEntity({ id: "foe", position: { x: 6, y: 5 } })
    const obs = buildArenaObservation({
      you,
      entities: [you, foe],
      legal_actions: [attackAction("foe"), moveAction("left")],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toBeUndefined()
  })

  it("respects archetype.approachDistanceMax", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const farPlayer = buildArenaEntity({
      id: "far",
      position: { x: 13, y: 5 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, farPlayer],
      legal_actions: [moveAction("right")],
    })
    const cautiousRec = mod.analyze(
      obs,
      createArenaAgentContext({ archetype: ARCHETYPE_PROFILES.cautious }),
    )
    expect(cautiousRec.suggestedAction).toBeUndefined()

    const aggressiveRec = mod.analyze(
      obs,
      createArenaAgentContext({ archetype: ARCHETYPE_PROFILES.aggressive }),
    )
    expect(aggressiveRec.suggestedAction).toBeDefined()
  })
})
