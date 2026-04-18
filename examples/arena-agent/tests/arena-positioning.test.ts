import { describe, expect, it } from "bun:test"
import { ArenaPositioningModule } from "../src/modules/arena-positioning.js"
import { createArenaAgentContext } from "../src/modules/base.js"
import {
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
} from "./helpers/arena-fixture.js"

describe("ArenaPositioningModule", () => {
  const mod = new ArenaPositioningModule()

  it("in grace phase, moves the agent toward the map center from a corner", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 2, y: 2 } })
    const obs = buildArenaObservation({
      you,
      entities: [you],
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("right"),
        moveAction("left"),
      ],
      phase: "grace",
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toBeDefined()
    expect(rec.suggestedAction?.type).toBe("move")
    if (rec.suggestedAction?.type === "move") {
      expect(["down", "right"]).toContain(rec.suggestedAction.direction)
    }
  })

  it("when losing a nearby exchange, moves to break range from the pressing opponent", () => {
    const you = buildArenaEntity({
      id: "you",
      position: { x: 5, y: 5 },
      hp: { current: 25, max: 100 },
    })
    const predator = buildArenaEntity({
      id: "predator",
      position: { x: 6, y: 5 },
      hp: { current: 90, max: 100 },
      stats: {
        hp: 100,
        attack: 20,
        defense: 10,
        accuracy: 14,
        evasion: 12,
        speed: 16,
      },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, predator],
      phase: "active",
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
        moveAction("right"),
      ],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction?.type).toBe("move")
    if (rec.suggestedAction?.type === "move") {
      // Moving left or up/down increases distance from the predator at x=6.
      expect(["left", "up", "down"]).toContain(rec.suggestedAction.direction)
    }
  })

  it("defers when no legal move actions are available", () => {
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({
      you,
      entities: [you],
      legal_actions: [{ type: "wait" }],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toBeUndefined()
    expect(rec.confidence).toBeLessThan(0.3)
  })

  it("closes distance toward center before an imminent wave", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 2, y: 7 } })
    const obs = buildArenaObservation({
      you,
      entities: [you],
      phase: "active",
      turn: 10,
      next_wave_turn: 11,
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
        moveAction("right"),
      ],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction?.type).toBe("move")
    if (rec.suggestedAction?.type === "move") {
      expect(rec.suggestedAction.direction).toBe("right")
    }
  })
})
