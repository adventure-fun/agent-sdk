# Strategic Agent Example

This example is the full-featured SDK showcase. It demonstrates a tiered planning setup, a custom loot module, chat personality, tuned module priorities, and automatic chaining into the next run after extraction.

## What It Shows

- A **two-tier planning** configuration:
  - strategic planner on a stronger model
  - tactical re-planner on a cheaper model
- A custom `LootPrioritizer` module that aggressively targets high-rarity drops
- Chat integration with a sarcastic rogue persona
- Lifecycle logging for planner decisions, observations, actions, extraction, death, and disconnects
- Automatic run chaining after successful extraction

## Files

- `config.ts` defines the agent config, custom `LootPrioritizer`, and the tuned module stack
- `index.ts` creates the agent, logs planner tiers, and loops into the next run after extraction

## Run It

From `agent-sdk/`:

```bash
bun run examples/strategic-agent/index.ts
```

## Model Tiering

By default this example uses OpenRouter:

- Strategic planner: `anthropic/claude-sonnet-4.6`
- Tactical re-planner: `anthropic/claude-haiku-4.5`

Override them with:

- `LLM_MODEL`
- `TACTICAL_LLM_MODEL`

This keeps the expensive model focused on realm entry, floor changes, and major strategy shifts, while the cheaper model handles plan repairs when combat or traps invalidate the current queue.

## Customization Points

- Swap `LootPrioritizer` for your own `AgentModule` if you want a different playstyle
- Adjust `decision.maxPlanLength` to trade off planning depth versus re-plan frequency
- Raise or lower `moduleConfidenceThreshold` to make the agent trust modules more or less often
- Tune chat triggers or disable chat entirely through `strategicConfig.chat`

## Cost Notes

Approximate per-realm call patterns:

- `llm-every-turn`: highest cost, one reasoning call per turn
- `planned` with one model: much cheaper, usually a handful of planning calls
- `planned` with tiered models: similar number of calls, but only the strategic moments hit the stronger model

This example uses the last option because it gives the best developer experience for debugging and the best player experience for long runs without paying for an expensive model on every movement.
