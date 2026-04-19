# deterministic-arena

Zero-LLM arena runner. Uses the same `arena-agent` module pipeline — combat,
positioning, cowardice avoidance, wave-predictor, approach — but never
calls OpenRouter. Every turn, each module emits a list
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
    strategic_bonus,             // engagement / bait / flee bonus
    risk_weight,                 // archetype risk aversion
  },
}
```

Utility is roughly

```
utility = expected_damage_dealt
        + strategic_bonus
        - risk_weight * expected_damage_taken
```

with module-specific bonuses (finisher bonus for attacks that drop a target
to 0 HP, commit bonus when we have HP advantage, etc.). Arena is
equipment-only (ARENA_DESIGN.md §1/§9/§10) so there is no heal component
and no chest / loot scoring.

## Archetype table

Profiles live in
[`agent-sdk/examples/arena-agent/src/modules/archetypes.ts`](../arena-agent/src/modules/archetypes.ts).

| Archetype     | aggression | riskWeight | approachMax | commit HP∆ | Notes                         |
|---------------|-----------:|-----------:|------------:|-----------:|-------------------------------|
| `aggressive`  | 0.85       | 0.4        | 8           | 0.05       | Chases far, shrugs off risk. |
| `balanced`    | 0.55       | 0.7        | 6           | 0.10       | Default all-rounder.         |
| `cautious`    | 0.25       | 1.2        | 4           | 0.20       | Only commits at clear edge.  |
| `opportunist` | 0.50       | 0.6        | 5           | 0.12       | Grabs kill opportunities.    |

- `riskWeight` multiplies `expected_damage_taken` when summing utility.
- `approachMax` is the Chebyshev radius inside which the approach module
  will emit a "move toward weakest player" candidate.
- `commit HP∆` is the HP-advantage ratio above which the cowardice module
  commits to attacking instead of fleeing.
- `greed` / `emergencyHpShift` / `safeHealHpShift` / `chestGreedMultiplier`
  are retained on `ArchetypeProfile` for backwards compatibility but no
  longer drive any module behavior since arena became equipment-only.

## Env

| Var                    | Default     | Effect                                               |
|------------------------|-------------|------------------------------------------------------|
| `ARENA_BRACKET`        | `rookie`    | Matchmaking bracket.                                 |
| `BOT_ARCHETYPE`        | `balanced`  | One of `aggressive` / `balanced` / `cautious` / `opportunist`. |
| `BOT_AGGRESSION`       | archetype   | Fine-tune the archetype's `aggression` knob (`0..1`).|
| `CHARACTER_CLASS`      | `rogue`     | Class seeded on `/characters/roll`.                  |
| `CHARACTER_NAME`       | —           | Display name override.                               |
| `EMERGENCY_HP_PERCENT` | `0.25`      | Legacy — no-op since arena became equipment-only.    |
| `AGENT_PRIVATE_KEY`    | —           | EVM key for auth + x402.                             |
| `AGENT_WALLET_NETWORK` | `base`      | Wallet network.                                      |
| `API_URL` / `WS_URL`   | localhost   | Backend URLs.                                        |
| `MAX_RUNTIME_MINUTES`  | unset       | Cap the run.                                         |

## Run

```bash
cd agent-sdk/examples/deterministic-arena
bun run index.ts
```
