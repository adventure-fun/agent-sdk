import { describe, expect, it } from "bun:test"
import { TrapHandlingModule } from "../../../src/modules/trap-handling.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  trap,
  disarmAction,
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

describe("TrapHandlingModule", () => {
  const module = new TrapHandlingModule()

  it("has correct name and priority", () => {
    expect(module.name).toBe("trap-handling")
    expect(module.priority).toBe(75)
  })

  it("recommends disarming when trap is visible and disarm is legal", () => {
    const obs = buildObservation({
      visible_entities: [trap("trap-1")],
      inventory: [inventorySlot({ item_id: "kit-1", template_id: "trap-kit", name: "Trap Kit" })],
      legal_actions: [disarmAction("kit-1")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "disarm_trap", item_id: "kit-1" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("recommends alternative movement when trap present but disarm unavailable", () => {
    const obs = buildObservation({
      visible_entities: [trap("trap-1", { position: { x: 4, y: 3 } })],
      legal_actions: [
        moveAction("up"),
        moveAction("left"),
      ],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction?.type).toBe("move")
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it("returns no recommendation when no traps are visible", () => {
    const obs = buildObservation({
      visible_entities: [],
      legal_actions: [moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("detects traps from recent events", () => {
    const obs = buildObservation({
      recent_events: [
        { turn: 1, type: "trap_triggered", detail: "A spike trap snaps!", data: {} },
      ],
      legal_actions: [moveAction("up"), moveAction("down")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.reasoning).toContain("trap")
  })
})
