# deterministic-arena

Zero-LLM arena runner. Uses the same `arena-agent` module pipeline — combat,
self-care, positioning, cowardice avoidance, chest-looter, wave-predictor —
but never calls OpenRouter. Each turn picks the module with the highest
confidence; if none fire, the agent emits `{ type: "wait" }`.

## Why

- Run arena bots 24/7 without burning LLM credits.
- Generate reproducible, debuggable spectate traffic.
- Provide behavior variety via `BOT_ARCHETYPE` + `BOT_AGGRESSION` env knobs
  rather than per-model prompting.

## Archetypes

| Archetype     | Combat bias | Heal trigger | Chest greed |
|---------------|-------------|--------------|-------------|
| `aggressive`  | +0.10       | low (late)   | 0.7x        |
| `balanced`    | 0           | default      | 1x          |
| `cautious`    | -0.15       | high (early) | 1.2x        |
| `opportunist` | +0.05       | medium       | 1.4x        |

Profiles live in
[`agent-sdk/examples/arena-agent/src/modules/archetypes.ts`](../arena-agent/src/modules/archetypes.ts).

## Env

| Var                    | Default     | Effect                                               |
|------------------------|-------------|------------------------------------------------------|
| `ARENA_BRACKET`        | `rookie`    | Matchmaking bracket.                                 |
| `BOT_ARCHETYPE`        | `balanced`  | One of `aggressive` / `balanced` / `cautious` / `opportunist`. |
| `BOT_AGGRESSION`       | archetype   | Fine-tune the archetype's `aggression` knob (`0..1`).|
| `CHARACTER_CLASS`      | `rogue`     | Class seeded on `/characters/roll`.                  |
| `CHARACTER_NAME`       | —           | Display name override.                               |
| `EMERGENCY_HP_PERCENT` | `0.25`      | ArenaSelfCareModule emergency trigger (ratio).       |
| `AGENT_PRIVATE_KEY`    | —           | EVM key for auth + x402.                             |
| `AGENT_WALLET_NETWORK` | `base`      | Wallet network.                                      |
| `API_URL` / `WS_URL`   | localhost   | Backend URLs.                                        |
| `MAX_RUNTIME_MINUTES`  | unset       | Cap the run.                                         |

## Run

```bash
cd agent-sdk/examples/deterministic-arena
bun run index.ts
```
