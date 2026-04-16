# super-agent

A more capable Adventure.fun agent example built on the SDK. Targets four weaknesses of the
strategic example:

1. **Item pickup & interactables** — new `ItemMagnetModule` and `InteractableRouterModule`
   BFS-route toward distant remembered loot and visible unlocked interactables (chests,
   shrines, levers), instead of only acting on adjacent `pickup` / `interact` actions.
2. **Active abilities in combat** — new `AbilityCombatModule` consults per-class profiles to
   emit `{type:"attack", target_id, ability_id}` when a ready, affordable ability fits the
   situation (AoE vs 3+ enemies, burst vs boss, etc.). The default `CombatModule` stays in as
   a fallback for basic attacks.
3. **Cross-run memory** — a `WorldModel` (SQLite via `bun:sqlite`) persists realm run history,
   enemy kill/death stats, and shop prices across container restarts. An LLM wrapper
   (`AbilityAwareLLMAdapter`) injects the ability list, a class rubric, and a world-model
   summary into every system prompt so the strategic and tactical LLMs see context the vanilla
   SDK leaves out.
4. **Shopping / gearing** — a `BudgetPlanner` runs via the SDK's new `lobbyHook`, stocks
   class-specific consumables, and buys tier-up gear when gold permits and today's price is
   not inflated vs. historical shop data.

## What's new in the SDK itself

Two small clean hooks added upstream:

- `src/modules/bfs.ts` — shared BFS helper extracted from `key-door.ts`. Exports `bfsStep`
  and `bfsDistance`. Custom modules reuse this instead of duplicating pathfinding.
- `BaseAgentOptions.lobbyHook?: LobbyHook` — optional async hook called from
  `runHeuristicLobbyPhase` after inventory cleanup and before the built-in equip/potion/portal
  passes. Returning `true` signals the hook fully handled shopping.

Both changes are strictly additive; existing agents work unchanged.

## Run locally against the stub API

```bash
docker compose up -d                       # existing stub API + spectator UI
bun install
bun run examples/super-agent/index.ts
```

Open `http://localhost:3002/?mode=debug` to watch the agent play with the full local
observation stream. Success signals you should see within a few minutes:

- `[action] {"type":"attack","ability_id":"…"}` at least once per fight
- `[action] {"type":"interact","target_id":"…"}` for non-locked chests/shrines
- `[action] {"type":"move",…}` when no pickup is legal but a remembered item exists
- `[budget] buy …` on at least one lobby visit

## Run in Docker (crash-loop supervisor)

```bash
docker compose -f docker-compose.yml -f docker-compose.super.yml up -d --build
docker compose logs -f super-agent
```

The named volume `super-agent-data` holds the WorldModel SQLite database at `/data/agent.db`.
It survives `docker compose down` and image rebuilds so the agent retains realm stats, shop
prices, and kill/death history across every life cycle.

`supervisor.ts` wraps `runOnce()` with exponential backoff (2s → 4s → 8s → … capped 60s) so
transient agent crashes don't churn the container.

## Inspect cross-run memory

```bash
# Live container
docker compose exec super-agent sh -c "sqlite3 /data/agent.db 'SELECT template_id,outcome,floor_reached FROM realm_runs ORDER BY id DESC LIMIT 10'"

# Local run (default path ./super-agent.db)
sqlite3 ./super-agent.db 'SELECT template_id, character_class, sightings, kills, deaths_to FROM enemy_stats ORDER BY kills + deaths_to DESC LIMIT 20'
```

## Environment variables

All strategic-agent env vars are supported (same names). Super-agent defaults differ:

| Var | Default | Notes |
|-----|---------|-------|
| `WORLD_DB_PATH` | `./super-agent.db` | In docker: `/data/agent.db` |
| `LLM_MODEL` | `anthropic/claude-sonnet-4.6` | Strategic LLM |
| `TACTICAL_LLM_MODEL` | `anthropic/claude-haiku-4.5` | Tactical LLM |
| `INN_HEAL_THRESHOLD` | `0.5` | Rest below 50% HP (saves x402 budget) |
| `BUY_POTION_MINIMUM` | `3` | One more than strategic default |
| `AUTO_SPEND_SKILL_POINTS` | `true` | Seeded from class profile unless `PREFERRED_SKILL_NODES` is set |
| `AUTO_SPEND_PERKS` | `true` | Seeded from class profile unless `PREFERRED_PERKS` is set |
| `EMERGENCY_HP_PERCENT` | `0.25` | |
| `AGENT_BACKOFF_BASE_MS` | `2000` | Supervisor backoff base |
| `AGENT_BACKOFF_MAX_MS` | `60000` | Supervisor backoff ceiling |

## Layout

```
examples/super-agent/
  index.ts                          # runOnce() entrypoint + event wiring
  supervisor.ts                     # Docker entrypoint: crash-loop harness
  config.ts                         # createSuperConfig() + createSuperModules()
  tsconfig.json                     # `bun tsc -p examples/super-agent/tsconfig.json`
  src/
    classes/                        # ClassProfile registry (rogue/knight/mage/archer)
    modules/                        # AbilityCombat, ItemMagnet, InteractableRouter, ClassAwareTrap
    llm/augmenter.ts                # AbilityAwareLLMAdapter
    lobby/gearing-planner.ts        # BudgetPlanner state machine + lobby hook
    world-model/                    # SQLite schema + WorldModel facade
  tests/                            # bun test examples/super-agent/tests/
```

## Tests

```bash
bun test examples/super-agent/tests/
```

Exercises every new module in isolation plus the WorldModel, the LLM augmenter, and the
BudgetPlanner state machine. All tests run on in-memory SQLite so no filesystem setup is
needed.
