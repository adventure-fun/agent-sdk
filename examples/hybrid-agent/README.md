# hybrid-agent

Phase 15 example that rotates one character between dungeons and arena matches
via a persistent state machine. Combines the `super-agent` dungeon module stack
with the `arena-agent` arena module stack — nothing new at the gameplay layer,
the contribution is the supervisor that decides *when* each stack runs.

## State machine

```
HUB_IDLE
  └─▶ RUN_DUNGEON
        ├─▶ HUB_POST_DUNGEON  (on extracted / death)
        │     ├─▶ RUN_DUNGEON      (gold < threshold, or arena on cooldown)
        │     └─▶ QUEUE_ARENA      (gold ≥ threshold, no cooldown)
        │
        └─(error)─▶ HUB_IDLE
QUEUE_ARENA
  ├─▶ IN_ARENA             (match_id returned)
  └─▶ HUB_POST_ARENA       (queue timeout)
IN_ARENA
  └─▶ HUB_POST_ARENA       (arena_match_end)
HUB_POST_ARENA
  └─▶ RUN_DUNGEON
```

The reducer lives in `src/state-machine.ts` as a pure function so the
supervisor.test.ts suite can exhaustively verify every transition without
spinning up a real WebSocket.

## Decision policy

`src/policy.ts` exposes four pure helpers:

| Function | Purpose |
|---|---|
| `shouldEnterArena` | Gold-threshold + cooldown gate, produces bracket (with downgrade). |
| `shouldBuyGearFirst` | Optional shop detour when ≥1 equipment slot is empty and gold allows. |
| `computeArenaCooldown` | Reads recent arena results and returns remaining cooldown dungeons. |
| `downgradeBracket` | One-step bracket downgrade (`champion → veteran → rookie`). |

## Persistent memory

`src/world-model/` composes the super-agent `WorldModel` (for dungeon runs) with
three hybrid-specific tables:

- `arena_results` — one row per finished arena match.
- `arena_queue_history` — queue join / drop / match audit log.
- `gold_history` — sparse balance snapshots for fatigue display.

The composed DB opens via the same `openWorldDatabase` call super-agent uses
(both schemas are `CREATE TABLE IF NOT EXISTS`), so running the hybrid example
against an existing super-agent DB is safe — the arena tables are additive.

## Run locally

```bash
bun install
bun run examples/hybrid-agent/index.ts
```

## Run under the crash-loop supervisor

```bash
bun run examples/hybrid-agent/supervisor.ts
```

The supervisor mirrors the super-agent crash-loop wrapper: exponential backoff
(2s → capped 60s) on uncaught errors, cooldown between clean exits, and SIGTERM
/ SIGINT graceful shutdown.

## Environment variables

Inherits every `super-agent` and `arena-agent` env var (same names). Hybrid
adds:

| Var | Default | Notes |
|-----|---------|-------|
| `HYBRID_DB_PATH` | `./hybrid-agent.db` | SQLite file path (`:memory:` for tests) |
| `ARENA_BRACKET` | auto from level | Override to force a bracket |
| `ARENA_GOLD_THRESHOLD` | `150` | Minimum liquid gold to consider queueing |
| `ARENA_PREP_MIN_GOLD` | `300` | Gold floor for the gear-detour heuristic |
| `ARENA_COOLDOWN_TRIGGER_LOSSES` | `3` | Consecutive non-wins that trigger cooldown |
| `ARENA_COOLDOWN_DUNGEONS` | `5` | Dungeons to run before re-enabling arena |
| `ARENA_DOWNGRADE_LOSSES` | `3` | Losses in window that force a bracket downgrade |
| `ARENA_DOWNGRADE_WINDOW` | `10` | Window size (most recent arena results) |
| `ARENA_QUEUE_TIMEOUT_MINUTES` | `10` | Bail window when no match pops |

## Tests

```bash
bun test examples/hybrid-agent/tests/
```

All tests run against in-memory SQLite and injected runner fakes so the suite
never needs a live backend or LLM.

## Layout

```
examples/hybrid-agent/
  index.ts                          # runOnce() entrypoint
  supervisor.ts                     # crash-loop harness
  config.ts                         # createHybridConfig() + policy thresholds
  tsconfig.json
  src/
    state-machine.ts                # pure reducer
    policy.ts                       # shouldEnterArena / cooldown / bracket downgrade
    dungeon-runner.ts               # BaseAgent one-shot dungeon
    arena-runner.ts                 # ArenaAgent one-shot match
    supervisor-loop.ts              # drives the state machine
    world-model/                    # HybridWorldModel + schema
  tests/
```
