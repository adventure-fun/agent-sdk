import { describe, expect, it } from "bun:test"
import { ArenaCombatModule } from "../src/modules/arena-combat.js"
import { createArenaAgentContext } from "../src/modules/base.js"
import {
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
} from "./helpers/arena-fixture.js"

describe("ArenaCombatModule", () => {
  const mod = new ArenaCombatModule()

  it("defers (low confidence) when no legal attack is present", () => {
    const obs = buildArenaObservation()
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toBeUndefined()
    expect(rec.confidence).toBeLessThan(0.3)
  })

  it("picks the lowest-HP player target it can finish this turn", () => {
    const you = buildArenaEntity({
      id: "you",
      position: { x: 7, y: 7 },
      stats: {
        hp: 100,
        attack: 15,
        defense: 5,
        accuracy: 13,
        evasion: 14,
        speed: 15,
      },
    })
    const wounded = buildArenaEntity({
      id: "wounded",
      name: "Wounded",
      class: "mage",
      position: { x: 8, y: 7 },
      hp: { current: 8, max: 100 },
    })
    const healthy = buildArenaEntity({
      id: "healthy",
      name: "Healthy",
      class: "knight",
      position: { x: 6, y: 7 },
      hp: { current: 90, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, wounded, healthy],
      legal_actions: [
        attackAction("wounded"),
        attackAction("healthy"),
        moveAction("up"),
      ],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toEqual(attackAction("wounded"))
    expect(rec.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it("prefers a player target over an NPC even if the NPC is closer", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 7, y: 7 } })
    const player = buildArenaEntity({
      id: "pvp",
      name: "Rival",
      class: "mage",
      position: { x: 8, y: 7 },
    })
    const npc = buildArenaEntity({
      id: "rat",
      kind: "npc",
      name: "Hollow Rat",
      position: { x: 6, y: 7 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, player, npc],
      legal_actions: [attackAction("pvp"), attackAction("rat"), moveAction("up")],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toEqual(attackAction("pvp"))
  })

  it("falls back to NPC target when it is the only legal attack", () => {
    const you = buildArenaEntity({ id: "you" })
    const npc = buildArenaEntity({
      id: "rat",
      kind: "npc",
      name: "Hollow Rat",
      position: { x: 8, y: 7 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, npc],
      legal_actions: [attackAction("rat"), moveAction("up")],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toEqual(attackAction("rat"))
  })

  it("prefers the highest-threat ranged target when no finishing blow is available", () => {
    const you = buildArenaEntity({
      id: "you",
      position: { x: 7, y: 7 },
      stats: {
        hp: 100,
        attack: 10,
        defense: 5,
        accuracy: 13,
        evasion: 14,
        speed: 15,
      },
    })
    const mage = buildArenaEntity({
      id: "mage",
      name: "Mage",
      class: "mage",
      position: { x: 9, y: 7 },
      abilities: ["mage-fireball"],
      cooldowns: { "mage-fireball": 0 },
      stats: {
        hp: 80,
        attack: 18,
        defense: 4,
        accuracy: 13,
        evasion: 12,
        speed: 15,
      },
      hp: { current: 80, max: 80 },
    })
    const knight = buildArenaEntity({
      id: "knight",
      name: "Knight",
      class: "knight",
      position: { x: 6, y: 7 },
      stats: {
        hp: 120,
        attack: 9,
        defense: 12,
        accuracy: 12,
        evasion: 8,
        speed: 10,
      },
      hp: { current: 120, max: 120 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, mage, knight],
      legal_actions: [
        attackAction("mage", "rogue-backstab"),
        attackAction("knight"),
        moveAction("up"),
      ],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction?.type).toBe("attack")
    if (rec.suggestedAction?.type === "attack") {
      expect(rec.suggestedAction.target_id).toBe("mage")
    }
  })
})
