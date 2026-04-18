import type { ArenaBracket } from "../../../src/index.js"
import type { HybridPolicyThresholds } from "../config.js"
import type { ArenaOutcome } from "./arena-runner.js"
import type { DungeonOutcome } from "./dungeon-runner.js"
import {
  INITIAL_STATE,
  nextHybridState,
  resolveHub,
  type HybridState,
  type ReducerContext,
} from "./state-machine.js"
import { shouldEnterArena } from "./policy.js"
import type { HybridWorldModel } from "./world-model/world-model.js"

/**
 * Glue between the pure state machine (`state-machine.ts`) and the I/O-heavy
 * dungeon/arena runners. Kept deliberately small so `supervisor.test.ts` can
 * drive it with synchronous fakes — every side effect goes through the
 * injected runners or the injected world model.
 *
 * The loop is a plain `while(!stopped)` on the current state; each state has
 * exactly one "tick" behaviour that may kick off an async runner and then feed
 * the result back into `nextHybridState`.
 */

export interface HybridDungeonRunner {
  (): Promise<DungeonOutcome>
}

export interface HybridArenaRunner {
  (input: { bracket: ArenaBracket }): Promise<ArenaOutcome>
}

export interface SupervisorLoopInput {
  world: HybridWorldModel
  /**
   * Character id used for arena_results / cooldown queries. Can be a
   * placeholder ("unknown") on boot — the loop adopts the real id from the
   * first dungeon outcome or arena outcome that surfaces one.
   */
  characterId: string
  /** Bracket override (e.g. operator-supplied `ARENA_BRACKET` env var). */
  overrideBracket?: ArenaBracket | undefined
  thresholds: HybridPolicyThresholds
  runDungeon: HybridDungeonRunner
  runArena: HybridArenaRunner
  /**
   * Safety lid on the outer loop. Tests cap this at a handful of ticks;
   * production runs it as `Infinity` (the loop only exits on `STOP` or an
   * unhandled runner error).
   */
  maxLoopIterations?: number
  logger?: (msg: string) => void
  /** Hook fired after every state transition — used by tests to spy on chain. */
  onTransition?: (prev: HybridState, next: HybridState) => void
}

export interface SupervisorLoopResult {
  finalState: HybridState
  iterations: number
}

export async function runSupervisorLoop(
  input: SupervisorLoopInput,
): Promise<SupervisorLoopResult> {
  const log = input.logger ?? ((m: string) => console.log(m))
  const maxIterations = input.maxLoopIterations ?? Number.POSITIVE_INFINITY

  let state: HybridState = INITIAL_STATE
  let iterations = 0
  let dungeonsSinceCooldown = 0
  let lastDungeon: DungeonOutcome | null = null
  let characterId = input.characterId

  const ctx: ReducerContext = {
    arenaEntryPolicy: ({ gold, level }) =>
      shouldEnterArena({
        gold,
        level,
        recentArenaResults: input.world.getRecentArenaResults(
          characterId,
          Math.max(input.thresholds.bracketDowngradeWindow, 10),
        ),
        dungeonsSinceCooldown,
        thresholds: input.thresholds,
        overrideBracket: input.overrideBracket,
      }),
  }

  const advance = (event: Parameters<typeof nextHybridState>[1]): HybridState => {
    const next = nextHybridState(state, event, ctx)
    input.onTransition?.(state, next)
    state = next
    // Eagerly resolve hub pseudo-states so callers see the concrete downstream state.
    const resolved = resolveHub(state, ctx)
    if (resolved !== state) {
      input.onTransition?.(state, resolved)
      state = resolved
    }
    return state
  }

  // Kick off.
  advance({ type: "START" })

  while (iterations < maxIterations && state.kind !== "STOPPED") {
    iterations += 1

    switch (state.kind) {
      case "RUN_DUNGEON": {
        log(`[supervisor] tick ${iterations}: RUN_DUNGEON`)
        lastDungeon = await input.runDungeon()
        // Track cooldown progress every dungeon finished.
        dungeonsSinceCooldown += 1
        // Adopt the character id as soon as we see one so arena queries work.
        if (lastDungeon.characterId) {
          characterId = lastDungeon.characterId
        }
        // Write gold history when we have a concrete post-run balance.
        input.world.recordGold(
          characterId,
          lastDungeon.goldAfter,
          lastDungeon.outcome === "extracted"
            ? "dungeon_extracted"
            : lastDungeon.outcome === "death"
              ? "dungeon_death"
              : "manual",
        )
        advance({
          type: "DUNGEON_DONE",
          outcome: lastDungeon.outcome,
          gold: lastDungeon.goldAfter,
          level: lastDungeon.level,
        })
        break
      }

      case "QUEUE_ARENA": {
        log(
          `[supervisor] tick ${iterations}: QUEUE_ARENA bracket=${state.bracket} reason="${state.reason}"`,
        )
        const queueHistoryId = input.world.markQueueStart(
          characterId,
          state.bracket,
          Date.now(),
        )
        let arenaOutcome: ArenaOutcome
        try {
          arenaOutcome = await input.runArena({ bracket: state.bracket })
        } catch (err) {
          log(
            `[supervisor] arena runner threw: ${err instanceof Error ? err.message : String(err)}`,
          )
          input.world.markQueueDropped(queueHistoryId, Date.now())
          advance({ type: "ARENA_TIMEOUT", bracket: state.bracket })
          break
        }

        // Record the match attempt regardless of outcome.
        if (arenaOutcome.matchId) {
          input.world.markQueueMatched(
            queueHistoryId,
            arenaOutcome.matchId,
            arenaOutcome.matchedAt,
          )
        } else {
          input.world.markQueueDropped(queueHistoryId, arenaOutcome.endedAt)
        }

        // Adopt a fresh character id from the arena event if we didn't have one yet.
        if (arenaOutcome.characterId) {
          characterId = arenaOutcome.characterId
        }
        // If the arena finished (matchId and placement present), record the result.
        if (arenaOutcome.matchId) {
          input.world.recordArenaResult({
            characterId,
            bracket: arenaOutcome.bracket,
            matchId: arenaOutcome.matchId,
            placement: arenaOutcome.placement,
            goldAwarded: arenaOutcome.goldAwarded,
            endedReason: arenaOutcome.endedReason,
            matchedAt: arenaOutcome.matchedAt,
            endedAt: arenaOutcome.endedAt,
          })
          if (arenaOutcome.goldAwarded > 0) {
            input.world.recordGold(
              characterId,
              arenaOutcome.goldAwarded,
              "arena_payout",
              arenaOutcome.endedAt,
            )
          }
          // Re-arm cooldown tracker on any arena resolution — wins clear it via the
          // policy, losses start the next countdown from 0 dungeons.
          dungeonsSinceCooldown = 0
        }

        // A null-placement matchId-less outcome is a queue timeout — surface that
        // distinctly so the reducer can route to HUB_POST_ARENA(null).
        if (!arenaOutcome.matchId) {
          dungeonsSinceCooldown = 0
          advance({ type: "ARENA_TIMEOUT", bracket: state.bracket })
        } else {
          // The reducer models QUEUE_ARENA -> IN_ARENA -> HUB_POST_ARENA. The
          // runner collapsed those two async steps into one call, so emit the
          // transition pair back-to-back to keep the state machine honest.
          advance({
            type: "ARENA_MATCHED",
            matchId: arenaOutcome.matchId,
            bracket: arenaOutcome.bracket,
          })
          advance({
            type: "ARENA_ENDED",
            placement: arenaOutcome.placement,
            goldAwarded: arenaOutcome.goldAwarded,
          })
        }
        break
      }

      case "IN_ARENA":
        // Should not be reachable — QUEUE_ARENA resolves directly to HUB_POST_ARENA
        // after the runner returns. Included for exhaustiveness.
        log(
          `[supervisor] tick ${iterations}: IN_ARENA unexpected — treating as STOP`,
        )
        advance({ type: "STOP", reason: "unreachable IN_ARENA tick" })
        break

      case "HUB_IDLE":
      case "HUB_POST_DUNGEON":
      case "HUB_POST_ARENA": {
        // resolveHub should have collapsed these; if we still see one we fire
        // START to advance at least one step and avoid an infinite idle loop.
        log(`[supervisor] tick ${iterations}: ${state.kind} — forcing resolve`)
        advance({ type: "START" })
        break
      }

      default: {
        const _exhaustive: never = state
        void _exhaustive
        advance({ type: "STOP", reason: "exhaustive fallthrough" })
      }
    }
  }

  return { finalState: state, iterations }
}
