# arena-agent

A pure-arena `BaseAgent` example that joins an arena match, plays it to
completion, and exits. No dungeon modules, no realm progression.

## Scope (Phase 14)

- Assumes the character is already rolled + funded.
- Queues for an arena bracket, polls until the matchmaker promotes the
  character into a match, then connects via
  `GameClient.connectArenaMatch(matchId, ticket)`.
- Drives actions with seven arena-specific `AgentModule`s (combat,
  self-care, positioning, cowardice avoidance, chest-looter, wave-predictor,
  approach) wrapped by an `ArenaPromptAdapter` that injects arena rules +
  threat ranking + class PvP rubric + recent-events memory.

Phase 15 adds the hybrid supervisor that alternates dungeons and arena;
this example stops after one match.

## Decision model (module-first + LLM tiebreak)

Every module emits `ArenaActionCandidate[]` with an expected-value utility
(see
[`deterministic-arena/README.md`](../deterministic-arena/README.md#utility-model)
for the full EV formula and archetype table). Each turn:

1. Collect every candidate from every module and compute `argmax(utility)`.
2. **If the top candidate dominates by at least `EV_DOMINANT_MARGIN`**,
   commit to it immediately — no LLM call. This saves OpenRouter credits on
   "obvious" turns (adjacent enemy, emergency heal, camper-adjacent loot).
3. Otherwise, hand the full candidate list + prompt context to the LLM,
   which picks the final action as a strategic tiebreak.

Legacy confidence-only recommendations are projected into utility space via
`LEGACY_UTILITY_SCALE` so mixing module styles just works.

## Required environment

| Variable            | Example                                                   | Notes |
|---------------------|-----------------------------------------------------------|-------|
| `API_URL`           | `http://localhost:3001`                                   | REST base |
| `WS_URL`            | `ws://localhost:3001`                                     | WS base |
| `ARENA_BRACKET`     | `rookie` \| `veteran` \| `champion`                        | default `rookie` |
| `CHARACTER_CLASS`   | `rogue` \| `knight` \| `mage` \| `archer`                  | required when rolling |
| `LLM_API_KEY`       | `sk-or-v1-...`                                            | OpenRouter key |
| `LLM_MODEL`         | `anthropic/claude-sonnet-4.6`                             | strategic tie-break model (module-first) |
| `AGENT_PRIVATE_KEY` | `0x...`                                                   | env wallet |
| `ARENA_QUEUE_POLL_MS` | `2000`                                                  | queue poll interval |
| `ARENA_QUEUE_TIMEOUT_MS` | `180000`                                              | give up if no match |

## Run

```bash
bun run examples/arena-agent/index.ts
```

## Files

- `index.ts` — `runOnce()` entry point; queues, polls, connects, plays.
- `config.ts` — `createArenaConfig`, `createArenaModules` factory.
- `src/modules/` — six arena-specific modules.
- `src/llm/arena-prompt-adapter.ts` — arena system-prompt augmentation.
- `tests/` — module + prompt-adapter + connectArenaMatch unit tests.
