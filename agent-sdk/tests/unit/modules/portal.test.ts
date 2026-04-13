import { describe, expect, it } from "bun:test"
import { PortalModule } from "../../../src/modules/portal.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  item,
  portalAction,
  pickupAction,
  retreatAction,
  moveAction,
} from "../../helpers/mock-observation.js"

const config = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function ctx() {
  return createAgentContext(config)
}

describe("PortalModule", () => {
  const module = new PortalModule()

  it("has correct name and priority", () => {
    expect(module.name).toBe("portal")
    expect(module.priority).toBe(90)
  })

  it("recommends portal when HP is above the strict threshold but a two-room loop ban is active", () => {
    const c = createAgentContext(config)
    c.mapMemory.loopEdgeBans = { "stuck-room": "right" }
    const obs = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 2,
        current_floor: 2,
        status: "active",
      },
      position: { floor: 2, room_id: "stuck-room", tile: { x: 1, y: 1 } },
      character: { hp: { current: 8, max: 33 } },
      legal_actions: [portalAction(), moveAction("up")],
    })
    const result = module.analyze(obs, c)
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("strongly recommends extraction when HP is critically low and portal is legal", () => {
    const obs = buildObservation({
      character: { hp: { current: 5, max: 30 } },
      legal_actions: [portalAction(), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("prefers retreat when HP is critical and both retreat and portal are legal", () => {
    const obs = buildObservation({
      character: { hp: { current: 5, max: 30 } },
      position: { floor: 1, room_id: "room-1", tile: { x: 1, y: 1 } },
      realm_info: { entrance_room_id: "room-1" },
      legal_actions: [retreatAction(), portalAction(), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "retreat" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("uses the configured emergency HP threshold for survival extraction", () => {
    const customContext = createAgentContext(createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test" },
      wallet: { type: "env" },
      decision: {
        emergencyHpPercent: 0.4,
      },
    }))
    const obs = buildObservation({
      character: { hp: { current: 10, max: 30 } },
      legal_actions: [portalAction(), moveAction("up")],
    })

    const result = module.analyze(obs, customContext)
    expect(result.suggestedAction).toEqual({ type: "use_portal" })
  })

  it("defers portal when realm is cleared away from the floor-1 entrance", () => {
    const obs = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 2,
        current_floor: 2,
        status: "boss_cleared",
        entrance_room_id: "entry-room",
      },
      position: { floor: 2, room_id: "boss-room", tile: { x: 1, y: 1 } },
      legal_actions: [portalAction(), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain("entrance")
  })

  it("recommends retreat at the entrance when realm is cleared (before portal)", () => {
    const obs = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 1,
        current_floor: 1,
        status: "realm_cleared",
        entrance_room_id: "room-1",
      },
      position: { floor: 1, room_id: "room-1", tile: { x: 1, y: 1 } },
      legal_actions: [retreatAction(), portalAction()],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "retreat" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("defers portal when realm is cleared with visible-only loot (no pickup / disarm yet legal)", () => {
    const obs = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 1,
        current_floor: 1,
        status: "realm_cleared",
      },
      visible_entities: [item("loot-1", { position: { x: 4, y: 3 } })],
      legal_actions: [portalAction(), moveAction("right")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("does not recommend extraction when pickup remains legal in a cleared room", () => {
    const obs = buildObservation({
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 1,
        current_floor: 1,
        status: "realm_cleared",
      },
      legal_actions: [portalAction(), pickupAction("loot-1")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("recommends retreat when HP is dire and no portal available", () => {
    const obs = buildObservation({
      character: { hp: { current: 3, max: 30 } },
      legal_actions: [retreatAction(), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toEqual({ type: "retreat" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("returns no recommendation when HP is healthy and realm not cleared", () => {
    const obs = buildObservation({
      character: { hp: { current: 28, max: 30 } },
      realm_info: {
        template_name: "test-dungeon",
        floor_count: 2,
        current_floor: 1,
        status: "active",
      },
      legal_actions: [portalAction(), moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })

  it("returns no recommendation when no portal or retreat is legal", () => {
    const obs = buildObservation({
      character: { hp: { current: 3, max: 30 } },
      legal_actions: [moveAction("up")],
    })

    const result = module.analyze(obs, ctx())
    expect(result.suggestedAction).toBeUndefined()
    expect(result.confidence).toBe(0)
  })
})
