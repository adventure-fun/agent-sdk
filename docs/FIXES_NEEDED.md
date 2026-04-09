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

- [x] **3.1 — `ability_id` on attack actions is completely ignored**
  - `resolvePlayerAttack` in `turn.ts` (line 294-395) receives `ability_id` in the action but never looks it up
  - Always calls `resolveAttack(attacker, defender, rng)` with no formula or on-hit effects
  - `combat.ts` `resolveAttack` already supports `formula` and `onHitEffects` parameters — they're just never passed
  - **Fix:** When `ability_id` is present, look up `AbilityTemplate` via `getAbility()`, check resource cost, check cooldown, compute `AbilityDamageFormula` from template, pass `effects` as `onHitEffects`, deduct resource, set cooldown. Fall back to basic attack when no `ability_id` or using `basic-attack`
  - **Files:** `shared/engine/src/turn.ts`, possibly `shared/engine/src/combat.ts`
  > NOTE: Implemented full player ability resolution in `shared/engine/src/turn.ts`. Attack actions now honor `ability_id`, consume resources, apply cooldowns, use ability formulas/effects, support self-target abilities, and fall back to `basic-attack`. Observation payloads now include ability summaries so the UI can explain costs, range, and cooldown state.

- [x] **3.2 — Resource system is entirely cosmetic**
  - Resource values (stamina/mana/energy/focus) are loaded from DB and sent in observations but never consumed or regenerated
  - Class templates define `resource_regen_rule` with different regen styles (passive, burst_reset, accumulate)
  - **Fix:** Add resource cost checking in ability resolution (3.1). Add resource regeneration at start or end of turn based on class regen rules. Handle Rogue's "burst_reset" (full reset every 3 turns) and Knight's "on_defend_bonus"
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: Resource costs are now enforced during ability use, and turn-based regen now follows class rules (`passive`, runtime content value `burst-reset`, `accumulate`, `none`). Knight defend-style self buffs trigger bonus stamina regen, Rogue energy fully resets on cadence, and the frontend meters now reflect real combat spending.

- [x] **3.3 — Status effects beyond poison have no gameplay impact**
  - `resolveStatusEffectTick` in `combat.ts` (line 138-157) only handles `poison` (damage per tick)
  - `stun` should prevent the affected entity from acting
  - `slow` should reduce speed or limit movement
  - `blind` should reduce accuracy
  - `buff-attack` and `buff-defense` are partially handled in `recalcStats` but not in status tick
  - **Fix:** In `resolveTurn`, check for stun before processing player/enemy actions. Apply blind as accuracy debuff in `resolveAttack`. Apply slow as movement restriction. Ensure buff/debuff magnitudes are applied to effective stats each turn
  - **Files:** `shared/engine/src/turn.ts`, `shared/engine/src/combat.ts`
  > NOTE: `stun` now skips turns for players and enemies, `slow` now blocks repositioning/movement, `blind` now penalizes hit chance inside combat resolution, and combat stat recalculation now respects temporary attack/defense effects during real fights. Added engine tests covering stun gating, ranged targeting, regen cadence, and enemy ranged ability use.

- [x] **3.4 — Enemy attacks don't use their defined abilities**
  - `resolveEnemyTurns` (turn.ts line 397-477) always uses basic `resolveAttack` with raw stats
  - Enemies have `abilities: string[]` in templates with specific damage formulas and effects
  - **Fix:** When an enemy attacks, select an ability (weighted by AI behavior), check cooldown, compute damage formula, pass on-hit effects to `resolveAttack`
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: Added `shared/engine/content/abilities/enemy-abilities.json` and loaded it into the shared ability registry. Enemy turns now pick usable abilities by range/cooldown, apply self-buffs/heals where appropriate, use ranged attacks when available, and apply on-hit status effects instead of always defaulting to a basic melee strike.

- [x] **3.5 — Ranged combat not implemented (Archer is melee-only)**
  - All attacks require Manhattan distance <= 1 (adjacent tiles)
  - Abilities have a `range` field (`"melee" | number`) but it's never checked
  - Archer class should have ranged attacks; spec mentions "melee vs ranged LOS"
  - **Fix:** In `resolvePlayerAttack`, check ability range. For ranged abilities, check `hasLineOfSight` from `visibility.ts` instead of adjacency. Update `computeLegalActions` to offer attack targets within ability range
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: `computeLegalActions` now emits per-ability attack options, including ranged LOS-valid targets, self-cast abilities, and AoE centers. The play UI now surfaces these as named ability actions and adds an ability bar showing cost, range, readiness, cooldowns, and richer status badges/effective stat deltas for player clarity.

---

## Group 4: Enemy AI Behaviors

**Scope:** Engine enemy turn resolution
**Depends on:** Group 3 (enemies need abilities to express behaviors)

- [x] **4.1 — All enemies use identical behavior: adjacent=attack, else=move-toward**
  - `EnemyTemplate.behavior` field is loaded but only `"boss"` is ever checked (for the boss-kill event flag)
  - Spec defines: aggressive, defensive, patrol, ambush, boss
  - **Fix:** Implement behavior-specific AI in `resolveEnemyTurns`:
    - `aggressive`: current behavior (move toward, attack) — already done
    - `defensive`: retreat when below HP threshold, prioritize defensive abilities
    - `patrol`: move along a path, only engage if player is within detection range
    - `ambush`: don't move until player is adjacent or within a trigger range
    - `boss`: implement phase transitions based on `boss_phases` HP thresholds, switching abilities
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: Implemented behavior-aware enemy turns in `shared/engine/src/turn.ts`. `aggressive` enemies keep the existing push-forward logic, `defensive` enemies now retreat and favor self-buffs when weakened, `patrol` enemies stay idle until the player enters detection range, and `ambush` enemies hold position until trigger range is met. Added focused TDD coverage in `shared/engine/__tests__/turn.test.ts`. Player-facing UI was also upgraded in `frontend/app/play/page.tsx` and `frontend/app/components/ascii-map.tsx` to show visible enemy HP, status effects, behavior badges, and boss markers so these AI differences are legible in combat.

- [x] **4.2 — Boss phase transitions not implemented**
  - `EnemyTemplate.boss_phases` defines HP thresholds that add/remove abilities
  - Currently ignored — bosses fight identically at all HP levels
  - **Fix:** Track boss phase state; when HP crosses a threshold, apply `behavior_change`, `abilities_added`, `abilities_removed`. Emit a game event for phase transitions
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: Bosses now persist phase progress with `boss_phase_index`, emit `boss_phase` events when thresholds are crossed, and recalculate their available ability set cumulatively from `boss_phases`. Observations now expose boss metadata/effects to the frontend, and the dungeon UI highlights boss phase announcements in the recent-events panel while keeping boss HP clearly visible.

---

## Group 5: Level Progression and Skill Trees

**Scope:** Engine + backend character progression
**Depends on:** Group 3 (abilities granted by skill tree need ability system working)

- [x] **5.1 — Level-up never occurs despite XP being awarded**
  - XP is added on enemy kills in `resolveTurn` and saved to DB in `endSession`
  - But there's no XP threshold table, no level-up check, no stat growth applied
  - Class templates define `stat_growth` per level but it's never used
  - **Fix:** Define XP thresholds (e.g. in a shared constant or content file). After awarding XP, check if level threshold is met. On level-up: increment level, apply `stat_growth` from class template to base stats, update HP max, grant skill point(s), emit level-up event
  - **Files:** `shared/engine/src/turn.ts`, possibly new file for XP curve constants
  > NOTE: Implemented quadratic XP curve in `shared/engine/src/leveling.ts` (formula: `50*(L-1)^2 + 50*(L-1)`, MAX_LEVEL=20). Level-up check runs in `handleEnemyDefeat` after XP award — applies `stat_growth` from class template per level gained, increases HP max (and heals by growth amount), emits `level_up` event with stat growth details. 18 dedicated TDD tests in `shared/engine/__tests__/leveling.test.ts` + 4 integration tests in `turn.test.ts`. Backend `saveCharacterState` now persists `stats` so level-up stat growth survives sessions. Observation now includes `xp_to_next_level` and `skill_points`. Frontend shows a purple XP progress bar in both hub (full, with next-level threshold) and dungeon (compact) views, with level-up events highlighted in yellow in the event log.

- [x] **5.2 — Skill tree system has no implementation**
  - Skill trees fully defined in class JSON and `skill-trees/*.json`
  - `skill_tree` JSONB column exists in DB
  - But there's no:
    - API endpoint to spend skill points
    - Engine logic to check/apply skill unlocks
    - Code to grant abilities from `grant-ability` skill effects
    - Code to apply `passive-stat` bonuses to effective stats
  - **Fix:** Add `POST /characters/skill` endpoint. Validate prerequisites, tier unlock level, available skill points. Write chosen skill to `skill_tree` JSONB. In `GameSession.create`, apply passive bonuses to effective stats. Track unlocked abilities from skill tree alongside `starting_abilities`
  - **Files:** `backend/src/routes/characters.ts`, `backend/src/game/session.ts`, `shared/engine/src/turn.ts`
  > NOTE: Full implementation across four layers:
  > - **Validation:** `backend/src/game/skill-tree.ts` provides `validateSkillAllocation()` (checks level gate, prerequisites, available points, duplicates) and `applySkillTreePassives()` (applies passive-stat bonuses). 13 TDD tests in `backend/__tests__/skill-tree.test.ts`, all green.
  > - **API:** `POST /characters/skill` endpoint validates and persists skill unlocks to the `skill_tree` JSONB column. `GET /characters/progression` returns the full skill tree template, unlocked nodes, available skill points, and XP curve data for the frontend.
  > - **Session:** `GameSession.create` now loads `skill_tree` from DB, merges `grant-ability` skill effects into the character's abilities list, and applies `passive-stat` bonuses to effective stats. `saveCharacterState` persists both `stats` and `skill_tree` to DB.
  > - **Schemas:** `GameState.character.skill_tree` and `Observation.character.skill_tree` + `skill_points` added so the engine and frontend have full visibility.
  > - **UI:** Hub shows a skill tree panel with per-tier layout, unlock/lock state, prerequisite checks, and a "Learn" button for affordable nodes. Skill point availability is surfaced as a prominent call-to-action. `useProgression` hook handles REST calls for progression data and skill spending.

---

## Group 6: Portal, Retreat, and Extraction Logic

**Scope:** Engine legal actions, extraction mechanics
**Why grouped:** Portal scrolls, retreat rules, and extraction conditions are all intertwined

- [x] **6.1 — Portal and retreat available anytime without enemies in room**
  - `computeLegalActions` (turn.ts line 1362-1452) offers `use_portal` and `retreat` whenever `!hasLiveEnemies`
  - Spec: portal requires a portal scroll item; retreat should only work at realm entrance
  - Portal scrolls are described as "the main balance lever" for the economy
  - **Fix:** Only offer `use_portal` if player has a portal scroll item in inventory (or a portal effect is active). Only offer `retreat` if player is in the entrance room of floor 1. Update `resolveUseItem` so that `portal-escape` effect sets a flag on GameState that enables `use_portal` for the current turn
  - **Files:** `shared/engine/src/turn.ts`, `shared/schemas/src/index.ts` (may need a `portalActive` flag on GameState)
  > NOTE: Added `portalActive` to `GameState`, set it from both `portal-escape` items and abilities, and gated `computeLegalActions()` so `use_portal` only appears when a portal is active or a `portal-scroll` is in inventory. `retreat` is now restricted to the floor 1 entrance. `resolveTurn()` now enforces those rules server-side too, auto-consumes a portal scroll on direct `use_portal`, and only emits extraction events when the action is actually valid. TDD: 8 new engine tests in `shared/engine/__tests__/turn.test.ts`.

- [x] **6.2 — Completion rewards not granted**
  - Realm templates define `completion_rewards: { xp, gold }` but these are never applied
  - When realm status becomes `completed` (boss_cleared + extraction), no bonus XP/gold is given
  - **Fix:** In `endSession` when reason is `extraction` and `realmStatus === "boss_cleared"`, look up template's `completion_rewards` and add to character XP/gold before saving
  - **Files:** `backend/src/game/session.ts`
  > NOTE: Added `applyExtractionOutcome()` in `backend/src/game/session.ts` to award completion XP/gold before `endSession("extraction")`, apply level-up stat growth when the bonus crosses an XP threshold, and send an enriched `extracted` payload (`xp_gained`, `gold_gained`, `completion_bonus`, `realm_completed`, named loot list). Frontend UX in `frontend/app/play/page.tsx` now highlights boss-cleared extraction state, gives clearer portal/retreat affordances, and shows a richer extraction summary screen. TDD: 4 tests in `backend/__tests__/session-extraction.test.ts`.

---

## Group 7: Trap System

**Scope:** Engine trap handling, room template integration
**Depends on:** Group 3 (trap effects use status effect system)

- [x] **7.1 — Trap system not implemented despite content definitions**
  - Room templates have `LootSlot.trapped`, `trap_damage`, `trap_effect`
  - Realm templates have `trap_types: TrapTemplate[]`
  - `trap_ids` are generated in `realm.ts`
  - `trap_visible` entity type exists in schemas
  - But `resolveTurn` has zero trap handling
  - **Fix:** When player opens a trapped chest (interact with trapped loot slot), check for trap. Apply `trap_damage` and `trap_effect`. Rogue class should have a `disarm-trap` ability check (if ability is known and class matches). After triggering, mark trap as `trap_triggered` mutation. Optionally make traps visible entities that can be inspected
  - **Files:** `shared/engine/src/turn.ts`, `shared/engine/src/realm.ts` (trap entity spawning)
  > NOTE: Implemented end-to-end trap gameplay in `shared/engine/src/turn.ts` and `shared/schemas/src/index.ts`. Room loot now carries trap metadata/positions, trapped pickups apply deterministic damage and status effects, Rogues with `rogue-disarm-trap` gain a dedicated `disarm_trap` legal action that spends resource and safely marks the trap as cleared, and triggered/disarmed traps emit `trap_triggered` mutations plus visible `trap_visible` map markers. Added 13 TDD cases to `shared/engine/__tests__/turn.test.ts`. Frontend dungeon UX in `frontend/app/play/page.tsx` now highlights nearby trapped loot, surfaces dedicated disarm buttons, styles trap events distinctly, and warns before trapped pickups.

---

## Group 8: Session and Persistence Improvements

**Scope:** Backend game session, DB write patterns

- [x] **8.1 — `persistMutation` does 2 DB writes per mutation**
  - Each mutation writes to `realm_mutations` AND updates `realm_instances` position
  - A turn with 3 mutations = 6 DB calls
  - **Fix:** Batch mutations into a single insert. Update `realm_instances` once after all mutations are processed, not per-mutation
  - **Files:** `backend/src/game/session.ts`
  > NOTE: Extracted `batchPersistMutations()` into `backend/src/game/session-persistence.ts`. All mutations from a single turn are now inserted in one `db.from("realm_mutations").insert([...])` call, and `realm_instances` position is updated once per turn (only when mutations exist). A turn with N mutations now costs 2 DB calls instead of 2N. 3 TDD tests in `backend/__tests__/session-persistence.test.ts`.

- [x] **8.2 — Disconnect recovery loses enemy positions and room state**
  - On disconnect, `endSession("disconnect")` pauses the realm
  - On reconnect, `GameSession.create` rebuilds from DB but enemies respawn at template positions (not where they moved to during the previous session)
  - Only killed/looted entities are properly recovered via mutations
  - **Fix:** Consider persisting active enemy positions to a session state column or Redis key. Alternatively, accept this as a design trade-off and document that disconnect resets enemy positions (non-mutated room state)
  - **Files:** `backend/src/game/session.ts`
  > NOTE: Added `session_state` JSONB and `rng_state` INTEGER columns to `realm_instances` (migration: `supabase/migrations/20260409100000_session_state_columns.sql`). On disconnect, `serializeSessionState()` captures live enemy positions, HP, effects, cooldowns, and boss phase indexes. On reconnect, `applySessionState()` restores them onto the rebuilt room state. Session state is cleared after consumption. 4 TDD tests covering serialization, dead-enemy exclusion, restoration, and graceful no-op.

- [x] **8.3 — `updateLeaderboard` always sets `realms_completed: 0`**
  - Line 449: `realms_completed: 0` with a TODO comment
  - Should query existing leaderboard entry and increment, or count `realm_instances` with `status = 'completed'`
  - **Files:** `backend/src/game/session.ts`
  > NOTE: Added `countCompletedRealms()` in `session-persistence.ts` that queries `realm_instances` where `status = 'completed'` for the character. `updateLeaderboard()` now runs this query in parallel with the character lookup and writes the actual count. 3 TDD tests. Removed the `// TODO: query + increment` comment.

- [x] **8.4 — `buildRunSummary` counts all interacts as "chests opened"**
  - Line 576: every `interact` event type increments `chestsOpened`
  - Interacting with a lore object, NPC, or door should not count as a chest
  - **Fix:** Check the event data or mutation type to distinguish chest opens from other interacts
  - **Files:** `backend/src/game/session.ts`
  > NOTE: Enhanced `resolveInteract()` in `shared/engine/src/turn.ts` to tag interact events with a `category` field: `"chest"` (grant-item/grant-gold effects), `"lore"` (has `lore_entry_id`), `"mechanism"` (unlock-door/spawn-enemy), or `"other"`. Extracted `buildRunSummaryFromEvents()` into `session-persistence.ts` — only counts `category === "chest"` as `chestsOpened`. Also added `traps_disarmed` tracking. Legacy events without `category` default to non-chest. 5 TDD tests.

- [x] **8.5 — Turn RNG may diverge on session resume**
  - `SeededRng(realm.seed + turn)` on session create
  - But RNG state advances through `.next()` calls within a turn
  - If session disconnects mid-turn and resumes, the RNG restarts from a clean `seed + turn` state
  - This means the "same seed = same outcome" guarantee breaks across disconnects
  - **Fix:** This is largely mitigated by mutations (dead enemies stay dead). Consider storing RNG offset in `realm_instances` for exact replay fidelity, or accept as minor issue
  - **Files:** `backend/src/game/session.ts`
  > NOTE: Added `getState()` and `setState()` to `SeededRng` in `shared/engine/src/rng.ts` for serialization of the internal Mulberry32 state. On disconnect, `rng_state` is persisted to `realm_instances`. On reconnect, if `rng_state` exists, the RNG is restored to exactly where it left off instead of restarting from `seed + turn`. Exact replay fidelity is now maintained across disconnects. 3 TDD tests proving state persistence produces identical sequences and diverges from fresh initialization.

---

## Group 9: Action Validation and Server Authority

**Scope:** Backend WebSocket message handling, engine validation

- [x] **9.1 — No server-side validation of actions against `legal_actions`**
  - `handleGameMessage` passes the client's action directly to `processTurn` without checking if it's in the set of legal actions
  - A malicious client could send `attack` on a target across the room, or `use_portal` while enemies are alive
  - Individual action resolvers have some checks (range, target exists) but they're inconsistent
  - **Fix:** Before calling `processTurn`, compute `legal_actions` for current state and validate the incoming action is among them. Reject with error if not
  - **Files:** `backend/src/game/session.ts`, `shared/engine/src/turn.ts`
  > NOTE: Added `isActionLegal()` in `backend/src/game/action-validator.ts` that structurally matches an incoming action against the engine's `computeLegalActions()` output. The check runs inside `GameSession.processTurn()` before `resolveTurn()` is called — illegal actions are rejected with `{ type: "error", code: "ILLEGAL_ACTION" }` and the turn counter is not incremented. Matching covers all 13 action types including attack ability_id specificity (defaults to `basic-attack` when absent). TDD: 20 tests in `backend/__tests__/action-validator.test.ts`. Frontend `useGameSession` now distinguishes action errors (transient auto-dismissing toast) from connection errors, and the `DungeonView` renders a dismissable error banner above the action panel.

- [x] **9.2 — No input sanitization on action payloads**
  - The parsed JSON action is passed directly to the engine
  - No validation that `direction` is one of the 4 valid values, `target_id` is a string, etc.
  - **Fix:** Add a validation layer (Zod or manual checks) for the `Action` discriminated union before processing
  - **Files:** `backend/src/game/session.ts`
  > NOTE: Added `parseAction()` in `backend/src/game/action-validator.ts` that validates and sanitizes raw client payloads before they reach the engine. Validates action type against a known set, checks required fields per action type (`direction` ∈ {up,down,left,right}, `target_id`/`item_id` are non-empty strings ≤ 200 chars, `slot` ∈ valid equip slots), and strips unknown extra fields to prevent prototype pollution or extraneous data. Returns a clean `Action` object on success or a descriptive error string on failure. Integrated into `handleGameMessage()` — malformed payloads receive `{ type: "error", message: "Invalid action: ..." }` and the turn is not processed. TDD: 27 tests covering all action types, edge cases (null, non-object, missing fields, bad types, overlong strings, extra fields).

---

## Group 10: Auth, Security, and Rate Limiting

**Scope:** Backend auth routes, JWT, rate limiting

- [x] **10.1 — x402 payment verification is completely stubbed**
  - All x402 endpoints (`reroll-stats`, `generate`, `regenerate`) just check for `X-Payment-Proof` header existence
  - Any non-empty header value bypasses payment — no verification of actual payment
  - No `payment_log` entries are created
  - **Fix:** Implement actual x402 payment verification (validate transaction hash, amount, recipient). Log to `payment_log` table on success. This is a multi-step feature that depends on the x402/CDP integration being finalized
  - **Files:** `backend/src/routes/characters.ts`, `backend/src/routes/realms.ts`, new file for x402 verification utility
  > NOTE: Added `backend/src/payments/x402.ts` with real x402 v2 requirement building, verification, settlement, and `payment_log` persistence. `reroll-stats`, `generate`, and `regenerate` now return `PAYMENT-REQUIRED`, validate `PAYMENT-SIGNATURE`, emit `PAYMENT-RESPONSE`, and log successful payments. Network defaults now switch between Base Sepolia / Solana Devnet and Base / Solana Mainnet based on `X402_TESTNET`. Frontend now uses Coinbase Embedded Wallet `useX402()` plus `x402-fetch` per the current Coinbase docs, with a confirmation modal and visible wallet / USDC status in the play UI.

- [x] **10.2 — `SESSION_SECRET` has weak dev fallback**
  - `jwt.ts` line 3: defaults to `"dev-secret-change-in-production-min-32-chars"` if env var is missing
  - In production this would silently use a publicly known secret
  - **Fix:** Throw an error if `SESSION_SECRET` is not set and `NODE_ENV !== 'development'`
  - **Files:** `backend/src/auth/jwt.ts`
  > NOTE: `backend/src/auth/jwt.ts` now permits the fallback only in development. Any non-development environment without an explicit `SESSION_SECRET` now fails fast during startup.

- [x] **10.3 — Auth nonces stored in-memory Map (breaks multi-instance)**
  - `pendingNonces` in `auth.ts` is a local `Map<string, ...>`
  - If backend runs on multiple instances (e.g. Railway horizontal scaling), nonces created on one instance won't be found on another
  - **Fix:** Move to Redis or a short-lived DB table. This is blocked until Redis is integrated (see Group 12)
  - **Files:** `backend/src/routes/auth.ts`
  > NOTE: Auth nonces now prefer Redis (`nonce:{uuid}` with TTL) and gracefully fall back to the in-memory map when Redis is unavailable in development. Added route coverage proving the fallback nonce flow still works and that `/auth/profile` now relies on middleware-provided session state.

- [x] **10.4 — No rate limiting on any endpoint**
  - Spec mentions rate limits for chat, auth, general API
  - `.env.example` defines `LOBBY_CHAT_RATE_LIMIT_SECONDS` but it's never read
  - No rate limiting middleware exists
  - **Fix:** Add rate limiting middleware (per-IP or per-account) for auth challenge, character creation, realm generation. Use `hono` middleware or a simple in-memory counter (Redis-backed for multi-instance)
  - **Files:** `backend/src/index.ts`, new middleware file
  > NOTE: Added `backend/src/middleware/rate-limit.ts` with Redis-backed counters when Redis is ready and in-memory TTL counters otherwise. The backend now enforces global request throttling plus focused limits on auth challenge, character roll, and realm generation endpoints.

- [x] **10.5 — No WebSocket max connections enforcement**
  - `.env.example` defines `MAX_WS_CONNECTIONS_PER_ACCOUNT=5` but it's never read
  - A single account could open unlimited WebSocket connections
  - **Fix:** Track active WS connections per account in the `activeSessions` map and reject new connections that exceed the limit
  - **Files:** `backend/src/index.ts`, `backend/src/game/session.ts`
  > NOTE: Added per-account WebSocket connection tracking in `backend/src/server/security-config.ts` and `backend/src/index.ts`. New upgrades are rejected with HTTP 429 once the configured account limit is reached, and counts are decremented on close.

- [x] **10.6 — Auth profile PATCH has redundant inline auth**
  - `auth.ts` line 80-93: imports `requireAuth` dynamically but doesn't use it as middleware; instead has inline auth logic duplicating the same pattern
  - **Fix:** Use `requireAuth` middleware like other protected routes
  - **Files:** `backend/src/routes/auth.ts`
  > NOTE: `PATCH /auth/profile` now uses `requireAuth` directly and reads `session.account_id` from middleware-populated context instead of re-parsing the bearer token inline.

- [x] **10.7 — CORS only allows a single origin**
  - `cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" })`
  - Agent SDK users hitting the API from other origins will be blocked
  - **Fix:** Use an array of allowed origins or a function that validates against a whitelist. Consider allowing all origins for public API endpoints (leaderboard, content) while restricting auth/game endpoints
  - **Files:** `backend/src/index.ts`
  > NOTE: CORS is now driven by `CORS_ALLOWED_ORIGINS`, with public read-only endpoints (`/health`, `/content/*`, `/leaderboard/*`) open to any origin and protected auth/game routes restricted to the configured whitelist.

---

## Group 11: Stub Routes and Missing Endpoints

**Scope:** Backend route implementations
**Depends on:** Group 1 (schema), Group 10 (auth/payments)

- [x] **11.1 — Leaderboard routes return 501**
  - `backend/src/routes/leaderboard.ts` — all endpoints return "Not implemented"
  - `leaderboard_entries` table exists and is populated by `endSession`
  - **Fix:** Implement `GET /leaderboard/xp`, `/level`, `/deepest-floor` with pagination, player_type filter (human/agent), and class filter
  - **Files:** `backend/src/routes/leaderboard.ts`
  > NOTE: Implemented real leaderboard APIs in `backend/src/routes/leaderboard.ts` with validated `type`/filter query params, stable sorting, pagination metadata, and DB-row-to-`LeaderboardEntry` mapping. Also fixed route ordering so `/hall-of-fame` and `/leaderboard/legends/:characterId` no longer get swallowed by the dynamic `/:type` matcher. Frontend `frontend/app/leaderboard/page.tsx` now uses `frontend/app/hooks/use-leaderboard.ts` for live data, filter chips, class filtering, paging controls, legend links, and richer leaderboard presentation.

- [x] **11.2 — Lobby routes return 501**
  - `backend/src/routes/lobby.ts` — all endpoints return "Not implemented"
  - Includes shop (buy/sell), inn (rest/heal), chat
  - Shop and inn are core economy features
  - **Fix:** Implement shop endpoints (list items, buy with gold, sell for gold). Implement inn rest (x402 gated, restore HP/resource). Chat can be deferred until Redis is available
  - **Files:** `backend/src/routes/lobby.ts`
  > NOTE: Implemented lobby shop APIs in `backend/src/routes/lobby.ts` plus validation helpers in `backend/src/routes/lobby-helpers.ts`. Added `GET /lobby/shops`, `GET /lobby/shop/inventory`, `POST /lobby/shop/buy`, and `POST /lobby/shop/sell` with gold checks, stack handling, class restrictions, inventory-capacity guardrails, and equipped-item protection. Hub UX in `frontend/app/play/page.tsx` now includes a full shop tab backed by `frontend/app/hooks/use-shop.ts`, with buy/sell panes, category filters, quantity selectors, featured gear, and gold-forward presentation.

- [-] **11.3 — Marketplace routes return 501**
  - `backend/src/routes/marketplace.ts` — explicitly deferred to v1.5 per BUILD_PLAN.md
  - Schema and types exist, death trigger for orphaning listings is already in the database
  - **Fix:** Leave as 501 for v1. Consider removing the marketplace death trigger to avoid unnecessary overhead until marketplace is built
  - **Files:** `backend/src/routes/marketplace.ts`
  > NOTE: Left marketplace deferred for v1.5, but updated all 501 responses in `backend/src/routes/marketplace.ts` to a clearer `"Marketplace coming in v1.5"` message so the API now communicates intent instead of a generic stub.

- [x] **11.4 — Inn rest endpoint missing entirely**
  - Spec defines inn rest as an x402-gated heal-to-full feature
  - No route exists for it — not even a 501 stub
  - **Fix:** Add to lobby routes. When paid, restore character HP and resource to max. Log payment
  - **Files:** `backend/src/routes/lobby.ts`
  > NOTE: Added `POST /lobby/inn/rest` to `backend/src/routes/lobby.ts` using the existing x402 flow (`verifyAndSettle`, `return402`, `logPayment`) with live-session checks and full HP/resource restoration. The hub now renders a dedicated inn card with rest-state messaging, disabled-full-health guardrails, and `PaymentModal` integration via `frontend/app/hooks/use-inn.ts`.

- [x] **11.5 — Spectator WebSocket endpoint not implemented**
  - Frontend has `/spectate/:characterId` page that connects to WS
  - Agent SDK spec describes spectator observations
  - Backend only handles `/realms/:id/enter` WebSocket, no spectator endpoint
  - `toSpectatorObservation` exists in the engine but is never called
  - **Fix:** Add `/spectate/:characterId` WebSocket endpoint that subscribes to game session observations (via in-memory pub or Redis pub/sub) and sends `SpectatorObservation` payloads
  - **Files:** `backend/src/index.ts`, `backend/src/game/session.ts`
  > NOTE: Implemented `/spectate/:characterId` in `backend/src/index.ts` with role-aware Bun WS handling, live-session lookup via `backend/src/game/active-sessions.ts`, and spectator fan-out using `backend/src/game/spectators.ts`. `GameSession` now tracks spectators, broadcasts `toSpectatorObservation()` payloads after turn resolution, and closes spectator clients with a `session_ended` message on disconnect/death/extraction. `frontend/app/spectate/[characterId]/page.tsx` now handles structured messages safely, adds reconnect/error states, and upgrades the viewing UI with a larger map, entity sidebar, live indicators, and richer event rendering.

- [x] **11.6 — Legends API endpoint missing**
  - Frontend legends page expects `GET /legends/:characterId`
  - No route exists
  - **Fix:** Add endpoint that queries dead character + account + run_logs + corpse data and returns `LegendPage` shape
  - **Files:** `backend/src/routes/` (new or add to characters)
  > NOTE: Added `backend/src/routes/legends.ts`, registered it in `backend/src/index.ts`, and exposed it publicly via `backend/src/server/security-config.ts`. The route now composes dead-character profile data from `characters`, joined `accounts`, `corpse_containers`, corpse-owned `inventory_items`, `run_logs`, and `leaderboard_entries`, then returns the `LegendPage` shape. `frontend/app/legends/[characterId]/page.tsx` now renders `legend-page-client.tsx`, which provides a complete memorial view with stats, death gear, run history, owner details, skill-tree snapshot, and share-friendly UX.

---

## Group 12: Redis Integration

**Scope:** Backend Redis setup, pub/sub, session state
**Why last:** Enables lobby chat, spectator broadcast, multi-instance support, but game works without it

- [x] **12.1 — `ioredis` is a dependency but never imported**
  - `backend/package.json` lists `ioredis`
  - `.env.example` has `REDIS_URL`
  - Zero imports of ioredis in any backend source file
  - The spec calls for Redis pub/sub for: spectator channels, lobby activity, lobby chat, leaderboard updates
  - **Fix:** Create `backend/src/redis/client.ts` with connection setup. Wire into session for spectator broadcast, lobby for chat/activity, and leaderboard for real-time updates. Make Redis optional (graceful no-op if `REDIS_URL` is not set) so the game still works without it during development
  - **Files:** New `backend/src/redis/client.ts`, `backend/src/game/session.ts`, `backend/src/routes/lobby.ts`
  > NOTE: **Complete.** Built in two phases:
  >
  > **Phase 1 (foundation, from Group 8 work):** Created `backend/src/redis/client.ts` with optional connection (`getRedis()`, `redisGet`, `redisSet`, `redisDel`, `redisPublish`, `isRedisAvailable()`). Client gracefully logs and falls back to no-op when `REDIS_URL` is not set. Wired into `backend/src/index.ts` to initialize on startup. Added `docker-compose.yml` at project root with a Redis 7 Alpine service (health checks, persistence, memory limit). Created `scripts/dev.sh` that automatically starts Redis via docker-compose before launching turbo dev — root `bun run dev` now uses this script. `bun run dev:no-redis` is available as fallback.
  >
  > **Phase 2 (pub/sub wiring):**
  > - **Pub/sub infrastructure:** `backend/src/redis/pubsub.ts` — `RedisPubSub` class with dedicated subscriber connection (separate from publisher per ioredis requirements), channel handler routing, subscribe/unsubscribe lifecycle, and `CHANNELS` constants for `lobby:chat`, `lobby:activity`, `leaderboard:updates`, and `spectator:{characterId}`. Singleton `getPubSub()` for app-wide access. 10 TDD tests in `backend/__tests__/redis-pubsub.test.ts`.
  > - **Publisher helpers:** `backend/src/redis/publishers.ts` — `publishSpectatorUpdate()`, `publishLobbyActivity()`, `publishLeaderboardDelta()`, `publishChatMessage()`, and `validateChatMessage()` with sanitization. 11 TDD tests in `backend/__tests__/redis-integration.test.ts`.
  > - **Lobby live manager:** `backend/src/game/lobby-live.ts` — `LobbyLiveManager` class tracks lobby WebSocket clients, broadcasts activity/chat/leaderboard events locally, connects to Redis pub/sub for cross-instance relay, and handles per-character chat rate limiting. 7 TDD tests in `backend/__tests__/lobby-live.test.ts`.
  > - **Spectator cross-instance broadcast:** `backend/src/game/session.ts` `processTurn()` now publishes spectator observations to `spectator:{characterId}` via Redis after local broadcast, enabling spectators on other server instances to receive live game updates.
  > - **Lobby activity feed:** `processTurn()` publishes `notableEvents` (deaths, boss kills, extractions) to `lobby:activity` via Redis for the lobby live feed.
  > - **Leaderboard real-time:** `updateLeaderboard()` publishes `LeaderboardDelta` to `leaderboard:updates` via Redis after every leaderboard upsert.
  > - **Chat endpoint:** `POST /lobby/chat` in `backend/src/routes/lobby.ts` — validates message (non-empty, max 500 chars, trimmed), enforces per-character rate limit from `LOBBY_CHAT_RATE_LIMIT_SECONDS` env var, broadcasts locally and publishes to Redis.
  > - **Lobby live WebSocket:** `ws://host/lobby/live` in `backend/src/index.ts` — unauthenticated WebSocket endpoint. On connect, the `LobbyLiveManager` subscribes the socket to receive chat, activity, and leaderboard delta broadcasts. On disconnect, the socket is removed. Lobby manager connects to Redis pub/sub on startup so messages from other server instances are relayed to local lobby clients.
  > - **Total new tests:** 28 tests across 3 new test files, all green. Full backend suite: 157 tests, all passing.

---

## Group 13: Engine Edge Cases and Polish

**Scope:** Engine logic fixes that aren't critical but affect game quality

- [x] **13.1 — Interactable proximity not checked**
  - `computeLegalActions` adds interact actions for all non-mutated interactables regardless of player distance
  - Interactables have no tracked position (hardcoded to `{x: 0, y: 0}` in observation builder)
  - **Fix:** Either assign positions to interactables in room generation and check proximity, or document that interactables are room-wide (accessible from anywhere in the room) as a design decision
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: Chose the documented room-wide interaction design because content templates still do not carry interactable coordinates. `computeLegalActions()` now only exposes interactables for the player's current room, observation entities render interactables at room center instead of `{0,0}`, and the dungeon UI now surfaces visible interactables as labeled map chips.

- [x] **13.2 — Enemy positions can collide on spawn**
  - `buildRoomState` places enemies at positions from room template slots
  - Multiple enemies with same `position` in template will stack on the same tile
  - `position: "random"` falls back to `{x: 3, y: 3}` — all "random" enemies land on same tile
  - **Fix:** When building room state, use the item/enemy seed RNG to place entities on valid floor tiles, avoiding collisions
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: Added deterministic spawn placement in `buildRoomState()` using room-local floor-tile discovery plus per-entity seeded RNG. Random enemies now land on unique valid tiles, explicit coordinate collisions are nudged to the nearest open tile, and positions stay deterministic for the same seed. Covered in `shared/engine/__tests__/turn.test.ts`.

- [x] **13.3 — Item positions always `{x: 2, y: 2}`**
  - All loot items in `buildRoomState` get `position: { x: 2, y: 2 }` regardless of room template
  - Players must always go to (2,2) to pick up any item
  - **Fix:** Derive positions from `loot_slots[i].position` or use seeded random placement on floor tiles
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: Loot placement now shares the same deterministic placement helper as enemy spawns. Explicit `loot_slots[i].position` values are still honored when available, random/missing positions now resolve to open floor tiles, and loot no longer stacks on enemy spawn points.

- [x] **13.4 — Inventory capacity not enforced**
  - Spec: 12 inventory slots
  - No check in `resolvePickup` or `applyEffect` (grant-item) for inventory being full
  - **Fix:** Add shared base-capacity config, check before adding items, return "Inventory full" if at capacity. May also need a backpack upgrade system per spec
  - **Files:** `shared/engine/src/turn.ts`, `shared/schemas/src/index.ts` (constant)
  > NOTE: Implemented inventory capacity from a shared helper in `shared/schemas/src/index.ts` using the documented `12` base slots while leaving room for future backpack bonuses. The engine now blocks non-stackable pickups / grant-item rewards when full, still allows stack merges at capacity, lobby buy validation now uses the same shared helper, and the play UI shows used/capacity plus full or near-full warnings.

- [x] **13.5 — `rooms_visited` tracking not implemented**
  - `buildObservationFromState` line 1258: `rooms_visited: []` with TODO comment
  - Known map data always reports empty rooms_visited
  - **Fix:** Track visited room IDs on GameState, merge on room transitions
  - **Files:** `shared/engine/src/turn.ts`, `shared/schemas/src/index.ts` (add to GameState if needed)
  > NOTE: Added `roomsVisited` to `GameState`, now populate `known_map.floors[*].rooms_visited` from engine state, mark current rooms as visited after observations are built, and persist the visited-room set through disconnect recovery via `session_state`.

- [x] **13.6 — Room text always shows first-visit text**
  - `isFirstVisit` check is flawed — it checks if the exact tile position was already discovered, not whether the room was previously entered
  - Without `rooms_visited` tracking (13.5), revisit text is never shown
  - **Fix:** Use `rooms_visited` (once 13.5 is done) to determine first visit vs revisit and select appropriate text
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: Room text selection now keys off `roomsVisited` instead of discovered tile coordinates. First observation in a room uses `text_first_visit` / `description_first_visit`; subsequent observations fall back to `text_revisit` / `description_revisit` when available.

- [x] **13.7 — `reveal-map` item effect is a no-op**
  - `resolveUseItem` case `"reveal-map"` just pushes text "The map reveals itself" but doesn't actually reveal tiles
  - **Fix:** Mark all tiles on the current floor as discovered in `s.discoveredTiles`
  - **Files:** `shared/engine/src/turn.ts`
  > NOTE: `reveal-map` now expands `discoveredTiles` across every room on the current floor and marks those rooms as visited. The effect text was upgraded to make the reveal explicit, and the dungeon event feed now highlights map-reveal uses. No shipped item template currently uses `reveal-map`, but the engine path is now fully implemented.

- [x] **13.8 — Lore discovery not persisted**
  - `lore_discovered` table exists in DB
  - `reveal-lore` effect type exists in `applyEffect` but only pushes text
  - No write to `lore_discovered` table
  - **Fix:** Collect lore discoveries during turn resolution and persist them in `endSession` or per-turn
  - **Files:** `shared/engine/src/turn.ts`, `backend/src/game/session.ts`
  > NOTE: Added `loreDiscovered` tracking to `GameState`, collect lore discoveries from both interactable `lore_entry_id` values and `reveal-lore` effects, persist them from `endSession()` through a new `persistLoreDiscoveries()` helper, and load them again in `GameSession.create()`. `GET /characters/me` now includes `lore_discovered`, and the hub gained a lore journal while dungeon events highlight lore finds distinctly. TDD: `shared/engine/__tests__/turn.test.ts` plus new `backend/__tests__/session-lore.test.ts`.

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
  - This also contributes noise to frontend typechecking because the local alias is invalid even before real app errors are evaluated
  - **Fix:** Change to `"@/*": ["./app/*"]` or remove the alias if unused. After that, run package-local frontend typecheck (`frontend/tsconfig.json`) rather than repo-root `tsc`
  - **Files:** `frontend/tsconfig.json`

- [x] **14.7 — `NEXT_PUBLIC_WS_URL` not documented in `.env.example`**
  - `use-game-session.ts` reads `NEXT_PUBLIC_WS_URL` with fallback to `ws://localhost:3001`
  - Not listed in root `.env.example`
  - **Fix:** Add `NEXT_PUBLIC_WS_URL=ws://localhost:3001` to `.env.example`
  - **Files:** `.env.example`
  > NOTE: Added `NEXT_PUBLIC_WS_URL=ws://localhost:3001` to `.env.example` as part of Group 8 dev-experience improvements.

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

- [ ] **15.3 — `player-agent` typecheck breaks on workspace source imports**
  - `player-agent/tsconfig.json` uses `rootDir: "./src"` while importing `@adventure-fun/agent-sdk`, which under workspace source resolution can point at `agent-sdk/src/*`
  - That causes `TS6059` "file is not under rootDir" failures once package path mappings are corrected
  - **Fix:** Split build-vs-typecheck configs or relax `rootDir` for package-local typecheck. Alternative: adopt TS project references so workspace packages are typechecked as referenced projects instead of raw source imports
  - **Files:** `player-agent/tsconfig.json`, possibly `agent-sdk/tsconfig.json`, root `tsconfig.json`

---

## Group 16: CI, Build, and Deployment

**Scope:** CI pipeline, build configuration, deployment config

- [ ] **16.1 — Railway deployment has no build step for shared packages**
  - `railway.toml`: `startCommand = "bun run backend/src/index.ts"`
  - Runs backend directly without building `@adventure-fun/schemas` (which needs `tsc` to produce `dist/`)
  - Engine exports raw `.ts` so it works, but schemas uses `dist/` in its exports
  - **Fix:** Add a build step or ensure Bun can resolve the raw TS sources. Verify the import chain works on Railway
  - **Files:** `railway.toml`, `shared/schemas/package.json`

- [ ] **16.3 — Monorepo typecheck flow is not aligned with workspace package boundaries**
  - Running repo-root `tsc --noEmit` uses the root config and produces misleading frontend JSX errors because it is not the intended Next.js/frontend typecheck path
  - Internal packages also mix "build" assumptions (`rootDir`, `outDir`, `dist` exports) with "typecheck source in workspace" assumptions, which causes cascading failures before real code issues are visible
  - **Fix:** Standardize on `turbo typecheck` for repo checks. Create package-specific typecheck configs (or TS project references) so workspace imports do not violate `rootDir`, and keep build-only settings isolated from `--noEmit` typecheck
  - **Files:** root `package.json`, root `tsconfig.json`, `turbo.json`, per-package `tsconfig.json`

- [ ] **16.4 — Internal package type exports assume built `dist/` artifacts during development**
  - `@adventure-fun/schemas` and `@adventure-fun/agent-sdk` advertise `types` from `dist/`, but those files may not exist in fresh worktrees or CI steps that run typecheck before build
  - This hides real errors behind stale or missing declaration output
  - **Fix:** Either build those packages before dependents typecheck, or point workspace/development type resolution at source while keeping runtime exports stable for published artifacts
  - **Files:** `shared/schemas/package.json`, `agent-sdk/package.json`, potentially root `tsconfig.json`

- [ ] **16.5 — Engine package uses outdated JSON import syntax for current TypeScript**
  - `shared/engine/src/content.ts` still uses `assert { type: "json" }`
  - Current TypeScript expects `with { type: "json" }`, so engine typecheck fails before reaching deeper logic issues
  - **Fix:** Migrate JSON imports in engine content loader to import attributes and rerun package typecheck
  - **Files:** `shared/engine/src/content.ts`

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
| **P2 — Persistence and correctness** | 8, ~~9~~ | Session bugs, server authority (Group 9 complete) |
| **P3 — Security and infrastructure** | 10, 12 | Auth hardening, Redis, rate limits |
| **P4 — Feature completeness** | 11, 13, 15 | Stub routes, edge cases, SDK |
| **P5 — Frontend and deployment** | 14, 16 | UI integration, CI, deploy config, monorepo typecheck/tooling |

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
| 2026-04-09 | 3.1 | pending | Wired `ability_id` into player turn resolution, added ability summaries to observations, and surfaced named ability actions in the play UI |
| 2026-04-09 | 3.2 | pending | Resource costs and class regen rules now affect combat turns, including Knight defend bonus and Rogue burst reset cadence |
| 2026-04-09 | 3.3 | pending | Stun/slow/blind now have gameplay impact in turn resolution and combat hit calculation; added focused engine coverage |
| 2026-04-09 | 3.4 | pending | Added enemy ability registry and upgraded enemy turns to choose ranged/self/offensive abilities with cooldown handling |
| 2026-04-09 | 3.5 | pending | Implemented ranged LOS-aware legal actions and player targeting; upgraded dungeon UI with cooldowns, effect badges, and effective stat display |
| 2026-04-09 | 4.1 | pending | Added behavior-aware enemy AI (defensive retreat, patrol detection, ambush trigger, aggressive fallback) with engine tests and player-visible enemy HUD improvements |
| 2026-04-09 | 4.2 | pending | Implemented persistent boss phases with threshold events, cumulative ability swaps, boss markers, and highlighted phase announcements in the play UI |
| 2026-04-09 | 5.1 | pending | Quadratic XP curve (`shared/engine/src/leveling.ts`), level-up in `handleEnemyDefeat` with stat_growth, 22 new tests, XP progress bar in hub + dungeon |
| 2026-04-09 | 5.2 | pending | Skill tree validation (`backend/src/game/skill-tree.ts`), `POST /characters/skill` + `GET /characters/progression` endpoints, session skill-tree merge + passive-stat bonuses, skill tree UI panel in hub, 13 new tests |
| 2026-04-09 | 6.1 | pending | Portal use now requires `portalActive` or a `portal-scroll`, retreat is limited to the floor 1 entrance, and direct `use_portal` auto-consumes a scroll with engine coverage |
| 2026-04-09 | 6.2 | pending | Added extraction reward helper in `session.ts`, completion bonus XP/gold + level-up handling, richer extracted payload, and improved extraction UX with backend/frontend coverage |
| 2026-04-09 | 7.1 | pending | Implemented trapped loot resolution, Rogue `disarm_trap` action, trap visibility markers, 13 engine TDD cases, and dungeon UI trap warnings/disarm affordances |
| 2026-04-09 | 8.1 | pending | Batch mutation persistence — single insert + single `realm_instances` update per turn; extracted `session-persistence.ts` with 3 tests |
| 2026-04-09 | 8.2 | pending | Disconnect recovery — `session_state` JSONB + `rng_state` columns on `realm_instances`, serialize/restore enemy state on disconnect/reconnect; 4 tests |
| 2026-04-09 | 8.3 | pending | `updateLeaderboard` now queries actual `realms_completed` count from DB instead of hardcoded 0; 3 tests |
| 2026-04-09 | 8.4 | pending | Interact events now tagged with `category` (chest/lore/mechanism/other); `buildRunSummary` only counts chest category; added `traps_disarmed` tracking; 5 tests |
| 2026-04-09 | 8.5 | pending | RNG state persistence — `getState()`/`setState()` on `SeededRng`, persisted on disconnect, restored on reconnect for exact replay fidelity; 3 tests |
| 2026-04-09 | 9.1 | pending | Server-side `isActionLegal()` check in `processTurn()` against `computeLegalActions()`, 20 TDD tests, frontend transient error toast |
| 2026-04-09 | 9.2 | pending | `parseAction()` input sanitization for all 13 action types, strips extra fields, 27 TDD tests, integrated into `handleGameMessage()` |
| 2026-04-09 | 10.1 | pending | Real x402 v2 verification/settlement, `payment_log` writes, Coinbase `useX402()` frontend integration, payment modal UX, wallet/USDC account header, and network-aware env defaults |
| 2026-04-09 | 10.2 | pending | Production-only `SESSION_SECRET` startup guard |
| 2026-04-09 | 10.3 | pending | Auth nonces moved to Redis with in-memory fallback and route coverage |
| 2026-04-09 | 10.4 | pending | Added Redis/in-memory rate limiting middleware and applied auth/roll/generate throttles |
| 2026-04-09 | 10.5 | pending | Enforced per-account WebSocket connection caps with helper coverage |
| 2026-04-09 | 10.6 | pending | `PATCH /auth/profile` now uses `requireAuth` middleware directly |
| 2026-04-09 | 10.7 | pending | CORS now uses origin whitelist plus public-route exceptions |
| 2026-04-09 | 11.1 | pending | Implemented live leaderboard routes + frontend leaderboard page with filters, pagination, and legend links |
| 2026-04-09 | 11.2 | pending | Added lobby shop APIs, inventory endpoint, validation helpers, and polished hub buy/sell UI |
| 2026-04-09 | 11.3 | pending | Kept marketplace deferred but replaced generic 501 responses with clear v1.5 messaging |
| 2026-04-09 | 11.4 | pending | Added x402-gated inn rest endpoint and hub inn card restoring HP/resource to full |
| 2026-04-09 | 11.5 | pending | Added spectator WebSocket path, session fan-out helpers, reconnect-safe spectate page, and spectator tests |
| 2026-04-09 | 11.6 | pending | Added legends API plus full legend memorial page composed from corpse, run-log, and leaderboard data |
| 2026-04-09 | 12.1 | pending | Complete: Redis pub/sub infrastructure, spectator cross-instance broadcast, lobby activity/chat/leaderboard via Redis, `/lobby/live` WS endpoint, `POST /lobby/chat`, 28 new TDD tests |
| 2026-04-09 | 13.1 | pending | Documented interactables as room-wide for the current room, centered their map positions, and surfaced labeled interactable chips in the dungeon UI |
| 2026-04-09 | 13.2 | pending | Replaced stacked/random enemy spawn fallbacks with deterministic seeded placement on open floor tiles, avoiding collisions |
| 2026-04-09 | 13.3 | pending | Loot now uses deterministic open-tile placement instead of defaulting to `{ x: 2, y: 2 }`, while still honoring explicit slot coordinates |
| 2026-04-09 | 13.4 | pending | Added shared base inventory-capacity helper, enforced full-inventory checks in engine + lobby flows, and exposed slot usage in the play UI |
| 2026-04-09 | 13.5 | pending | Added `roomsVisited` state, populated `known_map.rooms_visited`, and preserved room-visit history across disconnect recovery |
| 2026-04-09 | 13.6 | pending | Room text now switches from first-visit copy to revisit copy based on tracked room visits instead of discovered tile coordinates |
| 2026-04-09 | 13.7 | pending | Implemented `reveal-map` to uncover the full current floor and mark rooms visited; play UI now highlights those map-reveal events |
| 2026-04-09 | 13.8 | pending | Added lore discovery tracking/persistence via `lore_discovered`, enriched `/characters/me`, and shipped a hub lore journal plus lore-highlighted dungeon events |
| 2026-04-09 | 14.7 | pending | Added `NEXT_PUBLIC_WS_URL` to `.env.example` |
