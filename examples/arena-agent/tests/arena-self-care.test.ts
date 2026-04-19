import { describe, expect, it } from "bun:test"
import type { InventoryItem } from "../../../src/index.js"
import { ArenaSelfCareModule } from "../src/modules/arena-self-care.js"
import { createArenaAgentContext } from "../src/modules/base.js"
import {
  buildArenaEntity,
  buildArenaObservation,
} from "./helpers/arena-fixture.js"

function healItem(templateId: string, id = `inv-${templateId}`): InventoryItem {
  return {
    id,
    template_id: templateId,
    name: templateId,
    quantity: 1,
    modifiers: {},
    owner_type: "character",
    owner_id: "char-you",
  }
}

describe("ArenaSelfCareModule", () => {
  const module = new ArenaSelfCareModule()
  const ctx = createArenaAgentContext()

  it("returns confidence 0 at full HP (no heal needed)", () => {
    const you = buildArenaEntity({ id: "you", hp: { current: 100, max: 100 } })
    you.inventory = [healItem("health-potion")]
    const obs = buildArenaObservation({
      you,
      legal_actions: [{ type: "use_item", item_id: "inv-health-potion" }, { type: "wait" }],
    })
    const rec = module.analyze(obs, ctx)
    expect(rec.confidence).toBe(0)
    expect(rec.suggestedAction).toBeUndefined()
  })

  it("returns confidence 0.95 with emergency-heal action at HP < 25%", () => {
    const you = buildArenaEntity({ id: "you", hp: { current: 20, max: 100 } })
    // Adjacent hostile — emergency still fires even with threat in range.
    const adjacentHostile = buildArenaEntity({
      id: "enemy",
      position: { x: 8, y: 7 },
      hp: { current: 100, max: 100 },
    })
    you.inventory = [healItem("health-potion"), healItem("greater-health-potion")]
    const obs = buildArenaObservation({
      you,
      entities: [you, adjacentHostile],
      legal_actions: [
        { type: "use_item", item_id: "inv-health-potion" },
        { type: "use_item", item_id: "inv-greater-health-potion" },
        { type: "wait" },
      ],
    })
    const rec = module.analyze(obs, ctx)
    // Under the EV model, self-care surfaces emergency via confidence
    // >= 0.9 and still prefers the largest heal as the top candidate.
    expect(rec.confidence).toBeGreaterThanOrEqual(0.9)
    expect(rec.suggestedAction).toEqual({
      type: "use_item",
      item_id: "inv-greater-health-potion",
    })
  })

  it("returns confidence 0.70 (safe-heal) when HP < 50% and no hostile within 2 tiles", () => {
    const you = buildArenaEntity({ id: "you", hp: { current: 40, max: 100 } })
    const farHostile = buildArenaEntity({
      id: "enemy",
      position: { x: 14, y: 14 },
      hp: { current: 100, max: 100 },
    })
    you.inventory = [healItem("health-potion"), healItem("greater-health-potion")]
    const obs = buildArenaObservation({
      you,
      entities: [you, farHostile],
      legal_actions: [
        { type: "use_item", item_id: "inv-health-potion" },
        { type: "use_item", item_id: "inv-greater-health-potion" },
        { type: "wait" },
      ],
    })
    const rec = module.analyze(obs, ctx)
    // Safe heal now scored via EV utility; confidence signals "safe tier".
    expect(rec.confidence).toBeGreaterThanOrEqual(0.5)
    expect(rec.confidence).toBeLessThan(0.9)
    // Largest heal wins on utility (closes the 60 HP gap without waste).
    expect(rec.suggestedAction).toEqual({
      type: "use_item",
      item_id: "inv-greater-health-potion",
    })
  })

  it("does NOT fire at HP < 50% if a hostile is within 2 tiles (non-emergency)", () => {
    const you = buildArenaEntity({ id: "you", hp: { current: 40, max: 100 } })
    const closeHostile = buildArenaEntity({
      id: "enemy",
      position: { x: 8, y: 7 },
      hp: { current: 100, max: 100 },
    })
    you.inventory = [healItem("health-potion")]
    const obs = buildArenaObservation({
      you,
      entities: [you, closeHostile],
      legal_actions: [
        { type: "use_item", item_id: "inv-health-potion" },
        { type: "wait" },
      ],
    })
    const rec = module.analyze(obs, ctx)
    expect(rec.confidence).toBe(0)
    expect(rec.suggestedAction).toBeUndefined()
  })

  it("returns confidence 0 when the only legal use_item is not a heal", () => {
    const you = buildArenaEntity({ id: "you", hp: { current: 20, max: 100 } })
    you.inventory = [
      {
        id: "inv-non-heal",
        template_id: "buff-potion",
        name: "buff-potion",
        quantity: 1,
        modifiers: {},
        owner_type: "character",
        owner_id: "char-you",
      },
    ]
    const obs = buildArenaObservation({
      you,
      legal_actions: [{ type: "use_item", item_id: "inv-non-heal" }, { type: "wait" }],
    })
    const rec = module.analyze(obs, ctx)
    expect(rec.confidence).toBe(0)
  })

  it("honors a custom emergencyHpPercent threshold", () => {
    const tight = new ArenaSelfCareModule({ emergencyHpPercent: 0.5 })
    const you = buildArenaEntity({ id: "you", hp: { current: 45, max: 100 } })
    const adjacentHostile = buildArenaEntity({
      id: "enemy",
      position: { x: 8, y: 7 },
    })
    you.inventory = [healItem("health-potion")]
    const obs = buildArenaObservation({
      you,
      entities: [you, adjacentHostile],
      legal_actions: [
        { type: "use_item", item_id: "inv-health-potion" },
        { type: "wait" },
      ],
    })
    const rec = tight.analyze(obs, ctx)
    // 45% < 50% → emergency under the raised threshold, even with adjacent hostile.
    expect(rec.confidence).toBeGreaterThanOrEqual(0.9)
  })
})
