import type { ArenaBracket } from "../../../src/index.js"

/**
 * Pure state machine for the hybrid supervisor. Every transition is described
 * here as a `(state, event, ctx) -> state` reducer so `supervisor.test.ts` can
 * exhaustively validate the dungeon↔arena loop without spinning up any live
 * backends.
 *
 * Design notes:
 *   - Event payloads are as narrow as possible: only the fields the reducer
 *     actually inspects. Anything else (e.g. full placements array) lives on
 *     the supervisor side.
 *   - The `ArenaEntryPolicy` contract is intentionally a thin protocol so the
 *     reducer can defer bracket selection + cooldown logic to `policy.ts`
 *     without importing the SQLite store.
 */

export type DungeonOutcome = "extracted" | "death" | "stopped"

export interface ArenaEntryPolicy {
  (ctx: { gold: number; level: number }): {
    enter: boolean
    bracket: ArenaBracket
    reason: string
  }
}

// ── State + event unions ─────────────────────────────────────────────────

export type HybridState =
  | { kind: "HUB_IDLE" }
  | { kind: "RUN_DUNGEON"; attempt: number }
  | {
      kind: "HUB_POST_DUNGEON"
      outcome: DungeonOutcome
      gold: number
      level: number
    }
  | { kind: "QUEUE_ARENA"; bracket: ArenaBracket; reason: string }
  | { kind: "IN_ARENA"; matchId: string; bracket: ArenaBracket }
  | {
      kind: "HUB_POST_ARENA"
      bracket: ArenaBracket
      placement: 1 | 2 | 3 | 4 | null
      goldAwarded: number
    }
  | { kind: "STOPPED"; reason: string }

export type HybridEvent =
  | { type: "START" }
  | {
      type: "DUNGEON_DONE"
      outcome: DungeonOutcome
      /** Post-dungeon liquid gold, used by the arena-entry policy. */
      gold: number
      level: number
    }
  | { type: "ARENA_MATCHED"; matchId: string; bracket: ArenaBracket }
  | {
      type: "ARENA_ENDED"
      /** Null for timeouts / abandoned matches. */
      placement: 1 | 2 | 3 | 4 | null
      goldAwarded: number
    }
  | { type: "ARENA_TIMEOUT"; bracket: ArenaBracket }
  | { type: "STOP"; reason: string }

export interface ReducerContext {
  /**
   * Decides whether the next hub-exit transitions to dungeon or arena.
   * Typically wires through `policy.shouldEnterArena` with live arena history
   * closed over in the caller.
   */
  arenaEntryPolicy: ArenaEntryPolicy
}

// ── Constructors ────────────────────────────────────────────────────────

export const INITIAL_STATE: HybridState = { kind: "HUB_IDLE" }

// ── Reducer ─────────────────────────────────────────────────────────────

/**
 * Pure reducer. Given the current state and an event, returns the next state.
 * Illegal (state, event) combinations are treated as no-ops rather than
 * throwing so the supervisor loop is resilient to out-of-order events (e.g. a
 * lingering `ARENA_TIMEOUT` that arrives after `ARENA_MATCHED`).
 */
export function nextHybridState(
  state: HybridState,
  event: HybridEvent,
  ctx: ReducerContext,
): HybridState {
  if (event.type === "STOP") {
    return { kind: "STOPPED", reason: event.reason }
  }
  if (state.kind === "STOPPED") return state

  switch (state.kind) {
    case "HUB_IDLE": {
      if (event.type === "START") return { kind: "RUN_DUNGEON", attempt: 1 }
      return state
    }

    case "RUN_DUNGEON": {
      if (event.type === "DUNGEON_DONE") {
        return {
          kind: "HUB_POST_DUNGEON",
          outcome: event.outcome,
          gold: event.gold,
          level: event.level,
        }
      }
      return state
    }

    case "HUB_POST_DUNGEON": {
      // HUB_POST_DUNGEON is a pseudo-state: we immediately resolve to either
      // RUN_DUNGEON or QUEUE_ARENA based on the entry policy. This case fires
      // when the supervisor tick evaluates the transition — we accept any
      // event as the cue to resolve, because the event shape is not used
      // (policy is closed over the ctx).
      //
      // Death always goes back to RUN_DUNGEON regardless of gold — the 15.4
      // spec "dungeon death → hub → next dungeon" line.
      if (state.outcome === "death") {
        return { kind: "RUN_DUNGEON", attempt: 1 }
      }

      const decision = ctx.arenaEntryPolicy({
        gold: state.gold,
        level: state.level,
      })
      if (!decision.enter) {
        return { kind: "RUN_DUNGEON", attempt: 1 }
      }
      return {
        kind: "QUEUE_ARENA",
        bracket: decision.bracket,
        reason: decision.reason,
      }
    }

    case "QUEUE_ARENA": {
      if (event.type === "ARENA_MATCHED") {
        return {
          kind: "IN_ARENA",
          matchId: event.matchId,
          bracket: event.bracket,
        }
      }
      if (event.type === "ARENA_TIMEOUT") {
        return {
          kind: "HUB_POST_ARENA",
          bracket: event.bracket,
          placement: null,
          goldAwarded: 0,
        }
      }
      return state
    }

    case "IN_ARENA": {
      if (event.type === "ARENA_ENDED") {
        return {
          kind: "HUB_POST_ARENA",
          bracket: state.bracket,
          placement: event.placement,
          goldAwarded: event.goldAwarded,
        }
      }
      return state
    }

    case "HUB_POST_ARENA": {
      // Pseudo-state like HUB_POST_DUNGEON: always resolve to RUN_DUNGEON on
      // the next supervisor tick.
      return { kind: "RUN_DUNGEON", attempt: 1 }
    }

    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

/**
 * Convenience: resolves a chain of hub pseudo-states. The reducer emits
 * `HUB_POST_DUNGEON` and `HUB_POST_ARENA` as staging states; the supervisor
 * always wants the concrete downstream state (`RUN_DUNGEON` or `QUEUE_ARENA`).
 * This helper applies the reducer until it hits a terminal state or a fixed
 * point.
 */
export function resolveHub(
  state: HybridState,
  ctx: ReducerContext,
): HybridState {
  let current = state
  for (let i = 0; i < 8; i++) {
    if (current.kind !== "HUB_POST_DUNGEON" && current.kind !== "HUB_POST_ARENA") {
      return current
    }
    const next = nextHybridState(current, { type: "START" }, ctx)
    if (next === current) return current
    current = next
  }
  return current
}
