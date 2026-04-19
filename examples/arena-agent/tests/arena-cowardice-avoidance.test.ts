import { describe, expect, it } from "bun:test"
import { ArenaCowardiceAvoidanceModule } from "../src/modules/arena-cowardice-avoidance.js"
import { createArenaAgentContext } from "../src/modules/base.js"
import {
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
  proximityWarning,
} from "./helpers/arena-fixture.js"

describe("ArenaCowardiceAvoidanceModule", () => {
  const mod = new ArenaCowardiceAvoidanceModule()

  it("does nothing when no proximity warnings involve us", () => {
    const you = buildArenaEntity({ id: "you" })
    const other = buildArenaEntity({ id: "other", position: { x: 4, y: 4 } })
    const obs = buildArenaObservation({
      you,
      entities: [you, other],
      proximity_warnings: [proximityWarning("other", "third", 1)],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toBeUndefined()
  })

  it("commits to attacking when a legal attack exists and we have HP advantage", () => {
    const you = buildArenaEntity({
      id: "you",
      position: { x: 5, y: 5 },
      hp: { current: 95, max: 100 },
    })
    const rival = buildArenaEntity({
      id: "rival",
      position: { x: 6, y: 5 },
      hp: { current: 30, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, rival],
      legal_actions: [
        attackAction("rival"),
        moveAction("up"),
        moveAction("left"),
      ],
      proximity_warnings: [proximityWarning("you", "rival", 1)],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    // EV model: both attack and flee candidates are emitted; with a
    // 65 HP-ratio advantage the attack dominates by utility.
    expect(rec.suggestedAction).toEqual(attackAction("rival"))
    const attackCandidate = rec.candidates?.find(
      (c) => c.action.type === "attack" && c.action.target_id === "rival",
    )
    const fleeCandidates = rec.candidates?.filter((c) => c.action.type === "move") ?? []
    const bestFlee = fleeCandidates.reduce<number | null>(
      (m, c) => (m === null || c.utility > m ? c.utility : m),
      null,
    )
    expect(attackCandidate).toBeDefined()
    expect(attackCandidate!.utility).toBeGreaterThan(bestFlee ?? -Infinity)
  })

  it("breaks range when pressed at counter 1 without HP advantage", () => {
    const you = buildArenaEntity({
      id: "you",
      position: { x: 5, y: 5 },
      hp: { current: 40, max: 100 },
    })
    const rival = buildArenaEntity({
      id: "rival",
      position: { x: 6, y: 5 },
      hp: { current: 90, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, rival],
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
        moveAction("right"),
      ],
      proximity_warnings: [proximityWarning("you", "rival", 1)],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction?.type).toBe("move")
    if (rec.suggestedAction?.type === "move") {
      expect(["left", "up", "down"]).toContain(rec.suggestedAction.direction)
    }
  })

  it("never issues `wait` when cowardice damage is one turn away", () => {
    const you = buildArenaEntity({
      id: "you",
      position: { x: 5, y: 5 },
    })
    const rival = buildArenaEntity({
      id: "rival",
      position: { x: 6, y: 5 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, rival],
      legal_actions: [{ type: "wait" }, moveAction("left")],
      proximity_warnings: [proximityWarning("you", "rival", 1)],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).not.toEqual({ type: "wait" })
  })
})
