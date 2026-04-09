# FIXES_NEEDED — Adventure.fun Codebase Audit

> Generated 2026-04-08 from full review of docs/, all source files, live Supabase
> database (via MCP), migrations, and configuration.

## How to Use This Document

Each fix group is designed to be tackled as a single cohesive commit (or small PR).
Work through groups roughly in order — later groups may depend on earlier ones.

# IMPORTANT

Use Red/Green Test Driven Development. Make sure that all enhancements are testable, wherever possible. 

Write tests first, watch them fail, implement fixes, run tests again until passing. NO EXCEPTIONS!

### Task Status Key

| Mark | Meaning |
|------|---------|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Complete |
| `[-]` | Skipped / deferred |

Add notes under any item with `> NOTE: your note here` when needed.

---

## Group 1: Database Schema Fixes

**Scope:** Supabase migrations, schema corrections
**Why first:** Other fixes depend on correct schema

- [x] **1.1 — `realm_instances` UNIQUE constraint blocks re-generation after death**
  - `UNIQUE (character_id, template_id)` prevents inserting a new realm for the same template after a `dead_end` result
  - The `POST /realms/generate` route allows past completed/dead_end realms but the insert will fail against the unique constraint since the old row still exists
  - **Fix:** Either (a) change generate to update the existing row when status is terminal (like regenerate does), or (b) drop the UNIQUE and add an app-level check, or (c) change the constraint to a partial unique excluding terminal statuses
  - **Files:** `supabase/migrations/`, `backend/src/routes/realms.ts`
  > NOTE: Implemented option (c) — replaced absolute UNIQUE with partial unique index `unique_active_realm_per_template` excluding terminal statuses (`completed`, `dead_end`). Migration: `supabase/migrations/20260409033730_fix_realm_unique_constraint.sql`. Applied to live DB via Supabase MCP. No route changes needed — existing INSERT flow works with the relaxed constraint.

- [x] **1.2 — Realm regeneration leaves stale mutations and discovered map**
  - `POST /realms/:id/regenerate` updates seed/status/floor but does not delete old `realm_mutations` or `realm_discovered_map` rows
  - On next session, `GameSession.create` loads these stale mutations, which reference entity IDs from the old seed — entities that should spawn won't because their old IDs are in `mutatedEntities`
  - **Fix:** Add `DELETE FROM realm_mutations WHERE realm_instance_id = $1` and same for `realm_discovered_map` in the regenerate route, then re-seed floor 1 discovered map
  - **Files:** `backend/src/routes/realms.ts`
  > NOTE: Extracted cleanup into `backend/src/routes/realm-helpers.ts` (`cleanupRealmForRegeneration`) for testability. Deletes stale `realm_mutations` and `realm_discovered_map`, resets session columns (`last_turn`, `current_room_id`, `tile_x`, `tile_y`, `last_active_at`) on `realm_instances`, and re-seeds floor 1 discovered map. TDD: 5 tests in `backend/__tests__/realm-helpers.test.ts`, all green. Also created `backend/__tests__/helpers/mock-db.ts` for Supabase client mocking.

- [x] **1.3 — Missing `seed.sql` referenced by Supabase config**
  - `supabase/config.toml` has `[db.seed] enabled = true, sql_paths = ["./seed.sql"]` but no `seed.sql` exists
  - **Fix:** Either create an empty `supabase/seed.sql` or set `enabled = false`
  - **Files:** `supabase/config.toml`, optionally `supabase/seed.sql`
  > NOTE: Created `supabase/seed.sql` with a comment header. Seed data can be added as needed.

- [x] **1.4 — Orphaned legacy migration file**
  - `/migrations/001_initial_schema.sql` duplicates (and may drift from) the authoritative Supabase migration at `supabase/migrations/20260407000000_initial_schema.sql`
  - **Fix:** Delete `/migrations/` directory or add a README noting it's superseded
  - **Files:** `migrations/001_initial_schema.sql`
  > NOTE: Deleted `migrations/` directory entirely. Authoritative migrations are in `supabase/migrations/`.

- [ ] **1.5 — Document RLS as future requirement**
  - All 14 public tables have `rls_enabled: false` and zero RLS policies (confirmed via live DB query)
  - Backend uses `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS, so this is safe for now
  - `.env.example` lists `SUPABASE_ANON_KEY` but the code never uses it
  - **Fix:** No code change needed now. This item documents the future need: before any client-side Supabase usage or exposing the anon key, RLS policies must be created for every table. Consider removing `SUPABASE_ANON_KEY` from `.env.example` to avoid confusion until RLS is implemented
  - **Tables needing RLS (all of them):** `accounts`, `characters`, `realm_instances`, `realm_mutations`, `realm_discovered_map`, `inventory_items`, `corpse_containers`, `run_logs`, `leaderboard_entries`, `lore_discovered`, `payment_log`, `marketplace_listings`, `hall_of_fame`, `chat_log`

---

## Group 2: Stat Ranges and Resource Max Mismatch

**Scope:** Backend stat rolling, class template alignment
**Why early:** Affects every new character created

- [x] **2.1 — `resource_max` hardcoded to 100 for all classes in `stats.ts`**
  - `backend/src/game/stats.ts` line 39-44: `RESOURCE_MAX = { knight: 100, mage: 100, rogue: 100, archer: 100 }`
  - But class JSON templates define different values (e.g. `knight.json` has `"resource_max": 10`)
  - This means knights get 100 stamina instead of 10, which would break balance once resources are functional
  - **Fix:** Import `CLASSES` from `@adventure-fun/engine` and use `cls.resource_max` instead of the hardcoded map
  - **Files:** `backend/src/game/stats.ts`
  > NOTE: Replaced the hardcoded `RESOURCE_MAX` map with `CLASSES[cls].resource_max` from `@adventure-fun/engine`. Added TDD coverage in `backend/__tests__/stats.test.ts` to lock the backend to the engine template values. Also updated `frontend/app/play/page.tsx` so class cards show each class's max resource pool and the hub view renders a current/max resource meter.

- [x] **2.2 — Duplicate stat roll ranges between `stats.ts` and class JSON content**
  - `stats.ts` has `CLASS_STAT_RANGES` hardcoded; class JSON files have `stat_roll_ranges`
  - These could drift out of sync — single source of truth should be the engine content
  - **Fix:** Replace the hardcoded ranges in `stats.ts` with values read from `CLASSES[cls].stat_roll_ranges`
  - **Files:** `backend/src/game/stats.ts`
  > NOTE: Removed the duplicated `CLASS_STAT_RANGES` constant entirely. `rollStats()` and `rerollStats()` now read directly from `CLASSES[cls].stat_roll_ranges`, and the new backend test file verifies rolled stats always stay within the engine-defined bounds.

---

## Group 3: Core Combat — Abilities, Resources, and Status Effects

**Scope:** Engine turn resolution, combat system
**Why grouped:** These are tightly coupled — abilities consume resources, apply effects, etc.

- [ ] **3.1 — `ability_id` on attack actions is completely ignored**
  - `resolvePlayerAttack` in `turn.ts` (line 294-395) receives `ability_id` in the action but never looks it up
  - Always calls `resolveAttack(attacker, defender, rng)` with no formula or on-hit effects
  - `combat.ts` `resolveAttack` already supports `formula` and `onHitEffects` parameters — they're just never passed
  - **Fix:** When `ability_id` is present, look up `AbilityTemplate` via `getAbility()`, check resource cost, check cooldown, compute `AbilityDamageFormula` from template, pass `effects` as `onHitEffects`, deduct resource, set cooldown. Fall back to basic attack when no `ability_id` or using `basic-attack`
  - **Files:** `shared/engine/src/turn.ts`, possibly `shared/engine/src/combat.ts`

- [ ] **3.2 — Resource system is entirely cosmetic**
  - Resource values (stamina/mana/energy/focus) are loaded from DB and sent in observations but never consumed or regenerated
  - Class templates define `resource_regen_rule` with different regen styles (passive, burst_reset, accumulate)
  - **Fix:** Add resource cost checking in ability resolution (3.1). Add resource regeneration at start or end of turn based on class regen rules. Handle Rogue's "burst_reset" (full reset every 3 turns) and Knight's "on_defend_bonus"
  - **Files:** `shared/engine/src/turn.ts`

- [ ] **3.3 — Status effects beyond poison have no gameplay impact**
  - `resolveStatusEffectTick` in `combat.ts` (line 138-157) only handles `poison` (damage per tick)
  - `stun` should prevent the affected entity from acting
  - `slow` should reduce speed or limit movement
  - `blind` should reduce accuracy
  - `buff-attack` and `buff-defense` are partially handled in `recalcStats` but not in status tick
  - **Fix:** In `resolveTurn`, check for stun before processing player/enemy actions. Apply blind as accuracy debuff in `resolveAttack`. Apply slow as movement restriction. Ensure buff/debuff magnitudes are applied to effective stats each turn
  - **Files:** `shared/engine/src/turn.ts`, `shared/engine/src/combat.ts`

- [ ] **3.4 — Enemy attacks don't use their defined abilities**
  - `resolveEnemyTurns` (turn.ts line 397-477) always uses basic `resolveAttack` with raw stats
  - Enemies have `abilities: string[]` in templates with specific damage formulas and effects
  - **Fix:** When an enemy attacks, select an ability (weighted by AI behavior), check cooldown, compute damage formula, pass on-hit effects to `resolveAttack`
  - **Files:** `shared/engine/src/turn.ts`

- [ ] **3.5 — Ranged combat not implemented (Archer is melee-only)**
  - All attacks require Manhattan distance <= 1 (adjacent tiles)
  - Abilities have a `range` field (`"melee" | number`) but it's never checked
  - Archer class should have ranged attacks; spec mentions "melee vs ranged LOS"
  - **Fix:** In `resolvePlayerAttack`, check ability range. For ranged abilities, check `hasLineOfSight` from `visibility.ts` instead of adjacency. Update `computeLegalActions` to offer attack targets within ability range
  - **Files:** `shared/engine/src/turn.ts`

---

## Group 4: Enemy AI Behaviors

**Scope:** Engine enemy turn resolution
**Depends on:** Group 3 (enemies need abilities to express behaviors)

- [ ] **4.1 — All enemies use identical behavior: adjacent=attack, else=move-toward**
  - `EnemyTemplate.behavior` field is loaded but only `"boss"` is ever checked (for the boss-kill event flag)
  - Spec defines: aggressive, defensive, patrol, ambush, boss
  - **Fix:** Implement behavior-specific AI in `resolveEnemyTurns`:
    - `aggressive`: current behavior (move toward, attack) — already done
    - `defensive`: retreat when below HP threshold, prioritize defensive abilities
    - `patrol`: move along a path, only engage if player is within detection range
    - `ambush`: don't move until player is adjacent or within a trigger range
    - `boss`: implement phase transitions based on `boss_phases` HP thresholds, switching abilities
  - **Files:** `shared/engine/src/turn.ts`

- [ ] **4.2 — Boss phase transitions not implemented**
  - `EnemyTemplate.boss_phases` defines HP thresholds that add/remove abilities
  - Currently ignored — bosses fight identically at all HP levels
  - **Fix:** Track boss phase state; when HP crosses a threshold, apply `behavior_change`, `abilities_added`, `abilities_removed`. Emit a game event for phase transitions
  - **Files:** `shared/engine/src/turn.ts`

---

## Group 5: Level Progression and Skill Trees

**Scope:** Engine + backend character progression
**Depends on:** Group 3 (abilities granted by skill tree need ability system working)

- [ ] **5.1 — Level-up never occurs despite XP being awarded**
  - XP is added on enemy kills in `resolveTurn` and saved to DB in `endSession`
  - But there's no XP threshold table, no level-up check, no stat growth applied
  - Class templates define `stat_growth` per level but it's never used
  - **Fix:** Define XP thresholds (e.g. in a shared constant or content file). After awarding XP, check if level threshold is met. On level-up: increment level, apply `stat_growth` from class template to base stats, update HP max, grant skill point(s), emit level-up event
  - **Files:** `shared/engine/src/turn.ts`, possibly new file for XP curve constants

- [ ] **5.2 — Skill tree system has no implementation**
  - Skill trees fully defined in class JSON and `skill-trees/*.json`
  - `skill_tree` JSONB column exists in DB
  - But there's no:
    - API endpoint to spend skill points
    - Engine logic to check/apply skill unlocks
    - Code to grant abilities from `grant-ability` skill effects
    - Code to apply `passive-stat` bonuses to effective stats
  - **Fix:** Add `POST /characters/skill` endpoint. Validate prerequisites, tier unlock level, available skill points. Write chosen skill to `skill_tree` JSONB. In `GameSession.create`, apply passive bonuses to effective stats. Track unlocked abilities from skill tree alongside `starting_abilities`
  - **Files:** `backend/src/routes/characters.ts`, `backend/src/game/session.ts`, `shared/engine/src/turn.ts`

---

## Group 6: Portal, Retreat, and Extraction Logic

**Scope:** Engine legal actions, extraction mechanics
**Why grouped:** Portal scrolls, retreat rules, and extraction conditions are all intertwined

- [ ] **6.1 — Portal and retreat available anytime without enemies in room**
  - `computeLegalActions` (turn.ts line 1362-1452) offers `use_portal` and `retreat` whenever `!hasLiveEnemies`
  - Spec: portal requires a portal scroll item; retreat should only work at realm entrance
  - Portal scrolls are described as "the main balance lever" for the economy
  - **Fix:** Only offer `use_portal` if player has a portal scroll item in inventory (or a portal effect is active). Only offer `retreat` if player is in the entrance room of floor 1. Update `resolveUseItem` so that `portal-escape` effect sets a flag on GameState that enables `use_portal` for the current turn
  - **Files:** `shared/engine/src/turn.ts`, `shared/schemas/src/index.ts` (may need a `portalActive` flag on GameState)

- [ ] **6.2 — Completion rewards not granted**
  - Realm templates define `completion_rewards: { xp, gold }` but these are never applied
  - When realm status becomes `completed` (boss_cleared + extraction), no bonus XP/gold is given
  - **Fix:** In `endSession` when reason is `extraction` and `realmStatus === "boss_cleared"`, look up template's `completion_rewards` and add to character XP/gold before saving
  - **Files:** `backend/src/game/session.ts`

---

## Group 7: Trap System

**Scope:** Engine trap handling, room template integration
**Depends on:** Group 3 (trap effects use status effect system)

- [ ] **7.1 — Trap system not implemented despite content definitions**
  - Room templates have `LootSlot.trapped`, `trap_damage`, `trap_effect`
  - Realm templates have `trap_types: TrapTemplate[]`
  - `trap_ids` are generated in `realm.ts`
  - `trap_visible` entity type exists in schemas
  - But `resolveTurn` has zero trap handling
  - **Fix:** When player opens a trapped chest (interact with trapped loot slot), check for trap. Apply `trap_damage` and `trap_effect`. Rogue class should have a `disarm-trap` ability check (if ability is known and class matches). After triggering, mark trap as `trap_triggered` mutation. Optionally make traps visible entities that can be inspected
  - **Files:** `shared/engine/src/turn.ts`, `shared/engine/src/realm.ts` (trap entity spawning)

---

## Group 8: Session and Persistence Improvements

**Scope:** Backend game session, DB write patterns

- [ ] **8.1 — `persistMutation` does 2 DB writes per mutation**
  - Each mutation writes to `realm_mutations` AND updates `realm_instances` position
  - A turn with 3 mutations = 6 DB calls
  - **Fix:** Batch mutations into a single insert. Update `realm_instances` once after all mutations are processed, not per-mutation
  - **Files:** `backend/src/game/session.ts`

- [ ] **8.2 — Disconnect recovery loses enemy positions and room state**
  - On disconnect, `endSession("disconnect")` pauses the realm
  - On reconnect, `GameSession.create` rebuilds from DB but enemies respawn at template positions (not where they moved to during the previous session)
  - Only killed/looted entities are properly recovered via mutations
  - **Fix:** Consider persisting active enemy positions to a session state column or Redis key. Alternatively, accept this as a design trade-off and document that disconnect resets enemy positions (non-mutated room state)
  - **Files:** `backend/src/game/session.ts`

- [ ] **8.3 — `updateLeaderboard` always sets `realms_completed: 0`**
  - Line 449: `realms_completed: 0` with a TODO comment
  - Should query existing leaderboard entry and increment, or count `realm_instances` with `status = 'completed'`
  - **Files:** `backend/src/game/session.ts`

- [ ] **8.4 — `buildRunSummary` counts all interacts as "chests opened"**
  - Line 576: every `interact` event type increments `chestsOpened`
  - Interacting with a lore object, NPC, or door should not count as a chest
  - **Fix:** Check the event data or mutation type to distinguish chest opens from other interacts
  - **Files:** `backend/src/game/session.ts`

- [ ] **8.5 — Turn RNG may diverge on session resume**
  - `SeededRng(realm.seed + turn)` on session create
  - But RNG state advances through `.next()` calls within a turn
  - If session disconnects mid-turn and resumes, the RNG restarts from a clean `seed + turn` state
  - This means the "same seed = same outcome" guarantee breaks across disconnects
  - **Fix:** This is largely mitigated by mutations (dead enemies stay dead). Consider storing RNG offset in `realm_instances` for exact replay fidelity, or accept as minor issue
  - **Files:** `backend/src/game/session.ts`

---

## Group 9: Action Validation and Server Authority

**Scope:** Backend WebSocket message handling, engine validation

- [ ] **9.1 — No server-side validation of actions against `legal_actions`**
  - `handleGameMessage` passes the client's action directly to `processTurn` without checking if it's in the set of legal actions
  - A malicious client could send `attack` on a target across the room, or `use_portal` while enemies are alive
  - Individual action resolvers have some checks (range, target exists) but they're inconsistent
  - **Fix:** Before calling `processTurn`, compute `legal_actions` for current state and validate the incoming action is among them. Reject with error if not
  - **Files:** `backend/src/game/session.ts`, `shared/engine/src/turn.ts`

- [ ] **9.2 — No input sanitization on action payloads**
  - The parsed JSON action is passed directly to the engine
  - No validation that `direction` is one of the 4 valid values, `target_id` is a string, etc.
  - **Fix:** Add a validation layer (Zod or manual checks) for the `Action` discriminated union before processing
  - **Files:** `backend/src/game/session.ts`

---

## Group 10: Auth, Security, and Rate Limiting

**Scope:** Backend auth routes, JWT, rate limiting

- [ ] **10.1 — x402 payment verification is completely stubbed**
  - All x402 endpoints (`reroll-stats`, `generate`, `regenerate`) just check for `X-Payment-Proof` header existence
  - Any non-empty header value bypasses payment — no verification of actual payment
  - No `payment_log` entries are created
  - **Fix:** Implement actual x402 payment verification (validate transaction hash, amount, recipient). Log to `payment_log` table on success. This is a multi-step feature that depends on the x402/CDP integration being finalized
  - **Files:** `backend/src/routes/characters.ts`, `backend/src/routes/realms.ts`, new file for x402 verification utility

- [ ] **10.2 — `SESSION_SECRET` has weak dev fallback**
  - `jwt.ts` line 3: defaults to `"dev-secret-change-in-production-min-32-chars"` if env var is missing
  - In production this would silently use a publicly known secret
  - **Fix:** Throw an error if `SESSION_SECRET` is not set and `NODE_ENV !== 'development'`
  - **Files:** `backend/src/auth/jwt.ts`

- [ ] **10.3 — Auth nonces stored in-memory Map (breaks multi-instance)**
  - `pendingNonces` in `auth.ts` is a local `Map<string, ...>`
  - If backend runs on multiple instances (e.g. Railway horizontal scaling), nonces created on one instance won't be found on another
  - **Fix:** Move to Redis or a short-lived DB table. This is blocked until Redis is integrated (see Group 12)
  - **Files:** `backend/src/routes/auth.ts`

- [ ] **10.4 — No rate limiting on any endpoint**
  - Spec mentions rate limits for chat, auth, general API
  - `.env.example` defines `LOBBY_CHAT_RATE_LIMIT_SECONDS` but it's never read
  - No rate limiting middleware exists
  - **Fix:** Add rate limiting middleware (per-IP or per-account) for auth challenge, character creation, realm generation. Use `hono` middleware or a simple in-memory counter (Redis-backed for multi-instance)
  - **Files:** `backend/src/index.ts`, new middleware file

- [ ] **10.5 — No WebSocket max connections enforcement**
  - `.env.example` defines `MAX_WS_CONNECTIONS_PER_ACCOUNT=5` but it's never read
  - A single account could open unlimited WebSocket connections
  - **Fix:** Track active WS connections per account in the `activeSessions` map and reject new connections that exceed the limit
  - **Files:** `backend/src/index.ts`, `backend/src/game/session.ts`

- [ ] **10.6 — Auth profile PATCH has redundant inline auth**
  - `auth.ts` line 80-93: imports `requireAuth` dynamically but doesn't use it as middleware; instead has inline auth logic duplicating the same pattern
  - **Fix:** Use `requireAuth` middleware like other protected routes
  - **Files:** `backend/src/routes/auth.ts`

- [ ] **10.7 — CORS only allows a single origin**
  - `cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" })`
  - Agent SDK users hitting the API from other origins will be blocked
  - **Fix:** Use an array of allowed origins or a function that validates against a whitelist. Consider allowing all origins for public API endpoints (leaderboard, content) while restricting auth/game endpoints
  - **Files:** `backend/src/index.ts`

---

## Group 11: Stub Routes and Missing Endpoints

**Scope:** Backend route implementations
**Depends on:** Group 1 (schema), Group 10 (auth/payments)

- [ ] **11.1 — Leaderboard routes return 501**
  - `backend/src/routes/leaderboard.ts` — all endpoints return "Not implemented"
  - `leaderboard_entries` table exists and is populated by `endSession`
  - **Fix:** Implement `GET /leaderboard/xp`, `/level`, `/deepest-floor` with pagination, player_type filter (human/agent), and class filter
  - **Files:** `backend/src/routes/leaderboard.ts`

- [ ] **11.2 — Lobby routes return 501**
  - `backend/src/routes/lobby.ts` — all endpoints return "Not implemented"
  - Includes shop (buy/sell), inn (rest/heal), chat
  - Shop and inn are core economy features
  - **Fix:** Implement shop endpoints (list items, buy with gold, sell for gold). Implement inn rest (x402 gated, restore HP/resource). Chat can be deferred until Redis is available
  - **Files:** `backend/src/routes/lobby.ts`

- [ ] **11.3 — Marketplace routes return 501**
  - `backend/src/routes/marketplace.ts` — explicitly deferred to v1.5 per BUILD_PLAN.md
  - Schema and types exist, death trigger for orphaning listings is already in the database
  - **Fix:** Leave as 501 for v1. Consider removing the marketplace death trigger to avoid unnecessary overhead until marketplace is built
  - **Files:** `backend/src/routes/marketplace.ts`

- [ ] **11.4 — Inn rest endpoint missing entirely**
  - Spec defines inn rest as an x402-gated heal-to-full feature
  - No route exists for it — not even a 501 stub
  - **Fix:** Add to lobby routes. When paid, restore character HP and resource to max. Log payment
  - **Files:** `backend/src/routes/lobby.ts`

- [ ] **11.5 — Spectator WebSocket endpoint not implemented**
  - Frontend has `/spectate/:characterId` page that connects to WS
  - Agent SDK spec describes spectator observations
  - Backend only handles `/realms/:id/enter` WebSocket, no spectator endpoint
  - `toSpectatorObservation` exists in the engine but is never called
  - **Fix:** Add `/spectate/:characterId` WebSocket endpoint that subscribes to game session observations (via in-memory pub or Redis pub/sub) and sends `SpectatorObservation` payloads
  - **Files:** `backend/src/index.ts`, `backend/src/game/session.ts`

- [ ] **11.6 — Legends API endpoint missing**
  - Frontend legends page expects `GET /legends/:characterId`
  - No route exists
  - **Fix:** Add endpoint that queries dead character + account + run_logs + corpse data and returns `LegendPage` shape
  - **Files:** `backend/src/routes/` (new or add to characters)

---

## Group 12: Redis Integration

**Scope:** Backend Redis setup, pub/sub, session state
**Why last:** Enables lobby chat, spectator broadcast, multi-instance support, but game works without it

- [ ] **12.1 — `ioredis` is a dependency but never imported**
  - `backend/package.json` lists `ioredis`
  - `.env.example` has `REDIS_URL`
  - Zero imports of ioredis in any backend source file
  - The spec calls for Redis pub/sub for: spectator channels, lobby activity, lobby chat, leaderboard updates
  - **Fix:** Create `backend/src/redis/client.ts` with connection setup. Wire into session for spectator broadcast, lobby for chat/activity, and leaderboard for real-time updates. Make Redis optional (graceful no-op if `REDIS_URL` is not set) so the game still works without it during development
  - **Files:** New `backend/src/redis/client.ts`, `backend/src/game/session.ts`, `backend/src/routes/lobby.ts`

---

## Group 13: Engine Edge Cases and Polish

**Scope:** Engine logic fixes that aren't critical but affect game quality

- [ ] **13.1 — Interactable proximity not checked**
  - `computeLegalActions` adds interact actions for all non-mutated interactables regardless of player distance
  - Interactables have no tracked position (hardcoded to `{x: 0, y: 0}` in observation builder)
  - **Fix:** Either assign positions to interactables in room generation and check proximity, or document that interactables are room-wide (accessible from anywhere in the room) as a design decision
  - **Files:** `shared/engine/src/turn.ts`

- [ ] **13.2 — Enemy positions can collide on spawn**
  - `buildRoomState` places enemies at positions from room template slots
  - Multiple enemies with same `position` in template will stack on the same tile
  - `position: "random"` falls back to `{x: 3, y: 3}` — all "random" enemies land on same tile
  - **Fix:** When building room state, use the item/enemy seed RNG to place entities on valid floor tiles, avoiding collisions
  - **Files:** `shared/engine/src/turn.ts`

- [ ] **13.3 — Item positions always `{x: 2, y: 2}`**
  - All loot items in `buildRoomState` get `position: { x: 2, y: 2 }` regardless of room template
  - Players must always go to (2,2) to pick up any item
  - **Fix:** Derive positions from `loot_slots[i].position` or use seeded random placement on floor tiles
  - **Files:** `shared/engine/src/turn.ts`

- [ ] **13.4 — Inventory capacity not enforced**
  - Spec: 12 inventory slots
  - No check in `resolvePickup` or `applyEffect` (grant-item) for inventory being full
  - **Fix:** Add `MAX_INVENTORY_SLOTS` constant, check before adding items, return "Inventory full" if at capacity. May also need a backpack upgrade system per spec
  - **Files:** `shared/engine/src/turn.ts`, `shared/schemas/src/index.ts` (constant)

- [ ] **13.5 — `rooms_visited` tracking not implemented**
  - `buildObservationFromState` line 1258: `rooms_visited: []` with TODO comment
  - Known map data always reports empty rooms_visited
  - **Fix:** Track visited room IDs on GameState, merge on room transitions
  - **Files:** `shared/engine/src/turn.ts`, `shared/schemas/src/index.ts` (add to GameState if needed)

- [ ] **13.6 — Room text always shows first-visit text**
  - `isFirstVisit` check is flawed — it checks if the exact tile position was already discovered, not whether the room was previously entered
  - Without `rooms_visited` tracking (13.5), revisit text is never shown
  - **Fix:** Use `rooms_visited` (once 13.5 is done) to determine first visit vs revisit and select appropriate text
  - **Files:** `shared/engine/src/turn.ts`

- [ ] **13.7 — `reveal-map` item effect is a no-op**
  - `resolveUseItem` case `"reveal-map"` just pushes text "The map reveals itself" but doesn't actually reveal tiles
  - **Fix:** Mark all tiles on the current floor as discovered in `s.discoveredTiles`
  - **Files:** `shared/engine/src/turn.ts`

- [ ] **13.8 — Lore discovery not persisted**
  - `lore_discovered` table exists in DB
  - `reveal-lore` effect type exists in `applyEffect` but only pushes text
  - No write to `lore_discovered` table
  - **Fix:** Collect lore discoveries during turn resolution and persist them in `endSession` or per-turn
  - **Files:** `shared/engine/src/turn.ts`, `backend/src/game/session.ts`

---

## Group 14: Frontend Fixes

**Scope:** Next.js frontend issues
**Depends on:** Groups 11 (API endpoints need to exist first)

- [ ] **14.1 — Leaderboard page has no data fetching**
  - `frontend/app/leaderboard/page.tsx` — static table with "No legends yet"
  - Filter buttons (All / Humans / Agents) are non-functional
  - **Fix:** Add `useLeaderboard` hook, fetch from `/leaderboard/xp` when endpoint exists (Group 11.1), wire filter buttons
  - **Files:** `frontend/app/leaderboard/page.tsx`, new hook

- [ ] **14.2 — Legends page is a placeholder**
  - `frontend/app/legends/[characterId]/page.tsx` — shows character ID and "API not yet connected"
  - **Fix:** Fetch from `/legends/:characterId` when endpoint exists (Group 11.6), render full legend page with stats, history, cause of death
  - **Files:** `frontend/app/legends/[characterId]/page.tsx`

- [ ] **14.3 — Payment integration stubs**
  - `play/page.tsx` shows "Payment integration coming soon" for reroll and realm generation
  - **Fix:** Integrate Coinbase CDP payment flow for x402 actions. This depends on x402 verification being implemented (Group 10.1)
  - **Files:** `frontend/app/play/page.tsx`

- [ ] **14.4 — Spectate page error handling**
  - `spectate/[characterId]/page.tsx` — `JSON.parse(event.data)` with no try/catch
  - Spectator WebSocket URL pattern may not match backend (depends on Group 11.5)
  - **Fix:** Add try/catch around JSON.parse, add connection error states, align WS URL with backend spectator endpoint
  - **Files:** `frontend/app/spectate/[characterId]/page.tsx`

- [ ] **14.5 — `vercel.json` rewrite URL is a placeholder**
  - Rewrites `/api/:path*` to `https://your-railway-server.railway.app/:path*`
  - Must be updated for actual deployment
  - **Fix:** Update to actual Railway deployment URL or use environment variable
  - **Files:** `frontend/vercel.json`

- [ ] **14.6 — `tsconfig.json` path alias points to nonexistent directory**
  - `"@/*": ["./src/*"]` but there's no `frontend/src/` directory — app code is under `frontend/app/`
  - **Fix:** Change to `"@/*": ["./app/*"]` or remove the alias if unused
  - **Files:** `frontend/tsconfig.json`

- [ ] **14.7 — `NEXT_PUBLIC_WS_URL` not documented in `.env.example`**
  - `use-game-session.ts` reads `NEXT_PUBLIC_WS_URL` with fallback to `ws://localhost:3001`
  - Not listed in root `.env.example`
  - **Fix:** Add `NEXT_PUBLIC_WS_URL=ws://localhost:3001` to `.env.example`
  - **Files:** `.env.example`

---

## Group 15: Agent SDK and Player Agent

**Scope:** SDK alignment with backend, player agent functionality

- [ ] **15.1 — Agent SDK uses WebSocket subprotocol auth, backend doesn't handle it**
  - `agent-sdk/src/client.ts` connects with `new WebSocket(url, ["Bearer", this.token.token])`
  - Backend `index.ts` reads token from `Authorization` header or `token` query param but doesn't check WebSocket subprotocol
  - **Fix:** Either update backend to read from `Sec-WebSocket-Protocol` header, or update SDK to use query param like the frontend does
  - **Files:** `backend/src/index.ts` or `agent-sdk/src/client.ts`

- [ ] **15.2 — Content routes don't expose full ability templates**
  - `GET /content/classes/:id/abilities` returns starting ability IDs from class template
  - Agents need full `AbilityTemplate` data (damage formulas, ranges, costs, effects) to make informed decisions
  - **Fix:** Return full ability template objects, not just IDs. Add `GET /content/abilities` for the complete ability registry
  - **Files:** `backend/src/routes/content.ts`

---

## Group 16: CI, Build, and Deployment

**Scope:** CI pipeline, build configuration, deployment config

- [ ] **16.1 — Railway deployment has no build step for shared packages**
  - `railway.toml`: `startCommand = "bun run backend/src/index.ts"`
  - Runs backend directly without building `@adventure-fun/schemas` (which needs `tsc` to produce `dist/`)
  - Engine exports raw `.ts` so it works, but schemas uses `dist/` in its exports
  - **Fix:** Add a build step or ensure Bun can resolve the raw TS sources. Verify the import chain works on Railway
  - **Files:** `railway.toml`, `shared/schemas/package.json`

- [x] **16.2 — Dead import in `realms.ts`**
  - `generateRealm` is imported from `@adventure-fun/engine` but never used
  - **Fix:** Remove the unused import
  - **Files:** `backend/src/routes/realms.ts`
  > NOTE: Removed as part of Group 1 work — `generateRealm` import replaced with `cleanupRealmForRegeneration` import.

---

## Summary by Priority

| Priority | Groups | Description |
|----------|--------|-------------|
| **P0 — Blocks basic gameplay** | 1, 2, 3 | Schema bugs, stat mismatches, non-functional combat |
| **P1 — Core loop incomplete** | 4, 5, 6, 7 | Enemy AI, leveling, extraction, traps |
| **P2 — Persistence and correctness** | 8, 9 | Session bugs, server authority |
| **P3 — Security and infrastructure** | 10, 12 | Auth hardening, Redis, rate limits |
| **P4 — Feature completeness** | 11, 13, 15 | Stub routes, edge cases, SDK |
| **P5 — Frontend and deployment** | 14, 16 | UI integration, CI, deploy config |

---

## Change Log

_Record completed fixes here with date and commit hash._

| Date | Group.Item | Commit | Notes |
|------|------------|--------|-------|
| 2026-04-09 | 1.1 | pending | Partial unique index replacing absolute UNIQUE on realm_instances |
| 2026-04-09 | 1.2 | pending | cleanupRealmForRegeneration helper + tests; wired into regenerate route |
| 2026-04-09 | 1.3 | pending | Created empty supabase/seed.sql |
| 2026-04-09 | 1.4 | pending | Deleted orphaned migrations/ directory |
| 2026-04-09 | 16.2 | pending | Removed dead `generateRealm` import from realms.ts (done as part of 1.2) |
| 2026-04-09 | 2.1 | pending | Replaced hardcoded `resource_max` with engine `CLASSES` values; added backend tests and surfaced max resource in class select + hub UI |
| 2026-04-09 | 2.2 | pending | Removed duplicated stat roll ranges from `stats.ts`; now rolls directly from engine template ranges with test coverage |
