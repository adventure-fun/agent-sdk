import { describe, expect, it } from "bun:test"
import type { ArenaBracket } from "../../../src/index.js"
import { readHybridPolicyThresholds } from "../config.js"
import type { ArenaOutcome } from "../src/arena-runner.js"
import type { DungeonOutcome } from "../src/dungeon-runner.js"
import {
  runSupervisorLoop,
  type HybridArenaRunner,
  type HybridDungeonRunner,
} from "../src/supervisor-loop.js"
import { HybridWorldModel } from "../src/world-model/world-model.js"

const THRESHOLDS = readHybridPolicyThresholds()

/**
 * High-level supervisor tests. Each scenario injects scripted dungeon / arena
 * runners so the supervisor's state-machine + policy interplay is exercised
 * without any network I/O.
 */

const CHARACTER_ID = "char-test"

type DungeonScript = Array<Partial<DungeonOutcome> & { outcome: DungeonOutcome["outcome"] }>
type ArenaScript = Array<Partial<ArenaOutcome> & { placement: ArenaOutcome["placement"]; matchId: string }>

function scriptedDungeonRunner(
  script: DungeonScript,
  calls: Array<{ kind: "dungeon" }>,
): HybridDungeonRunner {
  let i = 0
  return async () => {
    calls.push({ kind: "dungeon" })
    const next = script[Math.min(i, script.length - 1)]!
    i += 1
    return {
      outcome: next.outcome,
      goldGained: next.goldGained ?? (next.outcome === "extracted" ? 300 : 0),
      xpGained: next.xpGained ?? 0,
      floor: next.floor ?? 1,
      turn: next.turn ?? 1,
      class: next.class ?? "rogue",
      level: next.level ?? 3,
      goldAfter:
        next.goldAfter ?? (next.outcome === "extracted" ? 300 : 0),
      characterId: next.characterId ?? CHARACTER_ID,
    }
  }
}

function scriptedArenaRunner(
  script: ArenaScript,
  calls: Array<{ kind: "arena"; bracket: ArenaBracket }>,
): HybridArenaRunner {
  let i = 0
  return async ({ bracket }) => {
    calls.push({ kind: "arena", bracket })
    const next = script[Math.min(i, script.length - 1)]!
    i += 1
    const now = Date.now() + i
    return {
      placement: next.placement,
      goldAwarded:
        next.goldAwarded ?? (next.placement === 1 ? 200 : 0),
      bracket: next.bracket ?? bracket,
      matchId: next.matchId,
      endedReason: next.endedReason ?? "last_standing",
      characterId: next.characterId ?? CHARACTER_ID,
      matchedAt: next.matchedAt ?? now,
      endedAt: next.endedAt ?? now + 1,
    }
  }
}

describe("runSupervisorLoop — dungeon-only paths", () => {
  it("death → hub → next dungeon", async () => {
    const world = HybridWorldModel.open(":memory:")
    const calls: Array<{ kind: "dungeon" } | { kind: "arena"; bracket: ArenaBracket }> = []
    const dungeons: DungeonScript = [
      { outcome: "death", goldAfter: 0, level: 3 },
      { outcome: "extracted", goldAfter: 50, level: 3 }, // below arena threshold → dungeon again
    ]
    const result = await runSupervisorLoop({
      world,
      characterId: CHARACTER_ID,
      thresholds: THRESHOLDS,
      runDungeon: scriptedDungeonRunner(dungeons, calls),
      runArena: scriptedArenaRunner([], calls),
      maxLoopIterations: 2,
    })
    expect(result.iterations).toBe(2)
    expect(calls).toEqual([{ kind: "dungeon" }, { kind: "dungeon" }])
    world.close()
  })

  it("extraction with gold < threshold → next dungeon", async () => {
    const world = HybridWorldModel.open(":memory:")
    const calls: Array<{ kind: "dungeon" } | { kind: "arena"; bracket: ArenaBracket }> = []
    const dungeons: DungeonScript = [
      { outcome: "extracted", goldAfter: THRESHOLDS.arenaGoldThreshold - 1, level: 3 },
      { outcome: "extracted", goldAfter: THRESHOLDS.arenaGoldThreshold - 1, level: 3 },
    ]
    const result = await runSupervisorLoop({
      world,
      characterId: CHARACTER_ID,
      thresholds: THRESHOLDS,
      runDungeon: scriptedDungeonRunner(dungeons, calls),
      runArena: scriptedArenaRunner(
        [{ placement: 1, matchId: "should-not-happen" }],
        calls,
      ),
      maxLoopIterations: 2,
    })
    expect(result.iterations).toBe(2)
    expect(calls.every((c) => c.kind === "dungeon")).toBe(true)
    world.close()
  })
})

describe("runSupervisorLoop — arena happy path", () => {
  it("extraction with gold ≥ threshold → queue arena → hub → dungeon", async () => {
    const world = HybridWorldModel.open(":memory:")
    const calls: Array<{ kind: "dungeon" } | { kind: "arena"; bracket: ArenaBracket }> = []
    const dungeons: DungeonScript = [
      { outcome: "extracted", goldAfter: THRESHOLDS.arenaGoldThreshold + 100, level: 3 },
      // after arena we want to run one more dungeon so the test has a deterministic stop.
      { outcome: "extracted", goldAfter: 10, level: 3 },
    ]
    const arenas: ArenaScript = [{ placement: 1, matchId: "m-win" }]
    const result = await runSupervisorLoop({
      world,
      characterId: CHARACTER_ID,
      thresholds: THRESHOLDS,
      runDungeon: scriptedDungeonRunner(dungeons, calls),
      runArena: scriptedArenaRunner(arenas, calls),
      maxLoopIterations: 3,
    })
    expect(result.iterations).toBe(3)
    expect(calls).toEqual([
      { kind: "dungeon" },
      { kind: "arena", bracket: "rookie" }, // level=3 → rookie
      { kind: "dungeon" },
    ])
    // The win was recorded with goldAwarded=200 (default).
    const recent = world.getRecentArenaResults(CHARACTER_ID)
    expect(recent).toHaveLength(1)
    expect(recent[0]!.placement).toBe(1)
    expect(recent[0]!.goldAwarded).toBe(200)
    world.close()
  })

  it("arena elimination → hub → dungeon", async () => {
    const world = HybridWorldModel.open(":memory:")
    const calls: Array<{ kind: "dungeon" } | { kind: "arena"; bracket: ArenaBracket }> = []
    const dungeons: DungeonScript = [
      { outcome: "extracted", goldAfter: THRESHOLDS.arenaGoldThreshold + 50, level: 3 },
      { outcome: "extracted", goldAfter: 10, level: 3 },
    ]
    const arenas: ArenaScript = [{ placement: 4, matchId: "m-loss", goldAwarded: 0 }]
    const result = await runSupervisorLoop({
      world,
      characterId: CHARACTER_ID,
      thresholds: THRESHOLDS,
      runDungeon: scriptedDungeonRunner(dungeons, calls),
      runArena: scriptedArenaRunner(arenas, calls),
      maxLoopIterations: 3,
    })
    expect(result.iterations).toBe(3)
    expect(calls.at(-1)).toEqual({ kind: "dungeon" })
    const recent = world.getRecentArenaResults(CHARACTER_ID)
    expect(recent).toHaveLength(1)
    expect(recent[0]!.placement).toBe(4)
    world.close()
  })
})

describe("runSupervisorLoop — arena cooldown after losing streak", () => {
  it("three arena losses triggers N-dungeon cooldown before re-queue", async () => {
    const world = HybridWorldModel.open(":memory:")
    const calls: Array<{ kind: "dungeon" } | { kind: "arena"; bracket: ArenaBracket }> = []
    // Prime the loss streak — three losses ALREADY on disk so the first dungeon
    // completion should trip the cooldown.
    for (let i = 0; i < THRESHOLDS.arenaCooldownTriggerLosses; i++) {
      world.recordArenaResult({
        characterId: CHARACTER_ID,
        bracket: "rookie",
        matchId: `primed-${i}`,
        placement: 2 + ((i % 3) as 0 | 1 | 2),
        goldAwarded: 0,
        endedReason: "last_standing",
        matchedAt: i * 10,
        endedAt: i * 10 + 1,
      })
    }

    // Script: every dungeon extracts with enough gold to queue (above threshold),
    // but cooldown should prevent queueing until N dungeons have been cleared.
    const dungeons: DungeonScript = Array.from({ length: 8 }, () => ({
      outcome: "extracted" as const,
      goldAfter: THRESHOLDS.arenaGoldThreshold + 50,
      level: 3,
    }))
    // Arena should only be reached on the final iteration after cooldown expires.
    const arenas: ArenaScript = [{ placement: 1, matchId: "m-post-cd" }]

    const result = await runSupervisorLoop({
      world,
      characterId: CHARACTER_ID,
      thresholds: THRESHOLDS,
      runDungeon: scriptedDungeonRunner(dungeons, calls),
      runArena: scriptedArenaRunner(arenas, calls),
      maxLoopIterations: THRESHOLDS.arenaCooldownDungeons + 1,
    })

    // We expect `arenaCooldownDungeons` dungeon iterations while cooling down,
    // then 1 arena iteration once the cooldown expired.
    const dungeonCalls = calls.filter((c) => c.kind === "dungeon")
    const arenaCalls = calls.filter((c) => c.kind === "arena")
    expect(dungeonCalls.length).toBe(THRESHOLDS.arenaCooldownDungeons)
    expect(arenaCalls.length).toBe(1)
    expect(result.iterations).toBe(THRESHOLDS.arenaCooldownDungeons + 1)
    world.close()
  })
})

describe("runSupervisorLoop — bracket downgrade", () => {
  it("three veteran losses force the next queue onto rookie", async () => {
    const world = HybridWorldModel.open(":memory:")
    const calls: Array<{ kind: "dungeon" } | { kind: "arena"; bracket: ArenaBracket }> = []

    // Seed three veteran losses. The trigger for cooldown AND downgrade is both
    // set to 3 by default; to isolate the downgrade path we override thresholds
    // so cooldown is disabled (1_000 dungeons to cool) but downgrade still fires.
    const dgThresholds = {
      ...THRESHOLDS,
      arenaCooldownTriggerLosses: 99, // cooldown disabled
      arenaCooldownDungeons: 0,
      bracketDowngradeLossThreshold: 3,
      bracketDowngradeWindow: 10,
    }
    for (let i = 0; i < 3; i++) {
      world.recordArenaResult({
        characterId: CHARACTER_ID,
        bracket: "veteran",
        matchId: `primed-veteran-${i}`,
        placement: 2 + ((i % 3) as 0 | 1 | 2),
        goldAwarded: 0,
        endedReason: "last_standing",
        matchedAt: i * 10,
        endedAt: i * 10 + 1,
      })
    }

    const dungeons: DungeonScript = [
      // level 7 → veteran bracket base.
      { outcome: "extracted", goldAfter: dgThresholds.arenaGoldThreshold + 50, level: 7 },
      { outcome: "extracted", goldAfter: 10, level: 7 },
    ]
    const arenas: ArenaScript = [{ placement: 1, matchId: "m-downgraded" }]

    const result = await runSupervisorLoop({
      world,
      characterId: CHARACTER_ID,
      thresholds: dgThresholds,
      runDungeon: scriptedDungeonRunner(dungeons, calls),
      runArena: scriptedArenaRunner(arenas, calls),
      maxLoopIterations: 3,
    })

    expect(result.iterations).toBe(3)
    const arenaCalls = calls.filter((c) => c.kind === "arena") as Array<{
      kind: "arena"
      bracket: ArenaBracket
    }>
    expect(arenaCalls).toHaveLength(1)
    expect(arenaCalls[0]!.bracket).toBe("rookie")
    world.close()
  })
})

describe("runSupervisorLoop — arena queue timeout", () => {
  it("queue timeout (no matchId) transitions straight back to RUN_DUNGEON", async () => {
    const world = HybridWorldModel.open(":memory:")
    const calls: Array<{ kind: "dungeon" } | { kind: "arena"; bracket: ArenaBracket }> = []

    const dungeons: DungeonScript = [
      { outcome: "extracted", goldAfter: THRESHOLDS.arenaGoldThreshold + 50, level: 3 },
      { outcome: "extracted", goldAfter: 10, level: 3 },
    ]

    // Arena runner returns a null-matchId timeout outcome.
    const runArena: HybridArenaRunner = async ({ bracket }) => {
      calls.push({ kind: "arena", bracket })
      const now = Date.now()
      return {
        placement: null,
        goldAwarded: 0,
        bracket,
        matchId: null,
        endedReason: "timeout",
        characterId: CHARACTER_ID,
        matchedAt: now,
        endedAt: now + 1,
      }
    }

    const result = await runSupervisorLoop({
      world,
      characterId: CHARACTER_ID,
      thresholds: THRESHOLDS,
      runDungeon: scriptedDungeonRunner(dungeons, calls),
      runArena,
      maxLoopIterations: 3,
    })
    expect(result.iterations).toBe(3)
    expect(calls).toEqual([
      { kind: "dungeon" },
      { kind: "arena", bracket: "rookie" },
      { kind: "dungeon" },
    ])
    // Queue history should have a dropped_at row, NOT an arena_results row.
    expect(world.getRecentArenaResults(CHARACTER_ID)).toHaveLength(0)
    const queueHistory = world.getRecentQueueHistory(CHARACTER_ID)
    expect(queueHistory).toHaveLength(1)
    expect(queueHistory[0]!.droppedAt).not.toBeNull()
    expect(queueHistory[0]!.matchId).toBeNull()
    world.close()
  })
})
