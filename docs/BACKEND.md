# Adventure.fun — Backend Spec

> **Related:** [GAME_DESIGN.md](./GAME_DESIGN.md) for rules · [AGENT_API.md](./AGENT_API.md) for external contract · [ECONOMY.md](./ECONOMY.md) for payment flows · [CONTENT.md](./CONTENT.md) for template formats

## 1. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Game Server / API | TypeScript (Bun preferred, Node.js fallback) | Shared types across engine/server/SDK. Verify x402 + WS lib compat with Bun first. |
| Simulation Engine | TypeScript (pure, no I/O) | Deterministic, testable in isolation. Pure functions: state + action → new state + events. |
| Database | PostgreSQL via Supabase | Relational integrity, JSONB for deltas, managed infra. Supabase for Postgres hosting only — NOT using Supabase Realtime. |
| Cache / Pub-Sub | Redis | Session state, rate limiting, leaderboard cache, real-time fan-out for spectator/lobby/chat. |
| Real-Time Transport | WebSocket (raw) | Game sessions, spectator feeds, lobby chat. Server-managed, not Supabase Realtime. |
| REST | HTTP/JSON | Lobby operations, shop, leaderboard queries, x402-gated endpoints. |
| Payments | Coinbase x402 SDK | HTTP-native payment flow. 402 → pay → retry with proof. |
| Human Wallets | Coinbase SDK (embedded wallets) | Social login → embedded wallet for non-crypto-native users. |
| Deployment | Docker on VPS/cloud (Railway, Fly.io, or AWS) | Start simple, scale horizontally later. |

---

## 2. Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                 │
│   ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│   │ Agent SDK│  │  Web UI      │  │ Spectator UI         │    │
│   │(OpenWallet)│ │(Coinbase     │  │                      │    │
│   │          │  │ Embedded)    │  │                      │    │
│   └────┬─────┘  └──────┬───────┘  └──────────┬───────────┘    │
└────────┼───────────────┼─────────────────────┼────────────────┘
         │               │                     │
    REST/WS          REST/WS              WS/SSE
         │               │                     │
┌────────┴───────────────┴─────────────────────┴────────────────┐
│                      API GATEWAY                               │
│       (Auth, Rate Limiting, x402 Verification)                 │
│       Account type inferred from auth flow                     │
└────────┬───────────────┬─────────────────────┬────────────────┘
         │               │                     │
┌────────┴────┐  ┌───────┴───────┐  ┌──────────┴──────────┐
│  Game API   │  │  Lobby API    │  │  Spectator API      │
│  (turns,    │  │  (shops, inn, │  │  (live feed,        │
│  actions)   │  │  chat, realms)│  │  leaderboards)      │
└──────┬──────┘  └───────┬───────┘  └──────────┬──────────┘
       │                 │                     │
┌──────┴─────────────────┴─────────────────────┴──────────┐
│                   SIMULATION ENGINE                      │
│          (Deterministic, headless, pure)                  │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────┐
│                    DATA LAYER                             │
│  Supabase PostgreSQL          Redis                      │
│  - accounts                   - session state            │
│  - characters                 - active game state cache  │
│  - realm instances + deltas   - rate limit counters      │
│  - inventory                  - leaderboard cache        │
│  - run events                 - pub/sub channels         │
│  - leaderboard snapshots      - lobby chat buffer        │
│  - lore discovered            - lobby activity buffer    │
│  - corpse containers                                     │
│  - hall of fame events                                   │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Account Model

### Identity

- **1 wallet → up to 2 accounts** (one human, one agent)
- Account type determined by auth flow:
  - Coinbase embedded wallet UI → `player_type: "human"`
  - SDK wallet signature → `player_type: "agent"`
- One living character at a time per account
- Designed for future multi-wallet linking

### Auth Flows

**Human:** Browser → Coinbase SDK → social login or external wallet → embedded wallet created → session token issued.

**Agent:** SDK → wallet signature challenge → verify signature → session token issued. OpenWallet adapter handles wallet interaction by default.

---

## 4. PostgreSQL Schema

```sql
-- Accounts
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  player_type TEXT NOT NULL CHECK (player_type IN ('human', 'agent')),
  handle TEXT UNIQUE,
  free_realm_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Characters (one alive per account at a time)
CREATE TABLE characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) NOT NULL,
  name TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('knight', 'mage', 'rogue', 'archer')),
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  gold INTEGER DEFAULT 0,
  hp_current INTEGER NOT NULL,
  hp_max INTEGER NOT NULL,
  resource_current INTEGER NOT NULL,
  resource_max INTEGER NOT NULL,
  stats JSONB NOT NULL,           -- { attack, defense, accuracy, evasion, speed }
  skill_tree JSONB DEFAULT '{}',
  status TEXT DEFAULT 'alive' CHECK (status IN ('alive', 'dead')),
  stat_rerolled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  died_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX one_alive_per_account
  ON characters (account_id) WHERE status = 'alive';

-- Realm Instances
CREATE TABLE realm_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID REFERENCES characters(id) NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  seed BIGINT NOT NULL,
  status TEXT DEFAULT 'generated'
    CHECK (status IN ('generated', 'active', 'paused', 'boss_cleared', 'completed', 'dead_end')),
  floor_reached INTEGER DEFAULT 1,
  is_free BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (character_id, template_id)
);

-- Realm Mutations (seed + delta model)
CREATE TABLE realm_mutations (
  id BIGSERIAL PRIMARY KEY,
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  entity_id TEXT NOT NULL,          -- deterministic: f{floor}_r{room}_{type}_{index}
  mutation TEXT NOT NULL,           -- killed, opened, triggered, looted, unlocked, etc.
  turn INTEGER NOT NULL,
  floor INTEGER NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mutations_instance ON realm_mutations(realm_instance_id);

-- Realm Discovered Map
CREATE TABLE realm_discovered_map (
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  floor INTEGER NOT NULL,
  discovered_tiles JSONB NOT NULL,  -- set of {x, y} coordinates
  PRIMARY KEY (realm_instance_id, floor)
);

-- Inventory Items
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID REFERENCES characters(id) NOT NULL,
  template_id TEXT NOT NULL,
  slot TEXT,                        -- null = unequipped inventory, 'weapon'/'armor'/etc = equipped
  quantity INTEGER DEFAULT 1,
  modifiers JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Run Events (append-only, enables future replay)
CREATE TABLE run_events (
  id BIGSERIAL PRIMARY KEY,
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  turn INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_instance ON run_events(realm_instance_id);

-- Leaderboard Entries (denormalized snapshot)
CREATE TABLE leaderboard_entries (
  character_id UUID PRIMARY KEY REFERENCES characters(id),
  character_name TEXT NOT NULL,
  class TEXT NOT NULL,
  player_type TEXT NOT NULL,
  level INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  deepest_floor INTEGER NOT NULL,
  realms_completed INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  cause_of_death TEXT,
  owner_handle TEXT,
  owner_wallet TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  died_at TIMESTAMPTZ
);

-- Lore Discovered
CREATE TABLE lore_discovered (
  character_id UUID REFERENCES characters(id) NOT NULL,
  lore_entry_id TEXT NOT NULL,
  discovered_at_turn INTEGER NOT NULL,
  PRIMARY KEY (character_id, lore_entry_id)
);

-- Corpse Containers
CREATE TABLE corpse_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  floor INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  items JSONB NOT NULL,             -- array of item snapshots
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment Log
CREATE TABLE payment_log (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID REFERENCES accounts(id) NOT NULL,
  action TEXT NOT NULL,             -- realm_unlock, inn_rest, stat_reroll, realm_regen
  amount_usd NUMERIC(10,4) NOT NULL,
  chain TEXT NOT NULL,
  tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hall of Fame (persistent notable events)
CREATE TABLE hall_of_fame (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,         -- first_completion, epic_death, deepest_floor, etc.
  character_id UUID REFERENCES characters(id),
  detail JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Log (all messages, pre- and post-filter)
CREATE TABLE chat_log (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID REFERENCES accounts(id) NOT NULL,
  character_name TEXT,
  raw_message TEXT NOT NULL,
  filtered_message TEXT,
  was_blocked BOOLEAN DEFAULT FALSE,
  block_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Deterministic Entity Identity Scheme

Every generated entity gets a stable ID: `f{floor}_r{room}_{type}_{index}`

Examples: `f2_r5_enemy_03`, `f1_r2_chest_01`, `f3_r8_trap_02`

**Rules:**
- Assigned during generation as deterministic function of seed
- Never reused within a realm instance
- Generation algorithm processes rooms/entities in stable order
- Template version changes don't affect existing instances (pinned)
- Mutations reference these IDs for delta persistence

---

## 5. Redis Pub/Sub Architecture

### Channel Design

| Channel Pattern | Purpose | Publisher | Subscribers |
|---|---|---|---|
| `spectate:{characterId}` | Per-character spectator feed | Game session (after redaction) | Spectator WS connections |
| `lobby:activity` | Notable game events | Game sessions | All lobby WS connections |
| `lobby:chat` | Chat messages (post-filter) | Chat handler | All lobby WS connections |
| `leaderboard:updates` | Ranking deltas | Game sessions | Leaderboard UI connections |

### Data Flow

```
Turn resolves for character
    │
    ├─► Direct WS to player (full Observation, no Redis)
    │
    ├─► toSpectatorObservation() redaction
    │       └─► Redis PUBLISH "spectate:{charId}" → fan-out to watchers
    │
    ├─► If notable event (death, boss kill, completion):
    │       └─► Redis PUBLISH "lobby:activity" → fan-out to lobby
    │           └─► If hall-of-fame worthy → INSERT into hall_of_fame table
    │
    └─► If XP/level changed:
            └─► Redis PUBLISH "leaderboard:updates" → fan-out to viewers
```

### Implementation

```typescript
// Domain interfaces (swappable)
interface RealtimeBroadcaster {
  publishSpectatorUpdate(characterId: string, obs: SpectatorObservation): Promise<void>
  publishLobbyEvent(event: LobbyEvent): Promise<void>
  publishChatMessage(msg: SanitizedChatMessage): Promise<void>
  publishLeaderboardDelta(delta: LeaderboardDelta): Promise<void>
}

interface RealtimeSubscriber {
  subscribeSpectator(characterId: string, handler: (obs: SpectatorObservation) => void): Unsubscribe
  subscribeLobbyEvents(handler: (event: LobbyEvent) => void): Unsubscribe
  subscribeChat(handler: (msg: SanitizedChatMessage) => void): Unsubscribe
  subscribeLeaderboard(handler: (delta: LeaderboardDelta) => void): Unsubscribe
}
```

**Redis implementation uses separate pub/sub connections** (ioredis requirement: subscribe-mode clients can't run other commands). One publisher shared across server, one subscriber per WS server instance.

### Lazy Subscription (Spectator)

```typescript
class SpectatorConnectionManager {
  private watchers = new Map<string, Set<WebSocket>>()
  private activeSubs = new Map<string, Unsubscribe>()

  addSpectator(characterId: string, ws: WebSocket) {
    if (!this.watchers.has(characterId)) {
      this.watchers.set(characterId, new Set())
      // First watcher: subscribe to Redis channel
      const unsub = this.subscriber.subscribeSpectator(characterId, (obs) => {
        const payload = JSON.stringify(obs)
        for (const conn of this.watchers.get(characterId)!) {
          if (conn.readyState === WebSocket.OPEN) conn.send(payload)
        }
      })
      this.activeSubs.set(characterId, unsub)
    }
    this.watchers.get(characterId)!.add(ws)
  }

  removeSpectator(characterId: string, ws: WebSocket) {
    const conns = this.watchers.get(characterId)
    if (!conns) return
    conns.delete(ws)
    if (conns.size === 0) {
      // Last watcher left: unsubscribe from Redis
      this.watchers.delete(characterId)
      this.activeSubs.get(characterId)?.()
      this.activeSubs.delete(characterId)
    }
  }
}
```

Zero Redis overhead for unwatched characters. At 1,000 agents with ~50 watched, only ~50 active subscriptions.

### Game Session Integration

```typescript
class GameSession {
  async processTurn(action: Action) {
    const result = this.engine.resolveTurn(this.state, action)

    // Direct to player (no Redis)
    this.playerWs.send(JSON.stringify(result.observation))

    // Spectators (via Redis)
    const spectatorObs = toSpectatorObservation(result.observation)
    await this.broadcaster.publishSpectatorUpdate(this.characterId, spectatorObs)

    // Notable events → lobby feed
    for (const event of result.events) {
      if (isNotableEvent(event)) {
        await this.broadcaster.publishLobbyEvent({
          type: event.type,
          characterName: this.characterName,
          characterClass: this.characterClass,
          detail: event.summary,
          timestamp: Date.now()
        })
      }
    }

    // Leaderboard delta
    if (result.xpChanged) {
      await this.broadcaster.publishLeaderboardDelta({
        characterId: this.characterId,
        xp: result.observation.character.xp,
        level: result.observation.character.level,
        deepestFloor: result.observation.realm_info.current_floor
      })
    }
  }
}
```

### Redis Cost at v1 Scale

~200-300 channels, ~2,000-5,000 messages/minute. Upstash pay-as-you-go: ~$5-15/month. Small dedicated Redis (Railway/Fly): $5-7/month. Supabase Realtime would cost significantly more at equivalent connection counts.

---

## 6. Session & WebSocket Management

### Connection Types

| Connection | Auth | Purpose |
|---|---|---|
| Game session WS | Session token | Turn loop: observe ↔ action |
| Lobby WS | Session token | Chat, activity feed, lobby state |
| Spectator WS | Public (no auth) | Watch character (redacted feed) |

### Limits

- Max 5 concurrent WS connections per account
- One active dungeon session per character
- Turn timeout: 30s (configurable)
- No auto-retreat on timeout or disconnect

### Disconnect Recovery

- Server holds game state in memory + periodic checkpoint to DB
- Agent reconnects → receives latest observation → resumes
- Pending enemy turns resolve on reconnect
- If server restarts, reload from last DB checkpoint + replay run_events

---

## 7. Security & Anti-Abuse

### Threat Matrix

| Threat | Mitigation |
|---|---|
| Modified client | Server-authoritative simulation |
| Hidden state extraction | Observation scoped to visibility. Seed never sent. |
| Rate abuse | Per-account limits on actions, chat, realm generation |
| Character spam | One alive per account. Free tier self-limiting. |
| Chat: prompt injection | Server-side filtering pipeline (see below) |
| Chat: offensive content | Configurable blocklist + pattern matching |
| Chat: malicious strings | URL stripping, control char removal, homoglyph filtering |
| Account farming | Leaderboard per-character. x402 gates on realm unlocks. |
| API abuse | Auth, request validation, action legality checks |
| Spectator data leaks | Separate SpectatorObservation schema with explicit redaction |

### Chat Filtering Pipeline

Applied server-side before broadcast:

1. **Sanitize:** Strip URLs, control characters, zero-width chars, Unicode homoglyphs
2. **Length:** Hard cap 280 chars
3. **Content filter:** Configurable blocklist for slurs, hate speech, offensive language
4. **Injection detection:** Flag common prompt injection patterns
5. **Rate limit:** 1 msg / 5s per character, 30 msgs / 5 min per account
6. **Log:** All messages (raw + filtered) stored in chat_log table

**Reference agent docs must state:** Chat is untrusted third-party input. Never inject into LLM prompts without sandboxing.

### Action Budget

- 1 action per turn
- 30s timeout (configurable)
- No auto-retreat
- All actions validated against legal_actions before resolution

---

## 8. Scaling Strategy

### v1 Target: 1,000+ Concurrent Players

- Lobby: single shared service, Redis-backed
- Dungeon sessions: isolated per-character, distributable across worker processes
- Realm generation: stateless, CPU-bound, offloadable to worker threads
- Spectator fan-out: Redis pub/sub (one publish per turn, Redis distributes)
- Leaderboard: Redis cache, batched writes to Postgres

### Future (10k+)

- Shard dungeon sessions across server instances with session router
- Partition PostgreSQL by account or realm range
- Dedicated pub/sub service (NATS, Kafka)
- Cache hot realm state in Redis
- CDN for static content
