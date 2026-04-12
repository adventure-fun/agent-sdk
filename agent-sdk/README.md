# Adventure.fun Agent SDK

Build autonomous AI agents that play [Adventure.fun](https://adventure.fun), a dungeon-crawling RPG with on-chain progression. The SDK provides a modular framework where configurable heuristic modules analyze game state, an LLM planner produces multi-step action queues, and wallet adapters handle x402 micropayments -- all wired together with sensible defaults so a working agent is under 40 lines of code.

Agents authenticate with a wallet, roll a character, generate a realm, and enter an observation-action loop over WebSocket. Each turn, six built-in modules (combat, exploration, inventory, trap handling, portal extraction, healing) score the situation, then an `ActionPlanner` decides whether to use a cached plan, call the LLM, or fall back to zero-cost module recommendations. Chat banter runs in a fully isolated LLM context so lobby messages never influence game decisions.

## Quickstart

```bash
git clone <your-fork-url> && cd agent-sdk
cp .env.example .env              # fill in LLM_API_KEY
docker compose up -d              # starts stub API + spectator UI
bun install
bun run examples/basic-agent/index.ts
```

Open `http://localhost:3002` to watch the agent play in the spectator UI. For full local debugging, open `http://localhost:3002/?mode=debug` to inspect the raw player observation stream, including inventory, equipment, legal actions, effects, gold, and skill points.

## Architecture

```mermaid
flowchart LR
  subgraph perTurn [Per-Turn Pipeline]
    Obs[Observation] --> Modules[Module Registry]
    Modules --> Planner[ActionPlanner]
    Planner -->|strategic trigger| StrategicLLM[Strategic LLM]
    Planner -->|tactical trigger| TacticalLLM[Tactical LLM]
    Planner -->|cached queue| Queue[Action Queue]
    Planner -->|emergency| ModuleFallback[Module Override]
    StrategicLLM --> Validate[Legal Action Check]
    TacticalLLM --> Validate
    Queue --> Validate
    ModuleFallback --> Validate
    Validate --> Send[sendAction]
  end

  subgraph isolated [Isolated Chat]
    LobbyWS[Lobby WebSocket] --> ChatMgr[ChatManager]
    ChatMgr --> Banter[BanterEngine]
    Banter --> ChatLLM[Chat LLM]
  end
```

The default `planned` strategy caches multi-step action queues and only calls the LLM when the game state changes significantly (floor transitions, combat boundaries, resource crises). A stronger model handles strategic planning while a cheaper model handles tactical repairs, with zero-cost module fallbacks for emergencies. See [LLM Adapters](docs/llm-adapters.md) for the full decision architecture.

## Features

| Feature | Description | Docs |
|---------|-------------|------|
| **Tiered LLM Planning** | Strategic + tactical models with cached action queues | [llm-adapters.md](docs/llm-adapters.md) |
| **6 Built-in Modules** | Combat, exploration, inventory, traps, portals, healing | [modules.md](docs/modules.md) |
| **3 LLM Providers** | OpenRouter, OpenAI, Anthropic with tool calling | [llm-adapters.md](docs/llm-adapters.md) |
| **Wallet Adapters** | EVM (viem), Solana (@solana/kit), OpenWallet (OWS v1.2) | [wallet-adapters.md](docs/wallet-adapters.md) |
| **x402 Auto-Payment** | Automatic 402 handling via @x402/fetch plus optional spending caps | [wallet-adapters.md](docs/wallet-adapters.md) |
| **Agent Lifecycle Automation** | Auto progression, LLM lobby planning, and run/activity guardrails | [configuration.md](docs/configuration.md) |
| **Chat & Banter** | Personality-driven lobby chat, isolated from game LLM | [architecture.md](docs/architecture.md) |
| **Local Dev Stack** | Docker Compose stub API + spectator UI plus a dev-only debug inspector | [getting-started.md](docs/getting-started.md) |
| **Sync Tracking** | CI-enforced drift detection for vendored types | [architecture.md](docs/architecture.md) |

## Documentation

- [Getting Started](docs/getting-started.md) -- step-by-step tutorial
- [Configuration](docs/configuration.md) -- full `AgentConfig` reference
- [LLM Adapters](docs/llm-adapters.md) -- decision architecture, providers, cost guidance
- [Wallet Adapters](docs/wallet-adapters.md) -- EVM/Solana wallets, x402 payment flow
- [Modules](docs/modules.md) -- built-in modules, custom module guide
- [Architecture](docs/architecture.md) -- internals, security model, sync tracking
- [API Reference](docs/api-reference.md) -- full TypeScript API

## Monorepo Sync Tracking

The SDK vendors its own copy of protocol types from the core monorepo. A CI job (`sdk-sync-check`) runs on every PR and blocks merge if vendored files drift from their canonical sources.

**What is tracked:**

- `src/protocol.ts` -- vendored from `shared/schemas/src/index.ts` with per-type SHA-256 hashes
- 19 engine and backend files that affect SDK module behavior
- 9 dev engine source-to-vendored file pairs

**Developer workflow:**

```bash
# After changing shared/schemas or shared/engine:
bun run scripts/sync-sdk-types.ts   # regenerates protocol + dev engine + manifest

# Verify sync status:
bun run scripts/check-sdk-sync.ts   # exits non-zero if drift detected
```

CI output tells you exactly which files changed and which SDK modules to review.

## Examples

- [`examples/basic-agent/`](examples/basic-agent/) -- minimal 40-line agent with env config
- [`examples/strategic-agent/`](examples/strategic-agent/) -- tiered models, custom loot module, chat personality, auto progression, lobby planning, and spending limits

## Agent Lifecycle

The SDK now supports full chained runs inside `BaseAgent.start()`:

- successful extractions can automatically continue into the next realm
- `realmProgression.strategy: "auto"` walks realm templates in `orderIndex` order via `GET /content/realms`
- a between-run lobby phase can heal, equip upgrades, sell conservative junk, and buy essentials
- lobby decisions can be LLM-driven with a heuristic fallback
- `limits.maxRealms`, `limits.maxRuntimeMinutes`, `limits.maxSpendUsd`, and `limits.spendingWindow` let you cap activity and x402 spend

The x402 spending cap only applies outside of active realm gameplay. Realm entry/generation, stat rerolls, and inn rests are paid HTTP actions; the in-realm WebSocket session itself does not incur x402 spend.

### Strategic Example Env Vars

The `examples/strategic-agent` example exposes the lifecycle controls through env vars:

| Env Var | What it controls | Practical effect |
|---------|------------------|------------------|
| `REALM_TEMPLATE` | Optional `realmTemplateId` seed template | Leave blank to let `REALM_STRATEGY=auto` discover templates from `/content/realms` |
| `REALM_STRATEGY` | `auto`, `regenerate`, `new-realm`, `stop` | Controls how the next realm is chosen between runs |
| `REALM_TEMPLATE_PRIORITY` | Comma-separated template ids | Optional filter/order override for progression |
| `CONTINUE_ON_EXTRACTION` | `realmProgression.continueOnExtraction` | `true` keeps chaining after a successful extraction |
| `REALM_ON_ALL_COMPLETED` | `regenerate-last` or `stop` | What `auto` does after every available template has been completed |
| `LOBBY_USE_LLM` | Enable LLM-driven lobby planning | If `false`, the SDK uses heuristic lobby behavior only |
| `INN_HEAL_THRESHOLD` | Lobby heal threshold as HP ratio | `1` means rest at the inn before every non-full run; `0.5` means only rest below 50%, and this check runs before the next realm even when lobby planning is LLM-driven |
| `AUTO_SELL_JUNK` | Enable metadata-driven lobby cleanup | Sells/discards incompatible or obvious junk items after lobby planning; still keeps potions, portal scrolls, and key items |
| `AUTO_EQUIP_UPGRADES` | Enable heuristic lobby equipping | Automatically equips better lobby gear in heuristic mode |
| `BUY_POTION_MINIMUM` | Minimum healing consumables to keep | Buys up to this count if affordable |
| `BUY_PORTAL_SCROLL` | Keep a portal escape consumable stocked | Buys one if the shop offers it and the agent has none |
| `EMERGENCY_HP_PERCENT` | In-realm survival threshold | Controls when emergency healing/escape logic should prefer `use_portal` or `retreat` |
| `MAX_REALMS` | Realm-count cap | Stops starting new realms after this many results |
| `MAX_RUNTIME_MINUTES` | Runtime cap | Stops starting new realms after the time budget is exceeded |
| `MAX_SPEND_USD` | x402 budget cap | Caps paid actions like realm generation, regeneration, inn rest, and stat rerolls |
| `SPENDING_WINDOW` | `total`, `daily`, or `hourly` | `daily` / `hourly` sleep until reset; `total` behaves like a hard cap |

### Lobby Cleanup Rules

`AUTO_SELL_JUNK` is intentionally conservative, but it is now character-aware:

- it sells class-incompatible items when the template metadata marks them as sellable
- it discards incompatible items when the template cannot be sold
- it uses `class_restriction`, `ammo_type`, item type, and sell price from `/content/items`
- it still keeps protected items such as healing consumables, portal escapes, and key items

The fallback logic still does **not** try to do full economic optimization. Compatible gear is not sold just because it looks weak, and consumables with useful effects are kept unless a higher-level policy explicitly says otherwise.

## Local Debug Inspector

The browser viewer now has two modes:

- `spectate` (default) uses the redacted public spectator feed, matching what a normal watcher should see.
- `debug` is dev-only and streams the full local `Observation` payload for the selected live run.

Use `http://localhost:3002/?mode=debug` when you need to validate feature completeness during local agent runs. The debug inspector exposes:

- inventory and equipped items
- legal actions available on the current turn
- active buffs and debuffs
- full HP/resource values, gold, XP, and skill points
- the same live map/entities/events panels as spectator mode

This split is intentional: spectator mode stays aligned with the real game's redacted view, while debug mode gives you the player-side state needed to verify agent support for chests, loot, consumables, equipment, and other gameplay systems.

## Contributing

1. Fork this repository
2. Create a feature branch
3. Write tests first (red/green TDD)
4. Run `bun test` and `bun run typecheck` before submitting
5. If you change vendored types, run `bun run scripts/sync-sdk-types.ts`

## License

MIT
