# arena-agent

A pure-arena `BaseAgent` example that joins an arena match, plays it to
completion, and exits. No dungeon modules, no realm progression.

## Scope (Phase 14)

- Assumes the character is already rolled + funded.
- Queues for an arena bracket, polls until the matchmaker promotes the
  character into a match, then connects via
  `GameClient.connectArenaMatch(matchId, ticket)`.
- Drives actions with six arena-specific `AgentModule`s wrapped by an
  `ArenaPromptAdapter` that injects arena rules + threat ranking + class
  PvP rubric + recent-events memory.

Phase 15 adds the hybrid supervisor that alternates dungeons and arena;
this example stops after one match.

## Required environment

| Variable            | Example                                                   | Notes |
|---------------------|-----------------------------------------------------------|-------|
| `API_URL`           | `http://localhost:3001`                                   | REST base |
| `WS_URL`            | `ws://localhost:3001`                                     | WS base |
| `ARENA_BRACKET`     | `rookie` \| `veteran` \| `champion`                        | default `rookie` |
| `CHARACTER_CLASS`   | `rogue` \| `knight` \| `mage` \| `archer`                  | required when rolling |
| `LLM_API_KEY`       | `sk-or-v1-...`                                            | OpenRouter key |
| `LLM_MODEL`         | `anthropic/claude-sonnet-4.6`                             | strategic model |
| `TACTICAL_LLM_MODEL`| `anthropic/claude-haiku-4.5`                              | tactical model |
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
