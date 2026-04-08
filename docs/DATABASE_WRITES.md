# Adventure.fun — Database & Session Architecture

> **Priority: HIGH** — Current implementation has unsustainable per-turn DB writes, no session lifecycle management, and no horizontal scaling support. Server auto-scales on Railway.

---

## 1. Current Problems

### Problem A: `realm_mutations` is being misused as an action log

**File:** `backend/src/game/session.ts` lines 122-130

**Current behavior:** Every turn writes a row to `realm_mutations`, including movement, waits, and actions that produce no world state change.

**What `realm_mutations` is supposed to be:** A table of permanent world state deltas — things that change the dungeon for future re-entry. An enemy killed, a chest opened, a door unlocked, a trap triggered, an item picked up. These are the mutations that, combined with the deterministic seed, reconstruct the current state of a dungeon when a player re-enters.

**Current code:**

```typescript
// session.ts:122-130 — WRONG: writes every action
await db.from("realm_mutations").insert({
  realm_instance_id: realmId,
  entity_id: `turn_${currentTurn}`,   // wrong: should be f1_r2_enemy_01
  mutation: eventType,                 // wrong: always "action_taken"
  turn: currentTurn,
  floor: realm.floor_reached,
  metadata: eventPayload,
})
```

Three things are wrong:
- `entity_id` should reference a generated world entity (`f1_r2_enemy_01`, `f1_r1_chest_01`), not a turn number
- `mutation` should describe what changed (`killed`, `opened`, `looted`), not that an action was taken
- Movement, waits, misses, and non-lethal hits produce zero world state change and should never be stored here

### Problem B: Every action also writes to `run_events`

**File:** `backend/src/game/session.ts` lines 132-138

```typescript
// session.ts:132-138 — WRONG: writes every action to a second table
await db.from("run_events").insert({
  realm_instance_id: realmId,
  turn: currentTurn,
  event_type: eventType,
  payload: eventPayload,
})
```

This doubles the per-turn write volume. The `run_events` table should be replaced entirely (see section 4).

### Problem C: Turn count derived from mutation row count

**File:** `backend/src/game/session.ts` lines 104, 163

```typescript
const currentTurn = (mutations?.length ?? 0) + 1  // processTurn line 104
const turn = (mutations?.length ?? 0) + 1          // buildObservation line 163
```

Once mutations become sparse (only world state changes), this gives wrong turn numbers. A player who walks 10 tiles then kills an enemy would get `turn: 1` for the kill instead of `turn: 11`.

### Problem D: Per-turn database reads don't scale

**File:** `backend/src/game/session.ts` lines 93-97, 147-159

`processTurn()` queries 3 tables (realm_instances, characters, realm_mutations), then calls `buildObservation()` which queries 4 tables (characters, realm_instances, inventory_items, realm_mutations). That's **7 DB reads per turn**. At 1,000 players with 2s turns, that's 3,500 reads/sec.

### Problem E: No session lifecycle

**File:** `backend/src/game/session.ts` line 76-79

```typescript
export function handleGameClose(ws: ServerWebSocket<GameSessionData>) {
  clearTurnTimer(ws)
  activeSessions.delete(ws.data.characterId)
}
```

On disconnect, death, or extraction — no event buffer flush, no character state save, no run log write, no realm status update, no leaderboard update. If Railway kills an instance during scale-down, all in-memory state is silently lost.

### Problem F: `buildObservation` is hardcoded

**File:** `backend/src/game/session.ts` lines 174-223

Returns `visible_tiles: []`, hardcoded `legal_actions`, fake position `{x: 3, y: 3}`, empty `known_map`. It never uses the generated realm or mutations to compute real game state. This blocks real gameplay but is a separate issue from the write optimization — noted here for completeness.

### Problem G: No `resolveTurn()` in the engine

The engine has `resolveAttack()` (`shared/engine/src/combat.ts`) and `generateRealm()` (`shared/engine/src/realm.ts`), but no `resolveTurn()` function that takes an action and returns world mutations + new state. The session's `processTurn` has a `TODO: full turn resolution` comment (line 107). The architecture described in this document assumes `resolveTurn()` exists.

### Write Volume at Scale

| Scenario | Current Writes/Sec | Target Writes/Sec |
|---|---|---|
| 1 player, 30s turns | 0.06 (2 per turn) | ~0.01 |
| 100 players, 2s turns | 100 | ~2-3 |
| 1,000 players, 2s turns | 1,000 | ~25-35 |

---

## 2. What Realm Mutations Should Look Like

### Correct Usage

`realm_mutations` records **only** events that permanently change the generated world state. When a player re-enters a dungeon, the engine:

1. Regenerates the base dungeon from seed + template version
2. Loads all `realm_mutations` for that instance
3. Applies each mutation to the generated state (remove killed enemy, mark chest opened, etc.)
4. Result: player sees the dungeon exactly as they left it

### Correct Examples

```
id | entity_id          | mutation  | turn | floor | metadata
1  | f1_r2_enemy_01     | killed    | 8    | 1     | {"xp_awarded": 10, "loot_dropped": "health-potion"}
2  | f1_r2_chest_01     | opened    | 10   | 1     | {"items_granted": ["health-potion", "health-potion"], "gold_granted": 15}
3  | f1_r1_chest_01     | opened    | 3    | 1     | {"items_granted": ["weapon-iron-sword"]}
4  | f2_r4_door_01      | unlocked  | 22   | 2     | {"key_consumed": "crypt-key"}
5  | f2_r5_enemy_02     | killed    | 28   | 2     | {"xp_awarded": 25}
6  | f1_r2_interact_01  | used      | 11   | 1     | {"lore_discovered": "cellar-warning-01"}
```

### What Produces a Mutation

| Action Result | Mutation Type | Entity ID Format |
|---|---|---|
| Enemy killed | `killed` | `f{floor}_r{room}_enemy_{index}` |
| Chest opened | `opened` | `f{floor}_r{room}_chest_{index}` |
| Trapped chest triggered | `trap_triggered` | `f{floor}_r{room}_chest_{index}` |
| Door unlocked | `unlocked` | `f{floor}_r{room}_door_{index}` |
| Item picked up from world | `looted` | `f{floor}_r{room}_item_{index}` |
| Interactable used (fire_once) | `used` | `f{floor}_r{room}_interact_{index}` |
| Lore discovered | `discovered` | `f{floor}_r{room}_lore_{index}` |

**Note:** The engine's `generateRealm()` (`shared/engine/src/realm.ts`) produces entity IDs with the room template ID embedded — e.g. `f1_r2_encounter_01_enemy_00`, not `f1_r2_enemy_01`. Mutation `entity_id` values must match what `generateRealm` actually produces.

### What Does NOT Produce a Mutation

- Player movement (no world state change)
- Player waiting (no world state change)
- Combat damage that doesn't kill (enemy HP is transient session state, not persisted per-hit)
- Using a consumable from inventory (inventory table handles this)
- Equipping/unequipping items (inventory table handles this)
- Inspecting an entity (read-only, no change)
- Missed attacks (nothing changed)
- Enemy movement (transient session state)

### Expected Volume

A typical dungeon run through the tutorial (2 rooms) should produce approximately:
- 1 mutation: chest opened (weapon)
- 1 mutation: enemy killed (rat)
- 1 mutation: chest opened (supplies)
- 1 mutation (optional): interactable used (wall scratches)

**Total: 3-4 mutations for the entire run.** Not 30+ rows of action logging.

A full run through The Sunken Crypt (12-15 rooms, 3 floors) might produce 25-40 mutations total.

---

## 3. In-Memory Session Architecture

The current `session.ts` is stateless — it re-queries the database on every turn. This must change to an in-memory session model.

### Target Design

```typescript
class GameSession {
  // Identity
  readonly realmId: string
  readonly characterId: string
  readonly serverId: string          // Railway instance ID

  // In-memory game state (loaded once on connect, updated per turn)
  private turn: number               // in-memory counter, NOT derived from DB
  private gameState: GameState       // realm, character, position, entities
  private eventBuffer: GameEvent[]   // flushed to run_logs on session end
  private sessionStartedAt: Date

  async processTurn(action: Action) {
    this.turn++

    const result = this.engine.resolveTurn(this.gameState, action)

    // Buffer event in memory — NO database write
    this.eventBuffer.push({
      turn: this.turn,
      action,
      result: result.summary,
      timestamp: Date.now(),
    })

    // Write to DB ONLY if world state changed
    for (const mutation of result.worldMutations) {
      await this.persistMutation(mutation)
    }

    // Update in-memory state
    this.gameState = result.newState

    // Redis: turn counter (every turn), position (every 5 turns or room change)
    await this.redis.incr(`turn:${this.realmId}`)
    if (this.turn % 5 === 0 || result.roomChanged) {
      await this.updateRedisPosition()
    }

    // Redis: spectator fan-out (every turn)
    const spectatorObs = toSpectatorObservation(result.observation)
    await this.broadcaster.publishSpectatorUpdate(this.characterId, spectatorObs)

    // Redis: lobby activity (notable events only)
    for (const event of result.notableEvents) {
      await this.broadcaster.publishLobbyEvent(event)
    }

    // Redis: leaderboard delta (only when XP/level changes)
    if (result.newState.character.xp !== this.gameState.character.xp) {
      await this.broadcaster.publishLeaderboardDelta({
        characterId: this.characterId,
        xp: result.newState.character.xp,
        level: result.newState.character.level,
        deepestFloor: result.newState.position.floor,
      })
    }
  }

  async endSession(reason: 'death' | 'extraction' | 'disconnect') {
    // 1. Write run log to DB (single row)
    await db.from('run_logs').insert({
      realm_instance_id: this.realmId,
      character_id: this.characterId,
      started_at: this.sessionStartedAt,
      ended_at: new Date(),
      end_reason: reason,
      total_turns: this.turn,
      events: JSON.stringify(this.eventBuffer),
      summary: this.buildSummary(),
    })

    // 2. Save character state to DB
    await this.saveCharacterState()

    // 3. Update realm instance in DB
    const realmStatus = reason === 'death' ? 'dead_end'
      : this.gameState.realmStatus === 'boss_cleared' ? 'completed'
      : 'paused'
    await db.from('realm_instances').update({
      status: realmStatus,
      last_turn: this.turn,
      current_room_id: this.gameState.position.room_id,
      tile_x: this.gameState.position.tile.x,
      tile_y: this.gameState.position.tile.y,
      last_active_at: new Date(),
    }).eq('id', this.realmId)

    // 3b. Persist fog-of-war state
    for (const [floor, tiles] of Object.entries(this.gameState.discoveredTiles)) {
      await db.from('realm_discovered_map').upsert({
        realm_instance_id: this.realmId,
        floor: Number(floor),
        discovered_tiles: tiles,
      })
    }

    // 4. Update leaderboard
    await this.updateLeaderboard()

    // 5. Clean up Redis keys: session:{realmId}, turn:{realmId}, pos:{realmId}
    await this.cleanupRedis()
  }
}
```

### Key Principles

- **DB is source of truth** — seed + mutations can always reconstruct world state
- **In-memory is a performance cache** — any server can cold-rebuild from DB
- **Redis is coordination + pub/sub layer** — session locks, turn counters, position checkpoints, spectator fan-out, lobby activity feed

---

## 4. Database Changes

### 4a. Schema Migration

```sql
-- Add session management columns to realm_instances
ALTER TABLE realm_instances ADD COLUMN last_turn INTEGER DEFAULT 0;
ALTER TABLE realm_instances ADD COLUMN last_active_at TIMESTAMPTZ;
ALTER TABLE realm_instances ADD COLUMN current_room_id TEXT;
ALTER TABLE realm_instances ADD COLUMN tile_x INTEGER;
ALTER TABLE realm_instances ADD COLUMN tile_y INTEGER;

-- Run logs — one row per dungeon session (replaces run_events)
CREATE TABLE run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  character_id UUID REFERENCES characters(id) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  end_reason TEXT NOT NULL CHECK (end_reason IN ('death', 'extraction', 'disconnect')),
  total_turns INTEGER NOT NULL,
  events JSONB NOT NULL,              -- full action log as array
  summary JSONB NOT NULL,             -- aggregated stats for quick queries
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_run_logs_character ON run_logs(character_id);
CREATE INDEX idx_run_logs_realm ON run_logs(realm_instance_id);
```

### 4b. Fix `realm_mutations` insert logic

**File:** `backend/src/game/session.ts` lines 122-130

- Gate behind world state changes only — `resolveTurn()` returns a `worldMutations` array, only insert those
- Use deterministic entity IDs from `generateRealm()` output, not `turn_N`
- Use semantic mutation types (`killed`, `opened`, `looted`, `unlocked`, `triggered`, `used`, `discovered`), not `action_taken`
- Piggyback `last_turn` update on realm_instances with each mutation write

### 4c. Stop writing to `run_events`

**File:** `backend/src/game/session.ts` lines 132-138

Remove the `run_events` insert entirely. This table is replaced by `run_logs` (written once on session end). Drop the `run_events` table once confirmed nothing reads from it.

### 4d. Add `endSession()` DB writes

On session end (death, extraction, disconnect), write to DB:

| Write | Table | Frequency |
|---|---|---|
| Run log | `run_logs` | 1 per run |
| Character state | `characters` (HP, XP, gold, level) | 1 per run |
| Realm instance | `realm_instances` (status, last_turn, position, last_active_at) | 1 per run |
| Leaderboard entry | `leaderboard_entries` | 1 per run |
| Corpse container | `corpse_containers` + `inventory_items` | 1 per death |
| Lore discovered | `lore_discovered` | 1-5 per run |
| Hall of fame | `hall_of_fame` | 0-1 per run |

### 4e. Position + turn + fog-of-war persistence for cold rebuild

When a player reconnects to a different Railway instance, that server has no in-memory state. It must cold-rebuild:

1. Load `realm_instances` row → get seed, template, `last_turn`, `current_room_id`, `tile_x`, `tile_y`
2. Load `realm_mutations` → get all world state deltas
3. Load `realm_discovered_map` → get fog-of-war state per floor
4. Call `generateRealm(seed)` → rebuild base world
5. Apply mutations → remove killed enemies, mark opened chests
6. Apply discovered tiles → restore fog of war
7. Place player at persisted position
8. Resume from `last_turn + 1`

The new `realm_instances` columns (`last_turn`, `current_room_id`, `tile_x`, `tile_y`) are updated:
- On every mutation write (piggyback, no extra round trip)
- On session end
- On periodic checkpoint (every floor change)

The `realm_discovered_map` table (already exists in schema) is updated:
- On session end (flush accumulated discovered tiles from in-memory `GameState.discoveredTiles`)
- On floor change (new floor row inserted)
- Currently the table is created with `discovered_tiles: []` on realm generation and **never updated** — this must be fixed

### 4f. `run_logs` summary object

The `summary` JSONB contains pre-aggregated stats so you never need to parse the full event log:

```json
{
  "enemies_killed": 5,
  "damage_dealt": 347,
  "damage_taken": 128,
  "rooms_explored": 8,
  "chests_opened": 3,
  "items_found": ["health-potion", "iron-sword-uncommon"],
  "gold_earned": 45,
  "xp_earned": 120,
  "deepest_floor": 2,
  "cause_of_death": "Skeleton Warrior",
  "death_location": { "floor": 2, "room": "sc-gallery", "tile": { "x": 5, "y": 3 } },
  "abilities_used": { "knight-slash": 12, "knight-shield-block": 4, "basic-attack": 8 },
  "potions_consumed": 2,
  "turns_in_combat": 18,
  "turns_exploring": 22
}
```

Powers: legend pages, hall of fame, leaderboard detail views, death cards.

---

## 5. Redis Layer

Redis handles high-frequency transient state and cross-server coordination. None of this data is authoritative — the DB can always reconstruct from seed + mutations.

### 5a. Session Locking

**Problem:** Railway auto-scales to N instances. If a player disconnects and reconnects to a different server, two servers could hold state for the same realm simultaneously.

**Key:** `session:{realmId}`
**Value:** `{ serverId, characterId, claimedAt }`
**TTL:** 60 seconds, refreshed every 30 seconds via heartbeat

**Connect flow:**
1. Check `session:{realmId}` in Redis
2. If **no lock** → claim immediately (SET with NX + 60s TTL)
3. If **locked by this server** → resume (reconnect to same instance)
4. If **locked by another server AND lock is stale** (`claimedAt` older than 30s with no heartbeat refresh) → force-claim (overwrite the key)
5. If **locked by another server AND lock is fresh** → reject the WebSocket connection with `{ error: "session_active_elsewhere" }`. The client shows "Session active on another server" and retries on a short interval.

**Why not wait-and-retry:** A silent 2s wait is fragile — if the old server is alive and mid-turn, 2s may not be enough. If it's dead, you're waiting for nothing. Force-claiming stale locks and rejecting fresh ones is deterministic and doesn't block the connect handler.

**Heartbeat ownership check:** The heartbeat must verify ownership before refreshing. On each tick:
1. GET `session:{realmId}` → check `serverId`
2. If `serverId` matches this server → refresh TTL (EXPIRE)
3. If `serverId` does NOT match (another server force-claimed) → call `endSession('disconnect')`, stop heartbeat, clean up in-memory state

A blind `EXPIRE` without checking ownership would incorrectly extend a lock that's been taken over.

**Crash recovery:** If a server dies without cleanup, the heartbeat stops, the lock becomes stale (>30s old), and the next connect attempt force-claims it.

### 5b. Turn Counter

**Key:** `turn:{realmId}`
**Value:** integer (current turn number)
**TTL:** 1 hour

Incremented via `INCR` on every action. Cheap and atomic. If Redis loses this, recover from `realm_instances.last_turn` (updated with each mutation write).

### 5c. Player Position

**Key:** `pos:{realmId}`
**Value:** `{ floor, room_id, tile_x, tile_y }`
**TTL:** 1 hour

Updated every 5 turns or on room change (not every move). Per-move updates would produce ~500 Redis writes/sec at scale for data that's only needed on crash recovery. Since position is also written to the DB on every mutation (piggyback) and on session end, the worst case on crash is the player restarts a few tiles back in the same room — not worth the write volume to prevent.

### 5d. Event Buffer Checkpoint — DEFERRED (not v1)

Replay UI is deferred and losing the event buffer on crash is explicitly acceptable for v1. Skip the Redis event checkpoint entirely — write the buffer to `run_logs` on session end and accept that a crash loses replay data for that session segment. Add this later if crash frequency becomes an issue.

When implemented (post-v1):
- **Key:** `events:{realmId}`
- **Value:** serialized event array
- **TTL:** 1 hour
- Written every 10 turns

### 5e. Cross-Server Session Handoff

Session handoff uses the stale-check + force-claim pattern (section 5a), not pub/sub. When a player reconnects to Server B while Server A holds a stale lock:

1. Server B detects stale lock (`claimedAt` >30s with no heartbeat refresh)
2. Server B force-claims by overwriting the Redis key
3. Server B cold-rebuilds from DB
4. Server A's heartbeat detects it no longer owns the lock → calls `endSession('disconnect')` to flush state

If Server A is dead, its heartbeat never runs and there's nothing to flush. The world state is intact (mutations were written immediately) and Server B proceeds normally.

If the lock is fresh (Server A is alive and active), Server B rejects the connection — the client retries. This avoids the complexity of coordinated handoff via pub/sub.

### 5f. Spectator Pub/Sub

**Channel:** `spectate:{characterId}`
**Payload:** `SpectatorObservation` (redacted observation — no fog-of-war reveals, no inventory details)

After each turn resolves, the server publishes a redacted observation to this channel. Spectator WebSocket connections subscribe and fan out. See `BACKEND.md` section on real-time pub/sub for the `RealtimeBroadcaster` interface and `toSpectatorObservation()` redaction function.

**Channel:** `lobby:activity`
**Payload:** `LobbyEvent` (notable events — deaths, boss kills, completions)

Published only for notable events, not every turn. Powers the lobby activity feed.

### 5g. Redis Key/Channel Summary

| Key/Channel Pattern | Updated | TTL | Fallback if Lost |
|---|---|---|---|
| `session:{realmId}` | Every 30s (heartbeat) | 60s | Lock becomes stale, next connect force-claims |
| `turn:{realmId}` | Every action | 1h | `realm_instances.last_turn` |
| `pos:{realmId}` | Every 5 turns or room change | 1h | `realm_instances` position columns |
| `spectate:{characterId}` | Every turn (PUBLISH) | N/A (pub/sub) | Spectators see stale state until next turn |
| `lobby:activity` | On notable events (PUBLISH) | N/A (pub/sub) | Lobby feed misses that event |
| `leaderboard:updates` | On XP/level change (PUBLISH) | N/A (pub/sub) | Leaderboard UI shows stale data until next poll |
| `events:{realmId}` | Deferred (not v1) | — | Event buffer lost on crash (acceptable v1) |

---

## 6. Session Lifecycle Flows

### Connect (WebSocket open)

```
1. Check Redis session lock
   - If no lock → claim (SET NX with 60s TTL)
   - If locked by this server → resume (reconnect to same instance)
   - If locked by another server AND stale (>30s) → force-claim (overwrite)
   - If locked by another server AND fresh → reject with "session_active_elsewhere"
     (client shows error, retries on interval)
2. Start heartbeat interval (refresh lock TTL every 30s)
3. Guard realm status:
   - Reject if realm status is "completed" or "dead_end" (must regenerate first)
   - Allow "generated", "active", "paused", "boss_cleared"
   Note: index.ts currently sets status to "active" unconditionally — add this guard
4. Load state:
   - If reconnect to same server → use in-memory state
   - If cold rebuild → load from DB:
     a. realm_instances (seed, template, last_turn, position)
     b. realm_mutations (world state deltas)
     c. realm_discovered_map (fog-of-war tiles per floor)
     d. characters (HP, XP, gold, stats)
     e. inventory_items
     f. generateRealm(seed) + apply mutations + apply discovered tiles
     g. Set turn = realm_instances.last_turn
5. Send initial observation to client
6. Start turn timer
```

### Per Turn

```
1.  Receive action from client
2.  Clear turn timer
3.  Increment in-memory turn counter
4.  INCR turn:{realmId} in Redis
5.  engine.resolveTurn(state, action) → { newState, worldMutations, summary }
6.  Push event to in-memory eventBuffer (NO db write)
7.  For each worldMutation:
    a. INSERT into realm_mutations (entity_id, mutation, turn, floor, metadata)
    b. UPDATE realm_instances SET last_turn, position columns (piggyback)
8.  Every 5 turns or on room change: update pos:{realmId} in Redis
9.  Update in-memory gameState = newState
10. Build observation from in-memory state
11. Send observation to player via WebSocket
12. Publish spectator update:
    a. toSpectatorObservation(observation) → redacted observation
    b. Redis PUBLISH "spectate:{characterId}" → fan-out to spectator WS connections
13. If notable event (death, boss kill, realm completion):
    a. Redis PUBLISH "lobby:activity" → fan-out to lobby feed
14. If XP/level changed:
    a. Redis PUBLISH "leaderboard:updates" → fan-out to leaderboard UI
15. Start turn timer
```

### Session End (death, extraction, disconnect)

```
1.  Determine reason: death | extraction | disconnect
2.  Write run_logs row (single JSONB blob with full event history + summary)
3.  Save character state to characters table
4.  Update realm_instances (status, last_turn, position, last_active_at)
5.  Upsert realm_discovered_map (fog-of-war tiles per floor)
6.  Update leaderboard_entries
7.  If death: create corpse_container, move inventory items to corpse
8.  If death or boss kill or realm completion:
    Redis PUBLISH "lobby:activity" → notable event to lobby feed
9.  If notable: insert hall_of_fame entry
10. Insert lore_discovered entries
11. Delete Redis keys: session:{realmId}, turn:{realmId}, pos:{realmId}
12. Remove from activeSessions map
13. Close WebSocket
```

### Server Crash (no cleanup runs)

```
1. Redis heartbeat stops → session lock becomes stale after 30s
2. In-memory event buffer is lost (replay data for this session segment gone — acceptable v1)
3. World state is intact — realm_mutations were written immediately to DB
4. Player reconnects → new server detects stale lock, force-claims it
5. Cold rebuild from DB: seed + mutations + last persisted turn/position
6. Player resumes from last persisted state (may be a few tiles back if no recent mutation)
```

---

## 7. Engine Changes Required

### 7a. Build `resolveTurn()` function

**Location:** `shared/engine/src/` (new file, e.g. `turn.ts`)

The engine currently has no turn resolution function. `session.ts` line 107 has `TODO: full turn resolution`. This function must:

- Accept current `GameState` + `Action`
- Return `{ newState, worldMutations, summary, observation }`
- `worldMutations` is an array — empty for moves/waits, populated for kills/chest opens/etc.
- Each mutation includes the deterministic `entity_id` from `generateRealm()` output
- `summary` is a human-readable description for the event buffer

### 7b. Entity ID consistency

The engine's `generateRealm()` produces entity IDs with embedded room template IDs:

```
f1_r2_encounter_01_enemy_00     (not f1_r2_enemy_01)
f1_r2_encounter_01_chest_00     (not f1_r2_chest_01)
f1_r2_encounter_01_trap_00      (not f1_r2_trap_01)
f1_r2_encounter_01_loot_00      (not f1_r2_loot_01)
```

Mutation `entity_id` values written to `realm_mutations` must use these exact IDs from the generated realm, not the simplified format shown in section 2's examples. The important thing is that the IDs match between `generateRealm()` output and `realm_mutations` rows — otherwise the seed + delta reconstruction model breaks.

---

## 8. What NOT to Change

- The `realm_mutations` table schema itself is fine — `entity_id`, `mutation`, `turn`, `floor`, `metadata` are the right columns
- The realm re-entry model (load seed + apply mutations) is the right design
- The concept of logging actions for future replay is correct — just the storage mechanism changes (per-turn DB writes → in-memory buffer → single DB row on session end)
- The `activeSessions` Map pattern for tracking live WebSockets is fine — extend it, don't replace it

---

## 9. Implementation Checklist

### Phase 1 — Stop the bleeding + engine foundation (critical, do first)

These two workstreams run in parallel. Phase 1a is a quick surgical fix. Phase 1b is the engine work that Phase 2 depends on — without `resolveTurn()`, the in-memory session has nothing to call.

**1a. Remove broken writes (can be done immediately):**

Phase 1a is about stopping the damage, not producing correct mutations. Correct mutations require `resolveTurn()` from Phase 1b to know what world state changed, what entity was affected, and what mutation type to use. Until Phase 1b is done, there is no source of truth for this information.

- [ ] **Remove `realm_mutations` insert** entirely (`session.ts:122-130`) — correct mutations will be re-added in Phase 2 when `resolveTurn()` provides `worldMutations[]`
- [ ] **Remove `run_events` insert** entirely (`session.ts:132-138`) — replaced by in-memory event buffer + `run_logs` on session end

**1b. Engine turn resolution (parallel with 1a):**

- [ ] **Build `resolveTurn()`** — accepts GameState + Action, returns `{ newState, worldMutations, summary, observation }` (`shared/engine/src/turn.ts`)
- [ ] **Make `buildObservation()` use real state** — use generated realm + mutations instead of hardcoded tiles/actions
- [ ] **Verify entity ID consistency** — ensure mutation entity_ids match `generateRealm()` output exactly
- [ ] **Implement `toSpectatorObservation()`** — redacted observation for spectator fan-out (see `BACKEND.md` spec)

### Phase 2 — In-memory session + lifecycle (depends on Phase 1b)

- [ ] **Refactor session.ts to a stateful `GameSession` class** — replaces current stateless functions
- [ ] **Add in-memory turn counter** — stop deriving from `mutations.length` (`session.ts:104,163`)
- [ ] **Add in-memory event buffer** — push every turn, flush on session end
- [ ] **Hold game state in memory** — load once on connect using `GameState` type from schemas, stop re-querying 7 tables per turn (`session.ts:93-97,147-159`)
- [ ] **Track discovered tiles in memory** — update `GameState.discoveredTiles` as player explores, persist to `realm_discovered_map` on session end and floor change
- [ ] **Build `endSession()`** — writes run_logs, saves character, updates realm_instances, upserts discovered_map, updates leaderboard, handles corpse on death. Status logic: death → `dead_end`, boss_cleared + extraction → `completed`, else → `paused`
- [ ] **Add realm status guard to WebSocket upgrade** (`index.ts:83-88`) — reject connections to `completed`/`dead_end` realms, don't unconditionally set `active`
- [ ] **Wire `handleGameClose()` to call `endSession('disconnect')`** — currently a no-op (`session.ts:76-79`)
- [ ] **Wire death/extraction paths to call `endSession()`** — currently just sends WS message and closes (`session.ts:58-70`)

### Phase 3 — Database migration (can run in parallel with Phase 2)

- [ ] **Run schema migration** — add columns to `realm_instances`, create `run_logs` table (see section 4a)
- [ ] **Drop `run_events` table** — after confirming nothing reads from it
- [ ] **Backfill `last_turn`** — set to `MAX(turn)` from existing `realm_mutations` per instance, or 0

### Phase 4 — Redis integration + horizontal scaling (depends on Phase 2)

- [ ] **Add Redis client** to the backend
- [ ] **Implement session locking** — `session:{realmId}` with stale-check + force-claim (see section 5a)
- [ ] **Implement heartbeat** — refresh lock TTL every 30s
- [ ] **Implement turn counter** in Redis — `INCR turn:{realmId}`
- [ ] **Implement position tracking** in Redis — `pos:{realmId}`, every 5 turns or room change
- [ ] **Implement spectator pub/sub** — `PUBLISH spectate:{characterId}` with redacted observation every turn
- [ ] **Implement lobby activity pub/sub** — `PUBLISH lobby:activity` on notable events (death, boss kill, completion)
- [ ] **Implement leaderboard delta pub/sub** — `PUBLISH leaderboard:updates` on XP/level changes (see `BACKEND.md` spec)
- [ ] **Implement cold rebuild** — on connect, if no in-memory state, rebuild from DB (seed + mutations + discovered_map + character)

### Dependency Order

```
Phase 1a ─────────────────────────────────►
Phase 1b ─────────────────────────────────►
                                           ├─► Phase 2 ──────────────────►
Phase 3  ─────────────────────────────────────────────────────────────────►
                                                                          ├─► Phase 4
```

- **Phase 1a** (fix writes) and **Phase 1b** (engine) have no dependencies — start both immediately
- **Phase 2** (in-memory session) depends on Phase 1b — `processTurn()` calls `resolveTurn()` which must exist
- **Phase 3** (DB migration) can run anytime, no code dependency
- **Phase 4** (Redis) depends on Phase 2 — session class must exist to add Redis coordination
