import { describe, expect, it } from "bun:test"
import { ArenaWavePredictorModule } from "../src/modules/arena-wave-predictor.js"
import { createArenaAgentContext } from "../src/modules/base.js"
import {
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
} from "./helpers/arena-fixture.js"

describe("ArenaWavePredictorModule", () => {
  it("defers when next_wave_turn is null or far off", () => {
    const mod = new ArenaWavePredictorModule([{ x: 0, y: 7 }])
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 7 } })
    const obs = buildArenaObservation({
      you,
      entities: [you],
      next_wave_turn: null,
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    expect(mod.analyze(obs, createArenaAgentContext()).suggestedAction).toBeUndefined()
  })

  it("positions between opponent and the nearest spawn point when wave is within 2 turns", () => {
    const spawn = { x: 0, y: 7 }
    const mod = new ArenaWavePredictorModule([spawn])
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 7 } })
    const opponent = buildArenaEntity({
      id: "opp",
      position: { x: 10, y: 7 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, opponent],
      turn: 5,
      next_wave_turn: 7,
      legal_actions: [
        moveAction("left"),
        moveAction("right"),
        moveAction("up"),
        moveAction("down"),
      ],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction?.type).toBe("move")
    if (rec.suggestedAction?.type === "move") {
      // Opponent is east, spawn is west — baiting the wave toward the
      // opponent means getting further east (closer to the opponent's side).
      expect(rec.suggestedAction.direction).toBe("right")
    }
  })

  it("defers when no opponents are alive", () => {
    const mod = new ArenaWavePredictorModule([{ x: 0, y: 7 }])
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 7 } })
    const obs = buildArenaObservation({
      you,
      entities: [you],
      turn: 5,
      next_wave_turn: 7,
      legal_actions: [moveAction("right")],
    })
    expect(mod.analyze(obs, createArenaAgentContext()).suggestedAction).toBeUndefined()
  })

  it("defers when no spawn points are configured", () => {
    const mod = new ArenaWavePredictorModule([])
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 7 } })
    const opp = buildArenaEntity({ id: "opp", position: { x: 10, y: 7 } })
    const obs = buildArenaObservation({
      you,
      entities: [you, opp],
      turn: 5,
      next_wave_turn: 7,
      legal_actions: [moveAction("right")],
    })
    expect(mod.analyze(obs, createArenaAgentContext()).suggestedAction).toBeUndefined()
  })
})
