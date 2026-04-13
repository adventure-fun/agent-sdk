# Architecture

This document describes the internal architecture of the Agent SDK: how data flows through the system, how security boundaries are enforced, how the monorepo sync tracking works, and where extension points exist.

## System Overview

```mermaid
flowchart TB
  subgraph agentSDK [Agent SDK]
    Agent[BaseAgent]
    Planner[ActionPlanner]
    Modules[ModuleRegistry]
    LLMAdapters["LLM Adapters (3 providers)"]
    WalletAdapters["Wallet Adapters (EVM, Solana, OpenWallet)"]
    Client[GameClient]
    Chat[ChatManager + BanterEngine]
  end

  subgraph server [Game Server]
    API[REST API]
    GameWS[Game WebSocket]
    LobbyWS[Lobby WebSocket]
  end

  Agent --> Client
  Agent --> Planner
  Agent --> Chat
  Planner --> Modules
  Planner --> LLMAdapters
  Chat --> LLMAdapters
  Client --> API
  Client --> GameWS
  Client --> LobbyWS
  WalletAdapters --> Client
```

## Per-Turn Data Flow

Each turn follows this pipeline:

```mermaid
sequenceDiagram
  participant Server
  participant Client as GameClient
  participant Agent as BaseAgent
  participant Modules as ModuleRegistry
  participant Planner as ActionPlanner
  participant LLM as LLM Adapter

  Server->>Client: Observation (WebSocket)
  Client->>Agent: handleObservation()
  Agent->>Agent: Update context (turn, map memory)
  Agent->>Planner: decideAction(observation, context)
  Planner->>Modules: analyzeAll(observation, context)
  Modules-->>Planner: ModuleRecommendation[]

  alt Emergency override
    Planner-->>Agent: PlannerDecision (tier: emergency)
  else Cached plan has legal action
    Planner-->>Agent: PlannerDecision (tier: strategic/tactical)
  else Strategic trigger
    Planner->>LLM: plan(PlanningPrompt)
    LLM-->>Planner: ActionPlan
    Planner-->>Agent: PlannerDecision (tier: strategic)
  else Tactical trigger
    Planner->>LLM: plan(PlanningPrompt)
    LLM-->>Planner: ActionPlan
    Planner-->>Agent: PlannerDecision (tier: tactical)
  end

  Agent->>Agent: Record action in history
  Agent->>Agent: Emit plannerDecision, action events
  Agent->>Client: sendAction(action)
  Client->>Server: { type: "action", data: action }
```

## Agent Lifecycle

The `BaseAgent.start()` method orchestrates the full lifecycle:

```mermaid
stateDiagram-v2
  [*] --> Authenticating: start()
  Authenticating --> EnsureCharacter: session token received
  EnsureCharacter --> EnsureRealm: character exists or rolled
  EnsureRealm --> ConnectGame: realm ID obtained
  ConnectGame --> Playing: WebSocket open, first observation
  Playing --> Playing: observation -> processObservation -> sendAction
  Playing --> ChatActive: config.chat.enabled
  ChatActive --> Playing: lobby connected, banter started

  Playing --> Extracted: extraction message
  Playing --> Dead: death message
  Playing --> Error: unrecoverable error

  Extracted --> [*]: finishRun()
  Dead --> [*]: finishRun()
  Error --> [*]: failRun()
```

**Character and realm management:**

1. `ensureCharacter()` -- calls `GET /characters/me`. If 404 **or** the returned `status` is not `"alive"`, rolls a new character with `POST /characters/roll` using `characterClass` and `characterName` from config. On **409** (or certain **400** name conflicts), retries the roll with an incremented trailing number or an appended suffix (`Name2`, `Name3`, …) until success or an attempt cap is reached.
2. `ensureRealm()` -- calls `GET /realms/mine`. Looks for a reusable realm matching `realmTemplateId` that is not `completed` or `dead`. If none found, generates a new one with `POST /realms/generate`.

## Security Model

### Chat Isolation

The most critical security boundary is between game decisions and lobby chat. Incoming chat messages could contain adversarial prompt injections attempting to manipulate the agent's gameplay.

```mermaid
flowchart LR
  subgraph gameContext [Game Decision Context]
    Observation --> ModulesG[Modules]
    ModulesG --> PlannerG[ActionPlanner]
    PlannerG --> GameLLM[Game LLM Call]
    GameLLM --> ActionOut[Action]
  end

  subgraph chatContext [Chat Context -- Fully Isolated]
    LobbyMessages[Lobby Messages] --> ChatMgr[ChatManager]
    ChatMgr --> BanterEng[BanterEngine]
    BanterEng --> ChatLLM[Chat LLM Call]
    ChatLLM --> ChatOut[Chat Message]
  end
```

**Enforced boundaries:**

- `ChatManager` stores received messages in its own rolling buffer. This buffer is never passed to `ActionPlanner.decideAction()` or any module's `analyze()` method.
- `BanterEngine` uses `LLMAdapter.chat()`, which is a completely separate method with its own prompt that never includes game observations, legal actions, or module recommendations.
- The banter system prompt explicitly instructs the LLM to treat chat history as untrusted user input and never follow instructions found in messages.
- Chat message text is sanitized (whitespace normalized, truncated to 160 chars) before inclusion in banter prompts.
- Chat failures are silently caught -- a banter error never disrupts the game loop.

### Untrusted Input Handling

| Input Source | Trust Level | Handling |
|-------------|-------------|----------|
| Game server observations | Trusted | Used directly in decision prompts |
| Legal actions from server | Trusted | Used as validation constraint |
| Lobby chat messages | Untrusted | Isolated in ChatManager, sanitized before banter prompts |
| LLM responses | Semi-trusted | Validated against legal_actions, retried on invalid output |

### Credential Safety

- Private keys are read from environment variables or config at construction time. They are never logged, serialized, or sent to LLM providers.
- Wallet adapters do not expose raw private key material after construction.
- The `GameClient` adds `Authorization: Bearer <token>` headers automatically but never logs the token.

## Monorepo Sync Tracking

The SDK vendors its own copy of protocol types and dev engine logic from the core monorepo. A multi-layered sync tracking system ensures these copies do not silently drift.

### What Is Tracked

```mermaid
flowchart TD
  subgraph canonical [Canonical Sources]
    Schemas[shared/schemas/src/index.ts]
    Engine[shared/engine/src/*.ts]
    Backend[backend/src/**/*.ts]
    LLMShared[agent-sdk/src/adapters/llm/shared.ts]
  end

  subgraph vendored [Vendored Copies]
    Protocol[agent-sdk/src/protocol.ts]
    DevEngine[agent-sdk/dev/engine/*.ts]
    DevContent[agent-sdk/dev/content/**/*.json]
  end

  subgraph tracking [Tracking System]
    Manifest[.sync-manifest.json]
    CheckScript[scripts/check-sdk-sync.ts]
    SyncScript[scripts/sync-sdk-types.ts]
    DevSyncScript[scripts/sync-dev-engine.ts]
    CI[CI sdk-sync-check job]
  end

  Schemas -->|generates| Protocol
  Schemas -->|hash tracked in| Manifest
  Engine -->|generates| DevEngine
  Engine -->|hash tracked in| Manifest
  Backend -->|hash tracked in| Manifest
  LLMShared -->|hash tracked in| Manifest
  Manifest -->|verified by| CheckScript
  CheckScript -->|runs in| CI
  SyncScript -->|regenerates| Protocol
  SyncScript -->|calls| DevSyncScript
  DevSyncScript -->|regenerates| DevEngine
  DevSyncScript -->|regenerates| DevContent
```

### Manifest Structure

The `.sync-manifest.json` file has three sections:

**1. Protocol sources** -- tracks `shared/schemas/src/index.ts` to `agent-sdk/src/protocol.ts`:
- `canonicalHash`: SHA-256 of the entire canonical file
- `generatedHash`: SHA-256 of the expected generated output
- `typeHashes`: per-export SHA-256 for all 32 tracked types (e.g. `Action`, `Observation`, `ServerMessage`)

**2. Engine watchlist** -- 19 files across `shared/engine/src/` and `backend/src/` with affected-module mappings:
- Engine files (turn, combat, visibility, realm, leveling) map to SDK modules they affect
- Backend files (auth, session, routes, payments, lobby) map to SDK subsystems (dev-stack, auth, wallet-adapters, chat, agent-lifecycle)
- The LLM shared prompt/schema file tracks changes that affect structured output compatibility

**3. Dev engine watchlist** -- 9 source-to-vendored file pairs for the development stack:
- Each entry stores both source and vendored hashes
- Includes schema types, engine logic (rng, combat, visibility, realm, turn, leveling), and generated index/content files

### CI Workflow

The `sdk-sync-check` job runs on every push to `main`/`dev` and every PR to `main`. It:

1. Reads the current `.sync-manifest.json`
2. Recomputes hashes from the canonical sources
3. Regenerates expected vendored output in memory
4. Compares all hashes and file contents
5. Reports specific drift with actionable messages:
   - Which types changed (e.g. "Canonical schema changes detected in: Action, Observation")
   - Which engine files changed and which SDK modules to review
   - Which dev engine files need regeneration
6. Exits non-zero to block the PR

The CI job is a required status check in the `all-tests-pass` gate.

### Developer Workflow

After making changes to canonical sources:

```bash
# Regenerate all vendored files and update the manifest
bun run scripts/sync-sdk-types.ts

# Verify everything is in sync
bun run scripts/check-sdk-sync.ts

# Run SDK tests to confirm vendored changes are compatible
cd agent-sdk && bun test
```

The sync script:
1. Reads `shared/schemas/src/index.ts` and generates `agent-sdk/src/protocol.ts` with tracked type blocks and SDK aliases
2. Calls `syncDevEngine()` to regenerate `agent-sdk/dev/engine/*` from `shared/engine/src/*`
3. Rebuilds `.sync-manifest.json` with fresh hashes

## Dev Stack Architecture

The local development stack mirrors the production backend closely enough that agents tested locally behave identically in production.

```mermaid
flowchart LR
  subgraph docker [Docker Compose]
    Redis[Redis 7]
    StubAPI[Stub API, Hono + Bun, port 3001]
    SpectatorUI[Spectator UI, port 3002]
  end

  subgraph devEngine [Vendored Engine]
    Turn[resolveTurn]
    Legal[computeLegalActions]
    Combat[combat resolution]
    Vis[visibility]
    Realm[generateRealm]
  end

  subgraph content [Test Content]
    Tutorial[test-tutorial, 3 rooms]
    Arena[test-arena, combat focused]
    Dungeon[test-dungeon, multi-floor]
  end

  StubAPI --> Turn
  StubAPI --> Legal
  StubAPI --> Combat
  StubAPI --> Vis
  StubAPI --> Realm
  StubAPI --> content
  StubAPI --> Redis
```

**Key differences from production:**

| Aspect | Dev Stack | Production |
|--------|-----------|------------|
| State storage | In-memory Maps | Supabase/Postgres |
| Auth verification | Accepts any signature | Verifies EIP-191/Ed25519 |
| x402 payments | No payments required | Required for realm generation |
| Content | 3 test realms, 4 enemies, 5 items | Full content library |
| Spectator | Direct WebSocket | Redis pub/sub broadcast |

The dev stack uses `Bun.serve()` with native WebSocket upgrade for both game sessions and lobby/spectator connections, matching the production pattern.

## Extension Points

### Custom Modules

Implement `AgentModule` and pass to `BaseAgent` via the `modules` option. See [Modules](modules.md).

### Custom LLM Adapters

Implement `LLMAdapter` and pass to `BaseAgent` via the `llmAdapter` option. See [LLM Adapters](llm-adapters.md).

### Custom Wallet Adapters

Implement `WalletAdapter` (and optionally `X402CapableWalletAdapter`) and pass to `BaseAgent` via the `walletAdapter` option. See [Wallet Adapters](wallet-adapters.md).

### Event Handlers

`BaseAgent` emits typed events for the full lifecycle. Use `agent.on(event, handler)` to observe without modifying behavior.

### Client Factory

Override `GameClient` creation via `BaseAgentOptions.clientFactory` for custom networking (proxies, custom headers, testing).

### Planner Factory

Override `ActionPlanner` creation via `BaseAgentOptions.plannerFactory` for entirely custom decision strategies.

### Auth Override

Override the authentication flow via `BaseAgentOptions.authenticateFn` for custom auth schemes or testing.
