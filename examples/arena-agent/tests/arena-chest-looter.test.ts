import { describe, expect, it } from "bun:test"
import { ArenaChestLooterModule } from "../src/modules/arena-chest-looter.js"
import { createArenaAgentContext } from "../src/modules/base.js"
import {
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
  buildEmptyArenaGrid,
  moveAction,
} from "./helpers/arena-fixture.js"
import type { TileType } from "../../../src/index.js"

function placeChest(
  grid: TileType[][],
  position: { x: number; y: number },
): TileType[][] {
  const next = grid.map((row) => [...row])
  const row = next[position.y]
  if (!row) return next
  // Arena chests live on floor tiles; the chest's presence is represented
  // only via death drops or entity-less interactables in the engine today —
  // but the spec is "chest positions" from the map, not a grid glyph. The
  // module's inputs therefore accept an explicit chest positions override
  // via `context`; we seed it on the fixture by exposing `death_drops`
  // (the closest observation-level analogue) OR by treating certain tile
  // coordinates as chest tiles via the module's `chestPositions` option.
  return next
}

describe("ArenaChestLooterModule", () => {
  const mod = new ArenaChestLooterModule()

  it("defers when no chest positions are on the map and no drops are present", () => {
    const obs = buildArenaObservation()
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toBeUndefined()
  })

  it("in round <= 5 with the nearest chest unguarded, moves toward it", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const obs = buildArenaObservation({
      you,
      entities: [you],
      round: 3,
      chest_positions: [{ x: 8, y: 5 }],
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

  it("skips chests with an adjacent opponent", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const opponent = buildArenaEntity({
      id: "opp",
      position: { x: 9, y: 5 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, opponent],
      round: 3,
      chest_positions: [{ x: 8, y: 5 }],
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
        moveAction("right"),
      ],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toBeUndefined()
  })

  it("in round > 5 only pursues a chest when no hostile is within 3 tiles", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const threat = buildArenaEntity({
      id: "threat",
      position: { x: 7, y: 5 },
    })
    const withThreat = buildArenaObservation({
      you,
      entities: [you, threat],
      round: 8,
      chest_positions: [{ x: 10, y: 5 }],
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
        moveAction("right"),
      ],
    })
    expect(mod.analyze(withThreat, createArenaAgentContext()).suggestedAction).toBeUndefined()

    const safeThreat = buildArenaEntity({
      id: "threat",
      position: { x: 1, y: 1 },
    })
    const safeObs = buildArenaObservation({
      you,
      entities: [you, safeThreat],
      round: 8,
      chest_positions: [{ x: 10, y: 5 }],
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
        moveAction("right"),
      ],
    })
    const recSafe = mod.analyze(safeObs, createArenaAgentContext())
    expect(recSafe.suggestedAction?.type).toBe("move")
  })

  it("recommends interact (not move) when a loot pile is within Chebyshev <= 1 of the actor", () => {
    // The engine emits a single `interact` row per eligible pile; the
    // module just forwards it. Actor position doesn't need to be the
    // exact tile — bump-to-interact handles same-tile + 8 neighbours.
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const obs = buildArenaObservation({
      you,
      entities: [you],
      round: 3,
      chest_positions: [{ x: 5, y: 5 }],
      death_drops: [
        {
          position: { x: 6, y: 5 },
          items: [],
          gold: 0,
          source_player: "chest-0",
          turn_dropped: 0,
        },
      ],
      legal_actions: [
        moveAction("up"),
        moveAction("down"),
        moveAction("left"),
        moveAction("right"),
        { type: "interact", target_id: "chest-0" },
      ],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction?.type).toBe("interact")
    if (rec.suggestedAction?.type === "interact") {
      expect(rec.suggestedAction.target_id).toBe("chest-0")
    }
    expect(rec.confidence).toBeGreaterThan(0.5)
  })

  it("does not interfere when the only legal action is to attack", () => {
    const you = buildArenaEntity({ id: "you", position: { x: 5, y: 5 } })
    const obs = buildArenaObservation({
      you,
      entities: [you],
      round: 3,
      chest_positions: [{ x: 8, y: 5 }],
      legal_actions: [attackAction("rat"), { type: "wait" }],
    })
    const rec = mod.analyze(obs, createArenaAgentContext())
    expect(rec.suggestedAction).toBeUndefined()
  })

  // Suppressed reference to placeChest helper — retained for potential future
  // grid-based chest markers and kept here so lint doesn't prune the import
  // while staying out of the happy path.
  void placeChest(buildEmptyArenaGrid(3), { x: 0, y: 0 })
})
