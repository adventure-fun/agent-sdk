import { describe, expect, it } from "bun:test"
import { rankThreats } from "../src/modules/arena-threat-model.js"
import {
  buildArenaEntity,
  buildArenaObservation,
} from "./helpers/arena-fixture.js"

describe("rankThreats", () => {
  it("returns empty when no opponents are present", () => {
    const obs = buildArenaObservation()
    const ranked = rankThreats(obs)
    expect(ranked).toEqual([])
  })

  it("sorts opponents by descending threat score", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 7, y: 7 } })
    const close = buildArenaEntity({
      id: "close",
      name: "Close",
      position: { x: 8, y: 7 },
    })
    const far = buildArenaEntity({
      id: "far",
      name: "Far",
      position: { x: 1, y: 1 },
    })
    const obs = buildArenaObservation({ you, entities: [you, close, far] })
    const ranked = rankThreats(obs)
    expect(ranked.map((t) => t.entity.id)).toEqual(["close", "far"])
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0)
  })

  it("ranks low-HP finishable opponents at the top regardless of distance", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 1, y: 1 } })
    const wounded = buildArenaEntity({
      id: "wounded",
      position: { x: 6, y: 6 },
      hp: { current: 8, max: 100 },
    })
    const healthy = buildArenaEntity({
      id: "healthy",
      position: { x: 2, y: 2 },
      hp: { current: 100, max: 100 },
    })
    const obs = buildArenaObservation({ you, entities: [you, healthy, wounded] })
    const ranked = rankThreats(obs)
    expect(ranked[0]?.entity.id).toBe("wounded")
  })

  it("excludes dead and stealthed entities", () => {
    const you = buildArenaEntity({ id: "you" })
    const dead = buildArenaEntity({
      id: "dead",
      position: { x: 8, y: 7 },
      alive: false,
    })
    const stealth = buildArenaEntity({
      id: "stealth",
      position: { x: 6, y: 7 },
      stealth: true,
    })
    const normal = buildArenaEntity({ id: "normal", position: { x: 5, y: 7 } })
    const obs = buildArenaObservation({
      you,
      entities: [you, dead, stealth, normal],
    })
    const ranked = rankThreats(obs)
    expect(ranked.map((t) => t.entity.id)).toEqual(["normal"])
  })

  it("is deterministic for identical inputs", () => {
    const you = buildArenaEntity({ id: "you" })
    const a = buildArenaEntity({ id: "a", position: { x: 8, y: 7 } })
    const b = buildArenaEntity({ id: "b", position: { x: 7, y: 8 } })
    const obs = buildArenaObservation({ you, entities: [you, a, b] })
    const first = rankThreats(obs).map((t) => t.entity.id)
    const second = rankThreats(obs).map((t) => t.entity.id)
    expect(first).toEqual(second)
  })
})
