import { describe, expect, it } from "bun:test"
import {
  INITIAL_STATE,
  nextHybridState,
  resolveHub,
  type HybridState,
  type ReducerContext,
} from "../src/state-machine.js"

const ALWAYS_ARENA: ReducerContext = {
  arenaEntryPolicy: ({ gold }) =>
    gold >= 150
      ? { enter: true, bracket: "rookie", reason: `queueing rookie gold=${gold}` }
      : { enter: false, bracket: "rookie", reason: `gold=${gold} below threshold` },
}

const NEVER_ARENA: ReducerContext = {
  arenaEntryPolicy: () => ({
    enter: false,
    bracket: "rookie",
    reason: "never-arena policy",
  }),
}

describe("nextHybridState — canonical happy path", () => {
  it("HUB_IDLE + START → RUN_DUNGEON", () => {
    const next = nextHybridState(INITIAL_STATE, { type: "START" }, ALWAYS_ARENA)
    expect(next).toEqual({ kind: "RUN_DUNGEON", attempt: 1 })
  })

  it("RUN_DUNGEON + DUNGEON_DONE → HUB_POST_DUNGEON", () => {
    const s1: HybridState = { kind: "RUN_DUNGEON", attempt: 1 }
    const next = nextHybridState(
      s1,
      { type: "DUNGEON_DONE", outcome: "extracted", gold: 42, level: 3 },
      ALWAYS_ARENA,
    )
    expect(next).toEqual({
      kind: "HUB_POST_DUNGEON",
      outcome: "extracted",
      gold: 42,
      level: 3,
    })
  })
})

describe("HUB_POST_DUNGEON resolution — death always returns to dungeon", () => {
  it("death goes straight back to RUN_DUNGEON regardless of gold", () => {
    const s: HybridState = {
      kind: "HUB_POST_DUNGEON",
      outcome: "death",
      gold: 9999, // plenty of gold but we died, so no arena.
      level: 5,
    }
    const next = resolveHub(s, ALWAYS_ARENA)
    expect(next).toEqual({ kind: "RUN_DUNGEON", attempt: 1 })
  })

  it("stopped extraction uses the same path as a clean extraction", () => {
    const s: HybridState = {
      kind: "HUB_POST_DUNGEON",
      outcome: "stopped",
      gold: 50,
      level: 2,
    }
    const next = resolveHub(s, ALWAYS_ARENA)
    expect(next).toEqual({ kind: "RUN_DUNGEON", attempt: 1 })
  })
})

describe("HUB_POST_DUNGEON resolution — extraction gold gate", () => {
  it("gold below threshold → next dungeon", () => {
    const s: HybridState = {
      kind: "HUB_POST_DUNGEON",
      outcome: "extracted",
      gold: 149,
      level: 3,
    }
    const next = resolveHub(s, ALWAYS_ARENA)
    expect(next).toEqual({ kind: "RUN_DUNGEON", attempt: 1 })
  })

  it("gold above threshold → queue arena with policy bracket", () => {
    const s: HybridState = {
      kind: "HUB_POST_DUNGEON",
      outcome: "extracted",
      gold: 250,
      level: 3,
    }
    const next = resolveHub(s, ALWAYS_ARENA)
    expect(next.kind).toBe("QUEUE_ARENA")
    if (next.kind === "QUEUE_ARENA") {
      expect(next.bracket).toBe("rookie")
      expect(next.reason).toContain("gold=250")
    }
  })

  it("policy veto (cooldown / gold) → next dungeon even when extracted with gold", () => {
    const s: HybridState = {
      kind: "HUB_POST_DUNGEON",
      outcome: "extracted",
      gold: 9999,
      level: 3,
    }
    const next = resolveHub(s, NEVER_ARENA)
    expect(next).toEqual({ kind: "RUN_DUNGEON", attempt: 1 })
  })
})

describe("QUEUE_ARENA transitions", () => {
  it("QUEUE_ARENA + ARENA_MATCHED → IN_ARENA", () => {
    const s: HybridState = {
      kind: "QUEUE_ARENA",
      bracket: "veteran",
      reason: "queueing veteran",
    }
    const next = nextHybridState(
      s,
      { type: "ARENA_MATCHED", matchId: "m-99", bracket: "veteran" },
      ALWAYS_ARENA,
    )
    expect(next).toEqual({ kind: "IN_ARENA", matchId: "m-99", bracket: "veteran" })
  })

  it("QUEUE_ARENA + ARENA_TIMEOUT → HUB_POST_ARENA(null placement)", () => {
    const s: HybridState = {
      kind: "QUEUE_ARENA",
      bracket: "rookie",
      reason: "queueing rookie",
    }
    const next = nextHybridState(
      s,
      { type: "ARENA_TIMEOUT", bracket: "rookie" },
      ALWAYS_ARENA,
    )
    expect(next).toEqual({
      kind: "HUB_POST_ARENA",
      bracket: "rookie",
      placement: null,
      goldAwarded: 0,
    })
  })

  it("QUEUE_ARENA ignores unrelated events (stays queued)", () => {
    const s: HybridState = {
      kind: "QUEUE_ARENA",
      bracket: "rookie",
      reason: "queueing rookie",
    }
    expect(
      nextHybridState(
        s,
        { type: "DUNGEON_DONE", outcome: "extracted", gold: 0, level: 1 },
        ALWAYS_ARENA,
      ),
    ).toEqual(s)
  })
})

describe("IN_ARENA transitions", () => {
  it("IN_ARENA + ARENA_ENDED(placement=1) → HUB_POST_ARENA (win)", () => {
    const s: HybridState = {
      kind: "IN_ARENA",
      matchId: "m-win",
      bracket: "veteran",
    }
    const next = nextHybridState(
      s,
      { type: "ARENA_ENDED", placement: 1, goldAwarded: 200 },
      ALWAYS_ARENA,
    )
    expect(next).toEqual({
      kind: "HUB_POST_ARENA",
      bracket: "veteran",
      placement: 1,
      goldAwarded: 200,
    })
  })

  it("IN_ARENA + ARENA_ENDED(placement=4) → HUB_POST_ARENA (elimination)", () => {
    const s: HybridState = {
      kind: "IN_ARENA",
      matchId: "m-loss",
      bracket: "rookie",
    }
    const next = nextHybridState(
      s,
      { type: "ARENA_ENDED", placement: 4, goldAwarded: 0 },
      ALWAYS_ARENA,
    )
    expect(next).toEqual({
      kind: "HUB_POST_ARENA",
      bracket: "rookie",
      placement: 4,
      goldAwarded: 0,
    })
  })
})

describe("HUB_POST_ARENA resolution", () => {
  it("always returns to RUN_DUNGEON", () => {
    const s: HybridState = {
      kind: "HUB_POST_ARENA",
      bracket: "veteran",
      placement: 1,
      goldAwarded: 200,
    }
    const next = resolveHub(s, ALWAYS_ARENA)
    expect(next).toEqual({ kind: "RUN_DUNGEON", attempt: 1 })
  })

  it("eliminated (placement=4) also returns to RUN_DUNGEON", () => {
    const s: HybridState = {
      kind: "HUB_POST_ARENA",
      bracket: "rookie",
      placement: 4,
      goldAwarded: 0,
    }
    const next = resolveHub(s, ALWAYS_ARENA)
    expect(next).toEqual({ kind: "RUN_DUNGEON", attempt: 1 })
  })
})

describe("STOP semantics", () => {
  it("STOP from any state transitions to STOPPED", () => {
    const cases: HybridState[] = [
      { kind: "HUB_IDLE" },
      { kind: "RUN_DUNGEON", attempt: 3 },
      { kind: "QUEUE_ARENA", bracket: "rookie", reason: "" },
      { kind: "IN_ARENA", matchId: "m", bracket: "veteran" },
      {
        kind: "HUB_POST_ARENA",
        bracket: "veteran",
        placement: 1,
        goldAwarded: 200,
      },
    ]
    for (const s of cases) {
      const next = nextHybridState(s, { type: "STOP", reason: "sigterm" }, ALWAYS_ARENA)
      expect(next).toEqual({ kind: "STOPPED", reason: "sigterm" })
    }
  })

  it("STOPPED is terminal — no event advances it", () => {
    const s: HybridState = { kind: "STOPPED", reason: "done" }
    expect(
      nextHybridState(s, { type: "START" }, ALWAYS_ARENA),
    ).toEqual(s)
    expect(
      nextHybridState(s, { type: "DUNGEON_DONE", outcome: "extracted", gold: 9999, level: 3 }, ALWAYS_ARENA),
    ).toEqual(s)
  })
})

describe("end-to-end transition chain", () => {
  it("dungeon → hub → arena → hub → dungeon", () => {
    let state: HybridState = INITIAL_STATE
    // START
    state = nextHybridState(state, { type: "START" }, ALWAYS_ARENA)
    expect(state.kind).toBe("RUN_DUNGEON")

    // extract with gold
    state = nextHybridState(
      state,
      { type: "DUNGEON_DONE", outcome: "extracted", gold: 500, level: 4 },
      ALWAYS_ARENA,
    )
    expect(state.kind).toBe("HUB_POST_DUNGEON")
    state = resolveHub(state, ALWAYS_ARENA)
    expect(state.kind).toBe("QUEUE_ARENA")

    // matched
    state = nextHybridState(
      state,
      { type: "ARENA_MATCHED", matchId: "m-1", bracket: "rookie" },
      ALWAYS_ARENA,
    )
    expect(state.kind).toBe("IN_ARENA")

    // ended (loss)
    state = nextHybridState(
      state,
      { type: "ARENA_ENDED", placement: 3, goldAwarded: 0 },
      ALWAYS_ARENA,
    )
    state = resolveHub(state, ALWAYS_ARENA)
    expect(state).toEqual({ kind: "RUN_DUNGEON", attempt: 1 })
  })
})
