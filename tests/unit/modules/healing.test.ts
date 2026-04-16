import { describe, expect, it } from "bun:test"
import { HealingModule } from "../../../src/modules/healing.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  healAction,
  moveAction,
  inventorySlot,
} from "../../helpers/mock-observation.js"

const config = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function ctx() {
  return createAgentContext(config)
}

describe("HealingModule", () => {
  const module = new HealingModule()

  it("has correct name and priority", () => {
    expect(module.name).toBe("healing")
    expect(module.priority).toBe(85)
  })

  it("recommends healing when HP below 50% and healing item is available", () => {
    const obs = buildObservation({
      character: { hp: { current: 12, max: 30 } },
      inventory: [
        inventorySlot({ item_id: "potion-1", template_id: "health-potion", name: "Health Potion", modifiers: { heal: 15 } }),
      ],
      legal_actions: [healAction("potion-1"), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "use_item", item_id: "potion-1" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it("has very high confidence at critically low HP", () => {
    const obs = buildObservation({
      character: { hp: { current: 3, max: 30 } },
      inventory: [
        inventorySlot({ item_id: "potion-1", template_id: "health-potion", name: "Health Potion", modifiers: { heal: 15 } }),
      ],
      legal_actions: [healAction("potion-1")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "use_item", item_id: "potion-1" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("returns no recommendation when HP is above threshold", () => {
    const obs = buildObservation({
      character: { hp: { current: 28, max: 30 } },
      inventory: [
        inventorySlot({ item_id: "potion-1", template_id: "health-potion", name: "Health Potion" }),
      ],
      legal_actions: [healAction("potion-1")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("returns no recommendation when no healing items are available", () => {
    const obs = buildObservation({
      character: { hp: { current: 5, max: 30 } },
      inventory: [],
      legal_actions: [moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("flags in context when HP is critical and no healing available", () => {
    const obs = buildObservation({
      character: { hp: { current: 5, max: 30 } },
      inventory: [],
      legal_actions: [moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.context?.["criticalHP"]).toBe(true)
    expect(result.context?.["healingAvailable"]).toBe(false)
  })

  it("scales confidence with HP urgency", () => {
    const makeObs = (currentHp: number) =>
      buildObservation({
        character: { hp: { current: currentHp, max: 30 } },
        inventory: [
          inventorySlot({ item_id: "p", template_id: "health-potion", name: "Health Potion", modifiers: { heal: 15 } }),
        ],
        legal_actions: [healAction("p")],
      })

    const resultAt40 = module.analyze(makeObs(12), ctx())
    const resultAt20 = module.analyze(makeObs(6), ctx())
    const resultAt10 = module.analyze(makeObs(3), ctx())

    expect(resultAt10.confidence).toBeGreaterThan(resultAt20.confidence)
    expect(resultAt20.confidence).toBeGreaterThan(resultAt40.confidence)
  })
})
