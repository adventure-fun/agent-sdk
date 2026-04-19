import { describe, expect, it } from "bun:test"
import {
  KeyHunterModule,
  __peekKeyHunterStateForTests,
  __resetKeyHunterForTests,
} from "../src/modules/key-hunter.js"
import { createAgentContext, type AgentContext } from "../../../src/modules/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  buildObservation,
  enemy,
  moveAction,
} from "../../../tests/helpers/mock-observation.js"
import type { InventorySlot, Tile } from "../../../src/protocol.js"

const cfg = createDefaultConfig({
  llm: { provider: "openrouter", apiKey: "test" },
  wallet: { type: "env" },
})

function floorRow(y: number, xs: number[]): Tile[] {
  return xs.map((x) => ({ x, y, type: "floor" as const, entities: [] }))
}

function keyItem(templateId = "crypt-key", name = "Crypt Key"): InventorySlot {
  return {
    item_id: "inv-key-1",
    template_id: templateId,
    name,
    quantity: 1,
    modifiers: {},
  }
}

describe("KeyHunterModule", () => {
  const module = new KeyHunterModule()

  it("has the correct name and priority", () => {
    expect(module.name).toBe("key-hunter")
    expect(module.priority).toBe(65)
  })

  it("stays quiet when inventory has no key-like items", () => {
    const obs = buildObservation({
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when enemies are visible", () => {
    const obs = buildObservation({
      inventory: [keyItem()],
      visible_entities: [enemy("e1")],
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when a remembered blocked door matches the held key", () => {
    const ctx = createAgentContext(cfg)
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
          isBlocked: true,
        },
      ],
    ])
    const obs = buildObservation({
      inventory: [keyItem()],
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain("KeyDoorModule")
  })

  it("routes toward a frontier tile when holding a key with no matching remembered door", () => {
    const ctx = createAgentContext(cfg)
    // 5-tile corridor. Tile at (5,3) is the east edge; neighbor (6,3) is unknown → frontier.
    const obs = buildObservation({
      position: { floor: 1, room_id: "sc-side-vault", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      inventory: [keyItem()],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction).toBeDefined()
    const action = result.suggestedAction!
    expect(action.type).toBe("move")
    if (action.type === "move") {
      // Either direction leads toward a frontier (1,3) or (5,3); we just care it's a move.
      expect(["left", "right"]).toContain(action.direction)
    }
    expect(result.confidence).toBeGreaterThanOrEqual(0.85)
    expect(result.reasoning.toLowerCase()).toContain("key")
  })

  it("idles gracefully when no frontier tile is reachable", () => {
    const ctx = createAgentContext(cfg)
    // Only the current tile is known; no neighbors → no frontier to route toward because
    // bfsDistance only considers known-or-target neighbors and we have nothing to target.
    const obs = buildObservation({
      position: { floor: 1, room_id: "closet", tile: { x: 3, y: 3 } },
      visible_tiles: [{ x: 3, y: 3, type: "floor", entities: [] }],
      inventory: [keyItem()],
      legal_actions: [],
    })
    const result = module.analyze(obs, ctx)
    expect(result.confidence).toBe(0)
  })

  it("stays quiet when the realm is cleared", () => {
    const obs = buildObservation({
      inventory: [keyItem()],
      realm_info: { status: "realm_cleared" },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      legal_actions: [moveAction("right")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBe(0)
  })

  it("commits to a frontier target and holds it for multiple turns instead of flipping each tick", () => {
    // Regression: realm-low/mid bots ping-ponged between east and west every turn because each
    // turn's "nearest frontier" flipped as new tiles became known. The module must commit to a
    // target and stick with it.
    const ctx = createAgentContext(cfg)
    __resetKeyHunterForTests(ctx)
    // Long corridor with frontiers at both ends; agent starts at x=5.
    const corridor = floorRow(3, [1, 2, 3, 4, 5, 6, 7, 8, 9])
    const obs1 = buildObservation({
      position: { floor: 1, room_id: "corridor", tile: { x: 5, y: 3 } },
      visible_tiles: corridor,
      inventory: [keyItem("mine-key", "Mine Key")],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    ctx.turn = 1
    const r1 = module.analyze(obs1, ctx)
    expect(r1.suggestedAction?.type).toBe("move")
    const firstTarget = __peekKeyHunterStateForTests(ctx)?.target
    expect(firstTarget).not.toBeNull()

    // Turn 2: same observation, but we must still aim at the same target (no flapping).
    ctx.turn = 2
    const r2 = module.analyze(obs1, ctx)
    expect(r2.suggestedAction?.type).toBe("move")
    const secondTarget = __peekKeyHunterStateForTests(ctx)?.target
    expect(secondTarget).not.toBeNull()
    expect(secondTarget?.x).toBe(firstTarget!.x)
    expect(secondTarget?.y).toBe(firstTarget!.y)
  })

  it("breaks ties east-first so equal-distance frontiers don't flip-flop", () => {
    const ctx = createAgentContext(cfg)
    __resetKeyHunterForTests(ctx)
    // Agent at center of a symmetric east/west corridor — frontiers at (1,3) and (7,3) are
    // equidistant. East-first rule should always route right.
    const obs = buildObservation({
      position: { floor: 1, room_id: "corridor", tile: { x: 4, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5, 6, 7]),
      inventory: [keyItem("mine-key", "Mine Key")],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    ctx.turn = 1
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction?.type).toBe("move")
    if (result.suggestedAction?.type === "move") {
      expect(result.suggestedAction.direction).toBe("right")
    }
  })

  it("yields to anti-loop exploration when it detects its own A↔B ping-pong", () => {
    const ctx = createAgentContext(cfg)
    __resetKeyHunterForTests(ctx)
    const corridor = floorRow(3, [1, 2, 3, 4, 5, 6, 7])
    const baseObs = buildObservation({
      visible_tiles: corridor,
      inventory: [keyItem("mine-key", "Mine Key")],
      legal_actions: [moveAction("right"), moveAction("left")],
    })

    // Simulate the observed failure: agent has been hopping between (3,3) and (4,3) for 4
    // turns. We feed that history directly by calling analyze at the alternating tiles.
    const seq = [
      { turn: 1, tile: { x: 3, y: 3 } },
      { turn: 2, tile: { x: 4, y: 3 } },
      { turn: 3, tile: { x: 3, y: 3 } },
      { turn: 4, tile: { x: 4, y: 3 } },
    ]
    let lastResult = module.analyze(baseObs, ctx)
    for (const step of seq) {
      ctx.turn = step.turn
      lastResult = module.analyze(
        { ...baseObs, position: { floor: 1, room_id: "corridor", tile: step.tile } },
        ctx,
      )
    }
    // The fourth alternation should trip the ping-pong guard → confidence 0, so anti-loop
    // module (priority 42, confidence 0.78) wins.
    expect(lastResult.confidence).toBe(0)
    expect(lastResult.reasoning.toLowerCase()).toContain("ping-pong")
  })

  it("stays silent for several turns after detecting a ping-pong so anti-loop can commit", () => {
    const ctx = createAgentContext(cfg)
    __resetKeyHunterForTests(ctx)
    const corridor = floorRow(3, [1, 2, 3, 4, 5, 6, 7])
    const obs = buildObservation({
      visible_tiles: corridor,
      inventory: [keyItem("mine-key", "Mine Key")],
      legal_actions: [moveAction("right"), moveAction("left")],
    })

    // Force the A↔B history.
    for (const step of [
      { turn: 1, tile: { x: 3, y: 3 } },
      { turn: 2, tile: { x: 4, y: 3 } },
      { turn: 3, tile: { x: 3, y: 3 } },
      { turn: 4, tile: { x: 4, y: 3 } },
    ]) {
      ctx.turn = step.turn
      module.analyze(
        { ...obs, position: { floor: 1, room_id: "corridor", tile: step.tile } },
        ctx,
      )
    }
    const silentUntil = __peekKeyHunterStateForTests(ctx)?.silentUntilTurn ?? 0
    expect(silentUntil).toBeGreaterThan(4)

    // Any turn before silentUntil should still be silent, even if the position suddenly
    // lines up as a normal frontier again.
    ctx.turn = silentUntil - 1
    const idleResult = module.analyze(
      { ...obs, position: { floor: 1, room_id: "corridor", tile: { x: 5, y: 3 } } },
      ctx,
    )
    expect(idleResult.confidence).toBe(0)
    expect(idleResult.reasoning).toContain("anti-loop")
  })

  it("avoids immediately reversing the previous successful move when a non-reversing frontier exists", () => {
    const ctx: AgentContext = createAgentContext(cfg)
    __resetKeyHunterForTests(ctx)
    // Previous move was "right"; reversal would be "left".
    ctx.previousActions.push({
      turn: 0,
      action: { type: "move", direction: "right" },
      reasoning: "prev turn",
    })
    // Corridor + a branch south so both "left" and "down" frontiers exist — the module should
    // NOT pick "left" (a reversal) when "down" is available at comparable cost.
    const tiles: Tile[] = [
      ...floorRow(3, [1, 2, 3, 4, 5]),
      { x: 3, y: 4, type: "floor", entities: [] },
      { x: 3, y: 5, type: "floor", entities: [] },
    ]
    const obs = buildObservation({
      position: { floor: 1, room_id: "junction", tile: { x: 3, y: 3 } },
      visible_tiles: tiles,
      inventory: [keyItem("mine-key", "Mine Key")],
      legal_actions: [
        moveAction("right"),
        moveAction("left"),
        moveAction("down"),
        moveAction("up"),
      ],
    })
    ctx.turn = 1
    const result = module.analyze(obs, ctx)
    expect(result.suggestedAction?.type).toBe("move")
    if (result.suggestedAction?.type === "move") {
      // Must not immediately reverse.
      expect(result.suggestedAction.direction).not.toBe("left")
    }
  })

  it("releases its committed target and repicks when the realm template changes", () => {
    const ctx = createAgentContext(cfg)
    __resetKeyHunterForTests(ctx)
    const obsRealmA = buildObservation({
      position: { floor: 1, room_id: "a", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      inventory: [keyItem("a-key", "A Key")],
      legal_actions: [moveAction("right"), moveAction("left")],
      realm_info: { template_id: "realm-a" },
    })
    ctx.turn = 1
    module.analyze(obsRealmA, ctx)
    const committed = __peekKeyHunterStateForTests(ctx)?.target
    expect(committed).not.toBeNull()

    const obsRealmB = buildObservation({
      position: { floor: 1, room_id: "b", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      inventory: [keyItem("b-key", "B Key")],
      legal_actions: [moveAction("right"), moveAction("left")],
      realm_info: { template_id: "realm-b" },
    })
    ctx.turn = 2
    module.analyze(obsRealmB, ctx)
    const afterSwap = __peekKeyHunterStateForTests(ctx)?.target
    expect(afterSwap).not.toBeNull()
    // Same target coords are fine (small map), but the commitment must be "fresh" for the
    // new realm — i.e. committedTurn must have been updated on this turn.
    expect(afterSwap?.committedTurn).toBe(2)
  })

  it("activates on a key detected by template_id suffix even when name doesn't match", () => {
    const obs = buildObservation({
      position: { floor: 1, room_id: "room-1", tile: { x: 3, y: 3 } },
      visible_tiles: floorRow(3, [1, 2, 3, 4, 5]),
      inventory: [
        {
          item_id: "inv-999",
          template_id: "sigil-of-binding-key",
          name: "Sigil of Binding",
          quantity: 1,
          modifiers: {},
        },
      ],
      legal_actions: [moveAction("right"), moveAction("left")],
    })
    const result = module.analyze(obs, createAgentContext(cfg))
    expect(result.confidence).toBeGreaterThanOrEqual(0.85)
  })
})
