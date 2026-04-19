# deterministic-realm

A **fully deterministic**, zero-LLM realm agent. Drop-in replacement for
`super-agent` when you want 24/7 fleet coverage without burning API credits.

## What's different from `super-agent`

| Aspect | `super-agent` | `deterministic-realm` |
| --- | --- | --- |
| Decision strategy | `"planned"` (strategic + tactical LLM) | `"module-only"` (highest-confidence module wins) |
| LLM adapter | `OpenRouterAdapter` + `AbilityAwareLLMAdapter` | `NullLLMAdapter` (throws if ever called) |
| Lobby shopping | `lobbyHook` with LLM budget planner | Built-in rule-based equip / buy-potion / buy-portal passes |
| Chat | Optional LLM banter | Disabled (`chat.enabled = false`) |
| Name generation | `LLMNameProvider` | `DeterministicNameProvider` (stable across rerolls) |
| Spend | Caps via `MAX_SPEND_USD` | `maxSpendUsd = 0` — refuses to hit any paid endpoint |

The module roster is identical, so observable combat / exploration / loot
behavior is the same subset the super-agent falls back on when its LLM
confidence is low.

## Required env

| Var | Purpose |
| --- | --- |
| `API_URL` / `WS_URL` | Game server endpoints |
| `AGENT_ID` | Supabase auth identity for this bot |
| `AGENT_PRIVATE_KEY` | Wallet key (or `type=env` fallback) |
| `CHARACTER_NAME` | **Recommended.** Used by `DeterministicNameProvider` |
| `CHARACTER_CLASS` | `rogue` \| `knight` \| `mage` \| `archer` (default `rogue`) |
| `CHARACTER_FLAVOR` | Short flavor string passed to the lobby path |
| `WORLD_DB_PATH` | SQLite path for the `WorldModel` (default `./deterministic-realm.db`) |

Behavior knobs (all optional, see `config.ts` for defaults):
`REALM_TEMPLATE`, `REALM_STRATEGY`, `CONTINUE_ON_EXTRACTION`,
`REALM_ON_ALL_COMPLETED`, `AUTO_SPEND_SKILL_POINTS`, `AUTO_SPEND_PERKS`,
`PREFERRED_SKILL_NODES`, `PREFERRED_PERKS`, `INN_HEAL_THRESHOLD`,
`DISABLE_INN_REST`, `AUTO_SELL_JUNK`, `AUTO_EQUIP_UPGRADES`,
`BUY_POTION_MINIMUM`, `BUY_PORTAL_SCROLL`, `MAX_REALMS`,
`MAX_RUNTIME_MINUTES`, `REROLL_ON_DEATH`, `EMERGENCY_HP_PERCENT`,
`EXTRACTION_LEFT_BIAS_EXIT`, `EXPLORATION_RIGHT_BIAS`,
`STUCK_ROOM_THRESHOLD`, `STUCK_POSITION_THRESHOLD`.

## Run

```bash
bun run agent-sdk/examples/deterministic-realm/index.ts
```

Docker images consume this entrypoint the same way they consume
`super-agent/index.ts` — just different `AGENT_RUNTIME=deterministic-realm`.

## Why keep the `NullLLMAdapter`?

`BaseAgent` requires a non-optional `llmAdapter`. The planner never invokes
it when `decision.strategy = "module-only"`, but a future refactor or a
rogue module that forces a strategic re-plan would otherwise hit a network
endpoint with an empty API key. `NullLLMAdapter.decide/plan/generateText`
all throw with a descriptive message so misconfiguration surfaces at
runtime instead of silently costing money.
