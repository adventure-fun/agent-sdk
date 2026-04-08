# Adventure.fun — Database Write Optimization

> **Priority: HIGH** — Current implementation will cause unsustainable database load at scale.

## 1. The Problem

Two issues were identified in the current implementation:

### Problem A: `realm_mutations` is being misused as an action log

**Current behavior:** Every turn writes a row to `realm_mutations`, including movement, waits, and actions that produce no world state change.

**What `realm_mutations` is supposed to be:** A table of permanent world state deltas — things that change the dungeon for future re-entry. An enemy killed, a chest opened, a door unlocked, a trap triggered, an item picked up. These are the mutations that, combined with the deterministic seed, reconstruct the current state of a dungeon when a player re-enters.

**Evidence from the database:**

```
id | entity_id | mutation     | turn | metadata
1  | turn_1    | action_taken | 1    | {"turn":1,"action":{"type":"move","direction":...}}
2  | turn_2    | action_taken | 2    | {"turn":2,"action":{"type":"move","direction":...}}
...
15 | turn_15   | action_taken | 15   | {"turn":15,"action":{"type":"wait"}}
16 | turn_16   | action_taken | 16   | {"turn":16,"action":{"type":"wait"}}
```

Every row has `entity_id` set to `turn_N` and mutation set to `action_taken`. This is wrong on multiple levels:

- `entity_id` should reference a generated world entity (`f1_r2_enemy_01`, `f1_r1_chest_01`), not a turn number
- `mutation` should describe what changed (`killed`, `opened`, `looted`, `unlocked`, `triggered`), not that an action was taken
- Wait actions produce zero world change and should never be stored here
- Movement produces zero world change and should never be stored here

### Problem B: Per-turn database writes don't scale

At 1,000 concurrent players taking 1 turn every ~2 seconds, the current design produces **500 writes/second** to the database. Most of these writes are meaningless (movement, waits). This will overwhelm Supabase connection pools and inflate storage costs for data nobody reads during gameplay.

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

A full run through The Sunken Crypt (12-15 rooms, 3 floors) might produce 25-40 mutations total. That's the expected scale — tens of rows per run, not hundreds.

---

## 3. What Happens to Action/Turn Logging

The per-turn action data (what the player did each turn) is **not useless** — it's needed for future replay support and postmortem analysis. But it should not be written to the database on every turn.

### New Design: In-Memory Buffer, Write Once on Session End

During a dungeon session, the game server holds the full game state in memory. The action log should be buffered in the same place:

```typescript
class GameSession {
  private state: GameState
  private eventBuffer: GameEvent[] = []  // accumulates in memory

  async processTurn(action: Action) {
    const result = this.engine.resolveTurn(this.state, action)

    // Buffer the event in memory — NO database write
    this.eventBuffer.push({
      turn: this.state.turn,
      action: action,
      result: result.summary,
      timestamp: Date.now()
    })

    // Write realm mutations ONLY if world state changed
    for (const mutation of result.worldMutations) {
      await this.persistMutation(mutation)  // database write
    }

    // Update in-memory state
    this.state = result.newState
  }

  async endSession(reason: 'death' | 'extraction' | 'disconnect') {
    // Write the ENTIRE run log as a single row
    await db.insert('run_logs', {
      realm_instance_id: this.realmInstanceId,
      character_id: this.characterId,
      started_at: this.sessionStartedAt,
      ended_at: new Date(),
      end_reason: reason,
      total_turns: this.state.turn,
      events: JSON.stringify(this.eventBuffer),  // entire log as one JSONB blob
      summary: this.buildSummary()               // aggregated stats
    })

    // Persist final character state
    await this.saveCharacterState()

    // Update leaderboard
    await this.updateLeaderboard()
  }
}
```

### Run Log Table (Replaces `run_events`)

```sql
-- DROP the per-turn run_events table if it exists
-- DROP TABLE IF EXISTS run_events;

-- New: one row per dungeon session
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

### Summary Object

The `summary` JSONB contains pre-aggregated stats so you never need to parse the full event log for display purposes:

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

This summary powers:
- Legend pages (cause of death, enemies killed, rooms explored)
- Hall of fame (deepest floor, highest damage, most enemies killed)
- Leaderboard detail views
- Death cards (cause of death, items lost, turns survived)

---

## 4. When to Write to the Database During a Session

### Writes That Must Happen Immediately (During Session)

| Write | Why | Frequency |
|---|---|---|
| Realm mutations | Must persist for re-entry if player disconnects | Only on world state change (~20-40 per full run) |

### Writes That Happen on Session End

| Write | Why | Frequency |
|---|---|---|
| Run log | Full action history for replay/analysis | 1 per run |
| Character state | Final HP, XP, gold, inventory, level, position | 1 per run |
| Leaderboard entry | Updated XP, level, deepest floor | 1 per run |
| Corpse container (on death) | Death location + items | 1 per death |
| Lore discovered | New codex entries from this run | 1-5 per run |
| Hall of fame (if notable) | First completions, records broken | 0-1 per run |

### Writes That Can Be Deferred to Periodic Checkpoint

| Write | Why | Frequency |
|---|---|---|
| Character state checkpoint | Safety net if server crashes mid-session | Every 5 minutes or every floor change |
| Event buffer to Redis | Crash recovery for replay data | Every 10 turns (optional) |

---

## 5. Crash Recovery

**Concern:** If the server crashes mid-session, the in-memory event buffer is lost.

**For v1, this is acceptable.** Replay UI is deferred. The player reconnects, gets their last observation (rebuilt from seed + mutations), and continues. They lose the action history for that session segment, but the world state is intact because realm mutations are written immediately.

**If you want crash safety for the event buffer later:** Checkpoint the buffer to Redis every N turns. Redis handles high-frequency writes efficiently. On crash recovery, load the partial buffer from Redis and resume. This is a future enhancement, not a v1 requirement.

---

## 6. Write Volume Comparison

### Current Design (Broken)

| Scenario | Writes/Second | Notes |
|---|---|---|
| 1 player, 30s turns | 0.03 | Barely noticeable |
| 100 players, 2s turns | 50 | Starting to stress Supabase connection pool |
| 1,000 players, 2s turns | 500 | Unsustainable. Connection pool exhaustion, query queueing. |

### Fixed Design

| Scenario | Writes/Second (sustained) | Notes |
|---|---|---|
| 1 player, 30s turns | ~0.01 (mutations only) | Negligible |
| 100 players, 2s turns | ~2-3 (mutations only) | Comfortable |
| 1,000 players, 2s turns | ~20-30 (mutations only) | Well within Supabase limits |
| 1,000 players, runs ending | ~1-2/sec (run logs) | Runs end every 10-20 min, not every turn |

**Total sustained load at 1,000 players: ~25-35 writes/second** vs 500/second. That's a 15-20x reduction.

---

## 7. Changes Required

### Database Changes

1. **Keep `realm_mutations` table** — but fix the insert logic (see below)
2. **Drop or stop writing to `run_events`** — replaced by `run_logs`
3. **Create `run_logs` table** — one row per session with JSONB event blob and summary

### Engine / Server Changes

1. **Fix the turn loop mutation logic:**
   - The engine's `resolveTurn()` function should return a `worldMutations` array
   - This array is empty for movement, waits, misses, and non-lethal damage
   - This array contains entries only for kills, chest opens, door unlocks, item pickups, interactable uses
   - Only items in this array get inserted into `realm_mutations`

2. **Add event buffer to GameSession:**
   - Initialize empty array on session start
   - Push every turn's action + result to the buffer (in memory, no DB)
   - On session end, write the buffer to `run_logs` as JSONB

3. **Fix `entity_id` generation:**
   - Mutations must use deterministic entity IDs from the realm generation (`f1_r2_enemy_01`)
   - Not turn numbers (`turn_1`, `turn_2`)
   - This is critical for the seed + delta model to work on re-entry

4. **Fix `mutation` values:**
   - Use semantic mutation types: `killed`, `opened`, `looted`, `unlocked`, `triggered`, `used`, `discovered`
   - Not generic `action_taken` for everything

5. **Add character state checkpoint:**
   - On session end: full character state save (HP, XP, gold, inventory, position)
   - Optional periodic checkpoint during session (every 5 min or floor change)

### What NOT to Change

- The `realm_mutations` table schema itself is fine — `entity_id`, `mutation`, `turn`, `floor`, `metadata` are the right columns
- The realm re-entry logic (load seed + apply mutations) is the right design
- The concept of logging actions for future replay is correct — just the storage mechanism changes

---

## 8. Implementation Priority

1. **Stop writing movement/wait actions to `realm_mutations`** — this is the most urgent fix. Gate the insert behind a check for actual world state changes.
2. **Fix `entity_id` format** — switch from `turn_N` to the deterministic entity ID scheme (`f{floor}_r{room}_{type}_{index}`).
3. **Add in-memory event buffer** to the game session class.
4. **Create `run_logs` table** and write on session end.
5. **Stop writing to `run_events`** (or drop it entirely if nothing reads from it yet).
6. **Add character state save on session end.**

Steps 1-2 are critical and should be done immediately. Steps 3-6 can follow in the same sprint.
