import { describe, expect, it } from "bun:test"
import {
  InteractableRouterModule,
  __markInteractedForTests,
  __resetInteractableRouterForTests,
} from "../src/modules/interactable-router.js"
import { createAgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  enemy,
  moveAction,
} from "../../../tests/helpers/mock-observation.js"
import type { Action, Entity, GameEvent, Tile } from "../../../src/protocol.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function floorRow(y: number, xs: number[]): Tile[] {
  return xs.map((x) => ({ x, y, type: "floor" as const, entities: [] }))
}

function interactable(
  id: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    type: "interactable",
    name: overrides.name ?? "Chest",
    position: overrides.position ?? { x: 5, y: 3 },
    ...overrides,
  }
}

function interactAction(targetId: string): Action {
  return { type: "interact", target_id: targetId }
}

describe("InteractableRouterModule", () => {
  const module = new InteractableRouterModule()

  it("has the correct name and priority", () => {
    expect(module.name).toBe("interactable-router")
    expect(module.priority).toBe(86)
  })

  it("emits interact when a chest is adjacent and interact is legal", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [interactable("chest-1", { position: { x: 3, y: 3 } })],
      legal_actions: [interactAction("chest-1")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "interact", target_id: "chest-1" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("routes toward a distant chest via BFS step when not interactable", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [interactable("chest-1", { position: { x: 5, y: 3 } })],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.suggestedAction).toEqual({ type: "move", direction: "right" })
    expect(result.reasoning).toContain("Chest")
    expect(result.confidence).toBeGreaterThanOrEqual(0.85)
  })

  it("ignores locked exits (KeyDoorModule owns those)", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [
        interactable("door-1", { name: "Locked Gate", is_locked_exit: true, position: { x: 5, y: 3 } }),
      ],
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("skips chests already interacted this template", () => {
    const ctx = createAgentContext(cfg)
    __resetInteractableRouterForTests(ctx)
    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [interactable("chest-1", { position: { x: 5, y: 3 } })],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    module.analyze(obs, ctx)
    __markInteractedForTests(ctx, "chest-1")

    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when enemies are visible", () => {
    const obs = buildObservation({
      visible_entities: [
        enemy("e1"),
        interactable("chest-1", { position: { x: 3, y: 3 } }),
      ],
      legal_actions: [interactAction("chest-1")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when the realm is cleared", () => {
    const obs = buildObservation({
      realm_info: { status: "realm_cleared" },
      visible_entities: [interactable("chest-1", { position: { x: 3, y: 3 } })],
      legal_actions: [interactAction("chest-1")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  // --- New behavior: persistent interactable memory across turns ---

  it("remembers interactables seen earlier and routes back when they leave view", () => {
    const ctx = createAgentContext(cfg)
    __resetInteractableRouterForTests(ctx)

    // Turn 1: in side-vault, sarcophagus visible to the west at (1,3).
    const turn1 = buildObservation({
      turn: 1,
      position: { floor: 1, room_id: "sc-side-vault", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [
        interactable("sc-sarcophagus", {
          name: "Sarcophagus",
          position: { x: 1, y: 3 },
        }),
      ],
      legal_actions: [moveAction("left"), moveAction("right"), moveAction("up"), moveAction("down")],
    })
    // First analyze populates the persistent memory AND routes toward the sarcophagus
    // (confidence ≥ 0.85 beats east-bias exploration).
    const firstResult = module.analyze(turn1, ctx)
    expect(firstResult.suggestedAction).toEqual({ type: "move", direction: "left" })

    // Turn 4: agent has moved east into a new room; the sarcophagus is no longer visible.
    // The module must still route BACK via remembered state.
    const turn4 = buildObservation({
      turn: 4,
      position: { floor: 1, room_id: "sc-side-vault", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [],
      legal_actions: [moveAction("left"), moveAction("right")],
    })
    const result = module.analyze(turn4, ctx)
    expect(result.suggestedAction).toEqual({ type: "move", direction: "left" })
    expect(result.reasoning).toContain("Sarcophagus")
    expect(result.reasoning).toContain("remembered")
  })

  it("escalates confidence when a locked door is blocking and no key is held", () => {
    const ctx = createAgentContext(cfg)
    __resetInteractableRouterForTests(ctx)

    // Seed a blocked door in mapMemory.
    ctx.mapMemory.encounteredDoors = new Map([
      [
        "sc-iron-gate",
        {
          targetId: "sc-iron-gate",
          floor: 1,
          roomId: "sc-offering-room",
          x: 7,
          y: 3,
          requiredKeyTemplateId: "crypt-key",
          interactedTurns: [],
          firstSeenTurn: 5,
          lastBlockedDetail: "locked",
          isBlocked: true,
        },
      ],
    ])

    const obs = buildObservation({
      turn: 10,
      position: { floor: 1, room_id: "sc-side-vault", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [
        interactable("sc-sarcophagus", {
          name: "Sarcophagus",
          position: { x: 5, y: 3 },
        }),
      ],
      inventory: [],
      legal_actions: [moveAction("right"), moveAction("left")],
    })

    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "move", direction: "right" })
    // Escalated confidence should be ≥ 0.95 so it reliably beats exploration and LLM replans.
    expect(result.confidence).toBeGreaterThanOrEqual(0.95)
    expect(result.reasoning).toContain("locked door")
  })

  it("escalates confidence on a fresh interact_blocked event even before encounteredDoors populates", () => {
    const ctx = createAgentContext(cfg)
    __resetInteractableRouterForTests(ctx)

    const blockedEvent: GameEvent = {
      turn: 50,
      type: "interact_blocked",
      detail: "The door is locked.",
      data: { target_id: "sc-iron-gate" },
    }

    const obs = buildObservation({
      turn: 50,
      position: { floor: 1, room_id: "sc-offering-room", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [
        interactable("sc-lever", {
          name: "Iron Lever",
          position: { x: 3, y: 3 },
        }),
      ],
      recent_events: [blockedEvent],
      legal_actions: [interactAction("sc-lever"), moveAction("left")],
    })

    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "interact", target_id: "sc-lever" })
    expect(result.confidence).toBeGreaterThanOrEqual(0.97)
  })

  it("does NOT escalate when the agent already holds the required key", () => {
    const ctx = createAgentContext(cfg)
    __resetInteractableRouterForTests(ctx)

    ctx.mapMemory.encounteredDoors = new Map([
      [
        "sc-iron-gate",
        {
          targetId: "sc-iron-gate",
          floor: 1,
          roomId: "sc-offering-room",
          x: 7,
          y: 3,
          requiredKeyTemplateId: "crypt-key",
          interactedTurns: [],
          firstSeenTurn: 5,
          lastBlockedDetail: "locked",
          isBlocked: true,
        },
      ],
    ])

    const obs = buildObservation({
      turn: 10,
      position: { floor: 1, room_id: "sc-side-vault", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      visible_entities: [
        interactable("sc-chest", { name: "Chest", position: { x: 5, y: 3 } }),
      ],
      inventory: [
        {
          item_id: "inv-1",
          template_id: "crypt-key",
          name: "Crypt Key",
          quantity: 1,
          modifiers: {},
        },
      ],
      legal_actions: [moveAction("right")],
    })

    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toEqual({ type: "move", direction: "right" })
    // Regular (non-escalated) confidence — 0.9 for visible routing.
    expect(result.confidence).toBeLessThan(0.95)
  })
})
