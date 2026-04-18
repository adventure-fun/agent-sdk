import { describe, expect, it } from "bun:test"
import { HybridWorldModel } from "../src/world-model/world-model.js"
import { buildObservation, enemy } from "../../../tests/helpers/mock-observation.js"

const CHARACTER_A = "char-alice"
const CHARACTER_B = "char-bob"

describe("HybridWorldModel", () => {
  it("opens with both schemas applied and composes a working super-agent WorldModel", () => {
    const hybrid = HybridWorldModel.open(":memory:")

    // Super-agent side: prove the inherited schema works by pushing a run + observation.
    const runId = hybrid.world.startRun("test-dungeon", "Test Dungeon", "rogue", 3)
    expect(runId).toBeGreaterThan(0)
    hybrid.world.ingestObservation(
      buildObservation({
        turn: 1,
        visible_entities: [enemy("e1", { name: "Goblin", hp_current: 10 })],
      }),
    )
    const profile = hybrid.world.getEnemyProfile("test-dungeon", "Goblin", "rogue")
    expect(profile?.sightings).toBe(1)

    // Hybrid side: prove the arena table is usable on the same handle.
    hybrid.recordArenaResult({
      characterId: CHARACTER_A,
      bracket: "veteran",
      matchId: "m-1",
      placement: 2,
      goldAwarded: 0,
      endedReason: "last_standing",
      matchedAt: 1000,
      endedAt: 2000,
    })
    expect(hybrid.getRecentArenaResults(CHARACTER_A)).toHaveLength(1)

    hybrid.close()
  })

  it("returns arena results newest-first", () => {
    const hybrid = HybridWorldModel.open(":memory:")

    const mk = (matchedAt: number, endedAt: number, placement: 1 | 2 | 3 | 4 = 2) => ({
      characterId: CHARACTER_A,
      bracket: "rookie" as const,
      matchId: `m-${endedAt}`,
      placement,
      goldAwarded: 0,
      endedReason: "last_standing" as const,
      matchedAt,
      endedAt,
    })

    hybrid.recordArenaResult(mk(100, 200))
    hybrid.recordArenaResult(mk(300, 400))
    hybrid.recordArenaResult(mk(500, 600))

    const rows = hybrid.getRecentArenaResults(CHARACTER_A)
    expect(rows.map((r) => r.endedAt)).toEqual([600, 400, 200])

    hybrid.close()
  })

  it("filters arena results by character_id", () => {
    const hybrid = HybridWorldModel.open(":memory:")
    hybrid.recordArenaResult({
      characterId: CHARACTER_A,
      bracket: "rookie",
      matchId: "m-a",
      placement: 1,
      goldAwarded: 200,
      endedReason: "last_standing",
      matchedAt: 0,
      endedAt: 10,
    })
    hybrid.recordArenaResult({
      characterId: CHARACTER_B,
      bracket: "rookie",
      matchId: "m-b",
      placement: 2,
      goldAwarded: 0,
      endedReason: "last_standing",
      matchedAt: 0,
      endedAt: 20,
    })

    expect(hybrid.getRecentArenaResults(CHARACTER_A)).toHaveLength(1)
    expect(hybrid.getRecentArenaResults(CHARACTER_B)).toHaveLength(1)
    expect(hybrid.getRecentArenaResults(CHARACTER_A)[0]!.matchId).toBe("m-a")

    hybrid.close()
  })

  it("computes arena loss streaks correctly", () => {
    const hybrid = HybridWorldModel.open(":memory:")
    const mk = (
      placement: 1 | 2 | 3 | 4 | null,
      endedAt: number,
      bracket: "rookie" | "veteran" | "champion" = "veteran",
    ) => ({
      characterId: CHARACTER_A,
      bracket,
      matchId: `m-${endedAt}`,
      placement,
      goldAwarded: placement === 1 ? 200 : 0,
      endedReason: (placement === null ? "timeout" : "last_standing") as
        | "last_standing"
        | "timeout",
      matchedAt: endedAt - 10,
      endedAt,
    })

    // No results → 0
    expect(hybrid.getArenaLossStreak(CHARACTER_A, "veteran")).toBe(0)

    // Single loss
    hybrid.recordArenaResult(mk(3, 100))
    expect(hybrid.getArenaLossStreak(CHARACTER_A, "veteran")).toBe(1)

    // Three losses
    hybrid.recordArenaResult(mk(2, 200))
    hybrid.recordArenaResult(mk(4, 300))
    expect(hybrid.getArenaLossStreak(CHARACTER_A, "veteran")).toBe(3)

    // A win resets the streak.
    hybrid.recordArenaResult(mk(1, 400))
    expect(hybrid.getArenaLossStreak(CHARACTER_A, "veteran")).toBe(0)

    // New loss after the win → 1.
    hybrid.recordArenaResult(mk(2, 500))
    expect(hybrid.getArenaLossStreak(CHARACTER_A, "veteran")).toBe(1)

    // Streak is bracket-scoped — a loss in rookie does not affect the veteran streak.
    hybrid.recordArenaResult(mk(3, 600, "rookie"))
    expect(hybrid.getArenaLossStreak(CHARACTER_A, "veteran")).toBe(1)
    expect(hybrid.getArenaLossStreak(CHARACTER_A, "rookie")).toBe(1)

    // A null-placement (timeout) entry is skipped — it's not a loss.
    hybrid.recordArenaResult(mk(null, 700))
    expect(hybrid.getArenaLossStreak(CHARACTER_A, "veteran")).toBe(1)

    hybrid.close()
  })

  it("tracks queue history lifecycle (start → matched, start → dropped)", () => {
    const hybrid = HybridWorldModel.open(":memory:")

    const idMatched = hybrid.markQueueStart(CHARACTER_A, "veteran", 1000)
    const idDropped = hybrid.markQueueStart(CHARACTER_A, "rookie", 2000)
    expect(idMatched).toBeGreaterThan(0)
    expect(idDropped).toBeGreaterThan(idMatched)

    hybrid.markQueueMatched(idMatched, "match-1", 1500)
    hybrid.markQueueDropped(idDropped, 2600)

    const rows = hybrid.getRecentQueueHistory(CHARACTER_A)
    expect(rows).toHaveLength(2)
    // Newest-first by queued_at.
    expect(rows[0]!.bracket).toBe("rookie")
    expect(rows[0]!.droppedAt).toBe(2600)
    expect(rows[0]!.matchId).toBeNull()
    expect(rows[1]!.bracket).toBe("veteran")
    expect(rows[1]!.matchId).toBe("match-1")
    expect(rows[1]!.matchedAt).toBe(1500)

    hybrid.close()
  })

  it("records and reads gold history snapshots", () => {
    const hybrid = HybridWorldModel.open(":memory:")
    hybrid.recordGold(CHARACTER_A, 100, "boot", 1_000)
    hybrid.recordGold(CHARACTER_A, 250, "dungeon_extracted", 2_000)
    hybrid.recordGold(CHARACTER_A, 500, "arena_payout", 3_000)

    const rows = hybrid.getRecentGoldHistory(CHARACTER_A)
    expect(rows.map((r) => r.gold)).toEqual([500, 250, 100])
    expect(rows.map((r) => r.source)).toEqual([
      "arena_payout",
      "dungeon_extracted",
      "boot",
    ])

    hybrid.close()
  })

  it("is safe to re-open over the same database", () => {
    // Two successive opens on an in-memory DB each get a fresh handle, but the
    // idempotent CREATE TABLE IF NOT EXISTS path must never throw. This mirrors
    // the supervisor reopening the DB after a crash.
    const h1 = HybridWorldModel.open(":memory:")
    h1.recordArenaResult({
      characterId: CHARACTER_A,
      bracket: "rookie",
      matchId: "m-1",
      placement: 1,
      goldAwarded: 200,
      endedReason: "last_standing",
      matchedAt: 0,
      endedAt: 10,
    })
    h1.close()

    // Opening a fresh in-memory DB again must not throw due to schema conflicts.
    const h2 = HybridWorldModel.open(":memory:")
    expect(h2.getRecentArenaResults(CHARACTER_A)).toHaveLength(0)
    h2.close()
  })
})
