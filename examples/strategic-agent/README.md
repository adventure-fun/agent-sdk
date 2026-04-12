# Strategic Agent Example

This example is the full-featured SDK showcase. It demonstrates a tiered planning setup, a custom loot module, chat personality, tuned module priorities, auto realm progression, and the new between-run lobby lifecycle.

## What It Shows

- A **two-tier planning** configuration:
  - strategic planner on a stronger model
  - tactical re-planner on a cheaper model
- A custom `LootPrioritizer` module that aggressively targets high-rarity drops
- Chat integration with a sarcastic rogue persona
- Conditional stat rerolls based on your configured thresholds
- Realm progression strategies (`auto`, `regenerate`, `new-realm`, or `stop`)
- Optional profile sync for handle, X, and GitHub
- Optional automatic skill point spending between runs
- Optional LLM-driven lobby decisions with heuristic fallback
- Runtime, realm-count, and x402 spending limits
- Mainnet and testnet wallet network selection
- Lifecycle logging for planner decisions, observations, actions, extraction, death, and disconnects
- Automatic run chaining inside `BaseAgent.start()`

## Files

- `config.ts` defines the agent config, custom `LootPrioritizer`, and the tuned module stack
- `index.ts` creates the agent, logs planner tiers, and lets `BaseAgent.start()` manage the full chained session

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
- `REALM_STRATEGY`, `REALM_TEMPLATE_PRIORITY`, `CONTINUE_ON_EXTRACTION`, and `REALM_ON_ALL_COMPLETED` to control chained progression
- `AUTO_SPEND_SKILL_POINTS` and `PREFERRED_SKILL_NODES` to spend skill points between runs
- `AGENT_HANDLE`, `AGENT_X_HANDLE`, and `AGENT_GITHUB_HANDLE` to sync the account profile
- `REROLL_ON_DEATH=true` to automatically roll a new character after permadeath
- `LOBBY_USE_LLM`, `INN_HEAL_THRESHOLD`, `AUTO_SELL_JUNK`, `AUTO_EQUIP_UPGRADES`, `BUY_POTION_MINIMUM`, and `BUY_PORTAL_SCROLL` to tune the lobby phase
- `MAX_REALMS`, `MAX_RUNTIME_MINUTES`, `MAX_SPEND_USD`, and `SPENDING_WINDOW` to cap run volume and x402 spend

### What these vars actually do

| Env Var | Behavior |
|---------|----------|
| `REALM_TEMPLATE` | Optional seed template. Leave blank if you want `auto` progression to fully discover templates on its own. |
| `REALM_STRATEGY` | `auto`, `regenerate`, `new-realm`, or `stop`. `auto` is the default and is the closest to real player progression. |
| `REALM_TEMPLATE_PRIORITY` | Comma-separated template ids used as an optional progression filter/order override. |
| `CONTINUE_ON_EXTRACTION` | If not set to `"false"`, the agent keeps chaining after successful extractions. |
| `REALM_ON_ALL_COMPLETED` | For `auto`, either regenerate the last completed template or stop after exhausting all templates. |
| `LOBBY_USE_LLM` | If not set to `"false"`, the lobby phase is planned by the LLM. Otherwise the SDK uses heuristic fallback rules. |
| `INN_HEAL_THRESHOLD` | Heal when current HP divided by max HP is below this ratio. |
| `AUTO_SELL_JUNK` | Enables the heuristic junk-selling pass when `LOBBY_USE_LLM=false`. |
| `AUTO_EQUIP_UPGRADES` | Enables heuristic equipping of better lobby gear. |
| `BUY_POTION_MINIMUM` | Buys healing consumables until this count is reached, if affordable. |
| `BUY_PORTAL_SCROLL` | Keeps one portal escape consumable in inventory when possible. |
| `MAX_REALMS` | Stop starting new realms after this many outcomes. |
| `MAX_RUNTIME_MINUTES` | Stop starting new realms after this many minutes. |
| `MAX_SPEND_USD` | Cap x402 spend on paid HTTP actions like realm generation, regeneration, inn rest, and stat rerolls. |
| `SPENDING_WINDOW` | `total`, `daily`, or `hourly`. Windowed budgets sleep until reset; `total` acts like a hard cap. |

### Current junk-selling behavior

The `AUTO_SELL_JUNK` path is conservative, but it is now character-aware:

- it sells class-incompatible items when the template metadata says they are sellable
- it discards incompatible items when the template has no sell value
- it uses `/content/items` metadata such as `class_restriction`, `ammo_type`, item type, and `sell_price`
- it still protects potions, portal scrolls, and key items

It still does not try to liquidate every low-upside item. Compatible equipment and useful consumables are kept unless you add a more aggressive policy on top.

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
