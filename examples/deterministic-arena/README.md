# deterministic-arena

Zero-LLM arena runner. Uses the same `arena-agent` module pipeline — combat,
self-care, positioning, cowardice avoidance, chest-looter, wave-predictor,
approach — but never calls OpenRouter. Every turn, each module emits a list
of **action candidates with an expected-value (EV) utility**, and the agent
picks `argmax(utility)` across the entire set. If nothing scores, the agent
emits `{ type: "wait" }`.

## Why

- Run arena bots 24/7 without burning LLM credits.
- Generate reproducible, debuggable spectate traffic.
- Provide behavior variety via `BOT_ARCHETYPE` + `BOT_AGGRESSION` env knobs
  rather than per-model prompting.

## Utility model

Each module returns `ArenaActionCandidate[]` with the shape:

```ts
{
  action: ArenaAction,
  utility: number,               // the argmax score
  components: {
    expected_damage_dealt,       // E[dmg to target(s)]
    expected_damage_taken,       // E[incoming dmg at destination tile]
    expected_heal,               // E[HP restored by a consumable]
    strategic_bonus,             // engagement / bait / flee / loot bonus
    risk_weight,                 // archetype risk aversion
  },
}
```

Utility is roughly

```
utility = expected_damage_dealt
        + expected_heal
        + strategic_bonus
        - risk_weight * expected_damage_taken
```

with module-specific bonuses (finisher bonus for attacks that drop a target
to 0 HP, commit bonus when we have HP advantage, camper penalty on loot
piles with an adjacent hostile, etc.).

## Archetype table

Profiles live in
[`agent-sdk/examples/arena-agent/src/modules/archetypes.ts`](../arena-agent/src/modules/archetypes.ts).

| Archetype     | aggression | riskWeight | greed | approachMax | commit HP∆ | Notes                         |
|---------------|-----------:|-----------:|------:|------------:|-----------:|-------------------------------|
| `aggressive`  | 0.85       | 0.4        | 0.7   | 8           | 0.05       | Chases far, shrugs off risk. |
| `balanced`    | 0.55       | 0.7        | 1.0   | 6           | 0.10       | Default all-rounder.         |
| `cautious`    | 0.25       | 1.2        | 1.2   | 4           | 0.20       | Only commits at clear edge.  |
| `opportunist` | 0.50       | 0.6        | 1.4   | 5           | 0.12       | Loots hot piles, grabs kills. |

- `riskWeight` multiplies `expected_damage_taken` when summing utility.
- `greed` multiplies chest / loot strategic bonuses (and the camper penalty).
- `approachMax` is the Chebyshev radius inside which the approach module
  will emit a "move toward weakest player" candidate.
- `commit HP∆` is the HP-advantage ratio above which the cowardice module
  commits to attacking instead of fleeing.

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
