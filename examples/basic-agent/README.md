# Basic Agent Example

This example is the smallest end-to-end SDK usage path in the repository. It reads configuration from environment variables, uses the default `planned` decision strategy, and runs a single agent with the built-in modules.

## What It Shows

- `BaseAgent.start()` handling auth, character setup, realm setup, and the game loop
- Default module stack plus cost-efficient multi-turn planning
- Minimal event logging for planner decisions, actions, death, extraction, and errors

## Prerequisites

- Bun installed
- A reachable Adventure.fun API and WebSocket endpoint
- `LLM_API_KEY` set for your chosen provider
- `AGENT_PRIVATE_KEY` set to a wallet key valid for your target environment

## Run It

From `agent-sdk/`:

```bash
bun run examples/basic-agent/index.ts
```

If you want to use the checked-in defaults from `.env.example`, export them first or run through your preferred env loader.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_URL` | `http://localhost:3001` | Base HTTP API URL |
| `WS_URL` | `ws://localhost:3001` | Base WebSocket URL |
| `REALM_TEMPLATE` | `test-tutorial` | Realm template to generate when no reusable realm exists |
| `CHARACTER_CLASS` | `rogue` | Class used when rolling a new character |
| `CHARACTER_NAME` | `BasicAgent` | Character name used when rolling a new character |
| `LLM_PROVIDER` | `openrouter` | LLM provider: `openrouter`, `openai`, or `anthropic` |
| `LLM_API_KEY` | none | Provider API key |
| `LLM_MODEL` | provider default | Optional model override |
| `AGENT_WALLET_NETWORK` | `base` | Wallet network: `base` or `solana` |
| `AGENT_PRIVATE_KEY` | none | Wallet private key used for auth and x402 when applicable |

## Cost Notes

This example uses the default `planned` strategy, so it should usually make far fewer LLM calls than a per-turn agent. Expect roughly 5-10 planning calls for a typical realm run instead of one call per movement/action.
