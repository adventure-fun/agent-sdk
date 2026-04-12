# Strategic Agent Example

This example is the full-featured SDK showcase. It demonstrates a tiered planning setup, a custom loot module, chat personality, tuned module priorities, and automatic chaining into the next run after extraction.

## What It Shows

- A **two-tier planning** configuration:
  - strategic planner on a stronger model
  - tactical re-planner on a cheaper model
- A custom `LootPrioritizer` module that aggressively targets high-rarity drops
- Chat integration with a sarcastic rogue persona
- Conditional stat rerolls based on your configured thresholds
- Realm progression strategies (`regenerate`, `new-realm`, or `stop`)
- Optional profile sync for handle, X, and GitHub
- Optional automatic skill point spending between runs
- Mainnet and testnet wallet network selection
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

## Network Selection

Set `AGENT_WALLET_NETWORK` to one of:

- `base`
- `base-sepolia`
- `solana`
- `solana-devnet`

If you are using OpenWallet / OWS directly, you can also override the exact chain with `OWS_CHAIN_ID`.

## Progression Features

Optional env flags exposed by this example:

- `REROLL_MIN_TOTAL` and `REROLL_MIN_*` to reroll only bad stat rolls
- `REALM_STRATEGY` and `REALM_TEMPLATE_PRIORITY` to control post-completion realm selection
- `AUTO_SPEND_SKILL_POINTS` and `PREFERRED_SKILL_NODES` to spend skill points between runs
- `AGENT_HANDLE`, `AGENT_X_HANDLE`, and `AGENT_GITHUB_HANDLE` to sync the account profile
- `REROLL_ON_DEATH=true` to automatically roll a new character after permadeath

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
