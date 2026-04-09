# FIXES_NEEDED_2 -- Playtesting Follow-up Audit

> Generated 2026-04-09 from targeted codebase review after post-fix playtesting.
> This document captures newly discovered gameplay, persistence, UI, and progression issues.

## How to Use This Document

Each fix group is designed to be completed as a single cohesive commit or small PR.
Groups are intentionally scoped so individual agents can complete them without compacting context.

Work through groups in dependency order where noted. Independent groups can run in parallel.

# IMPORTANT

Use Red/Green Test Driven Development. Make sure all bug fixes and enhancements are testable wherever possible.

Write tests first, watch them fail, implement fixes, run tests again until passing. NO EXCEPTIONS.

### Task Status Key

| Mark | Meaning |
|------|---------|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Complete |
| `[-]` | Skipped / deferred |

Add notes under any item with `> NOTE: your note here` when needed.

---

## Group 1: Bossless Realm Completion Rewards

**Scope:** Engine realm completion state, backend extraction rewards
**Why first:** Blocks XP/gold completion rewards in multiple realms

- [x] **1.1 -- Bossless realms can never award completion rewards**
  - `applyExtractionOutcome()` only awards `completion_rewards` when `realmStatus === "boss_cleared"`
  - The engine only sets `"boss_cleared"` when a killed enemy has `behavior === "boss"`
  - Realms with `boss_id: null` therefore can never count as completed, even if their template defines `completion_rewards`
  - Confirmed affected realm templates:
    - `shared/engine/content/realms/blighted-hollow.json`
    - `shared/engine/content/realms/tutorial-cellar.json`
    - `shared/engine/content/realms/collapsed-passage.json`
  - **Design decision:** Reaching and clearing the final room of a bossless realm = completed
  - **Fix:** Add a new engine status such as `"realm_cleared"` and set it when all enemies in the last room of the last floor are defeated in a bossless realm
  - **Files:** `shared/engine/src/turn.ts`, `shared/schemas/src/index.ts`
  > NOTE: Implemented `realm_cleared` as a first-class in-session status and set it when the last room on the last floor is emptied in bossless realms. The engine now also emits a `realm_clear` recent event plus lobby notable event for that transition.

- [x] **1.2 -- Backend completion reward flow must treat bossless clear like boss clear**
  - `backend/src/game/session.ts` currently only treats `"boss_cleared"` as a completed realm for reward purposes
  - `endSession()` also maps only `"boss_cleared"` to DB status `completed`
  - **Fix:** Treat `"realm_cleared"` exactly like `"boss_cleared"` in:
    - `applyExtractionOutcome()`
    - `endSession()`
    - any other completion checks used for extraction UX or reconnection guards
  - **Files:** `backend/src/game/session.ts`, `backend/src/index.ts`
  > NOTE: `applyExtractionOutcome()` and `endSession()` now treat `realm_cleared` the same as `boss_cleared`, preserving `completed` persistence and finished-realm guard behavior. As a UX enhancement, the play UI now shows bossless-specific extraction banner copy, completion bonus copy, and a highlighted `realm_clear` event state.

- [x] **1.3 -- Add focused tests for bossless completion**
  - Add tests that prove:
    - clearing the final room in a bossless realm sets the new completion status
    - extracting after that awards the template's `completion_rewards`
    - the persisted `realm_instances.status` becomes `completed`
  - **Files:** `shared/engine/__tests__/turn.test.ts`, `backend/__tests__/session-extraction.test.ts`
  > NOTE: Added engine coverage for final-room bossless clears and non-final-room/non-final-floor regressions, plus backend coverage for `realm_cleared` extraction rewards. Focused tests pass, and the workspace `bun run test` suite now passes after cleaning up unrelated package test/build blockers.

---

## Group 2: Starting Stat Rebalance

**Scope:** Class templates, starting stat ranges, per-level growth
**Why early:** Affects every newly created character and current game balance immediately

- [x] **2.1 -- Starting character stat ranges are far too high**
  - Current ranges let a fresh level 1 Knight massively overpower early realms
  - Example from the current data:
    - Knight starts with `hp: 90-110`, `attack: 15-20`, `defense: 10-14`
    - Blighted Wolf has `hp: 25`, `attack: 7`, `defense: 3`
    - With current combat math, the wolf typically dies in 2 hits while dealing only 1 damage per hit to a geared-less Knight
  - **Design decision:** Rebalance by reducing player starting stats sharply, not by buffing enemies
  - **Constraint:** Starting HP should never exceed 40 and non-HP stats should never exceed 20
  - **Files:** `shared/engine/content/classes/*.json`, `shared/engine/src/combat.ts`
  > NOTE: Replaced all four class starting envelopes with the lower target ranges, aligned `base_stats` to the new midpoints, and re-tuned hit chance scaling for the lower accuracy/evasion stat scale so class differences still matter in combat.

- [x] **2.2 -- Replace class stat ranges with lower, role-driven ranges**
  - Treat HP like roughly `2d20` with class-shaped floors/ceilings
  - Treat other stats like `1d20` with class-specific strengths and weaknesses
  - **Target ranges to implement:**
    - **Knight:** HP `25-40`, attack `8-14`, defense `8-14`, accuracy `8-14`, evasion `2-6`, speed `2-6`
    - **Mage:** HP `12-22`, attack `12-18`, defense `2-5`, accuracy `10-16`, evasion `4-8`, speed `6-12`
    - **Rogue:** HP `16-28`, attack `7-13`, defense `3-7`, accuracy `10-16`, evasion `10-18`, speed `12-20`
    - **Archer:** HP `18-30`, attack `8-14`, defense `3-8`, accuracy `14-20`, evasion `6-12`, speed `8-14`
  - **Fix:** Update `stat_roll_ranges` in all class JSON files and align `base_stats` to sensible midpoints
  - **Files:** `shared/engine/content/classes/knight.json`, `shared/engine/content/classes/mage.json`, `shared/engine/content/classes/rogue.json`, `shared/engine/content/classes/archer.json`
  > NOTE: Role identity is now much clearer at creation time: Knight owns defense, Mage owns attack, Rogue owns evasion/speed, and Archer owns accuracy. The class-select UI now reinforces that with role badges plus re-scaled range bars that are readable against the lower stat ceilings.

- [x] **2.3 -- Level-up stat growth should be scaled down with the new baseline**
  - Existing `stat_growth` values were designed around much larger starting pools
  - Example: Knight currently gaining `+5 HP` per level is too large if starting HP is only `25-40`
  - **Fix:** Reduce `stat_growth` in each class to match the new lower-power baseline while preserving class identity
  - **Suggested direction:** HP growth around `+2` or `+3`, non-HP growth around `+1` where appropriate
  - **Files:** `shared/engine/content/classes/*.json`
  > NOTE: Implemented percentage-based stat growth instead of flat linear bonuses. Growth is now applied through shared engine logic and reused by both in-run level-ups and extraction-time catch-up level-ups, and level-up events now emit concrete `stat_gains` values instead of raw template rates.

- [x] **2.4 -- Update tests to lock the new ranges**
  - Keep the range assertions in sync so future edits cannot silently drift back upward
  - **Files:** `backend/__tests__/stats.test.ts`
  > NOTE: Added hard ceiling checks for new starting ranges, growth-rate bound checks, role-identity assertions, level-20 projection sanity checks, explicit combat threshold coverage for the low-scale accuracy/evasion model, and updated engine level-up assertions for percentage growth payloads.

> NOTE: Do not buff enemy stats in this group. The chosen balance direction is to bring players down to a more vulnerable starting state.

---

## Group 3: Realm Regeneration UI and Extraction Loot Accuracy

**Scope:** Frontend realm management, extraction summary payloads
**Depends on:** Group 1

- [x] **3.1 -- Realm regeneration exists in the backend but is unusable in the UI**
  - `POST /realms/:id/regenerate` is already implemented server-side
  - It resets the realm seed/state and charges both:
    - `100` gold
    - `realm_regen` x402 payment (`$0.25` by default)
  - The play UI only renders a disabled `Regenerate ($0.25)` button for completed realms
  - `frontend/app/hooks/use-realm.ts` does not expose a `regenerateRealm()` helper
  - **Fix:** Wire the frontend to the existing backend regeneration flow, payment modal, and realm refresh
  - **Files:** `frontend/app/hooks/use-realm.ts`, `frontend/app/play/page.tsx`, `backend/src/routes/realms.ts`
  > NOTE: Added `regenerateRealm()` to the realm hook, wired completed realm cards into the shared x402 payment modal, refreshed realm/character state after successful regeneration, and upgraded the replay UX with explicit reset messaging, dual-cost copy (`100` gold + `$0.25`), affordability feedback, and immediate `Ready` state recovery.

- [x] **3.2 -- Extraction loot summary incorrectly includes items brought into the realm**
  - `buildLootSummary(state.inventory)` currently returns the entire in-memory inventory on extraction
  - That includes shop-bought items or any other inventory loaded at session start
  - Result: the extraction screen claims those items were "Recovered Loot" even when they were never found in the realm
  - **Fix:** Snapshot starting inventory item IDs when the session is created and exclude those IDs from the extraction summary so only realm-gained items are listed
  - **Files:** `backend/src/game/session.ts`
  > NOTE: `GameSession.create()` now snapshots every starting inventory/equipment item ID and `applyExtractionOutcome()` filters those IDs out of `loot_summary`, so extraction only lists realm-earned loot even if starting gear was later unequipped into the bag.

- [x] **3.3 -- Add tests for regeneration flow and loot filtering**
  - Tests should verify:
    - completed realms can actually be regenerated through the intended UI/backend path
    - extraction summaries only show items gained during that run
  - **Files:** `backend/__tests__/session-extraction.test.ts`, relevant frontend hook/UI tests if present
  > NOTE: Added focused backend coverage for loot-summary filtering, regeneration rejection states, and successful paid regeneration. Updated the existing level-up extraction assertion to match the current percentage-growth system so the focused Group 3 suite stays accurate.

---

## Group 4: Realm Pickup Persistence Bug

**Scope:** Engine pickup IDs, backend inventory sync
**Why grouped alone:** This is a contained persistence bug with a concrete root cause

- [ ] **4.1 -- Realm-picked items fail to persist because their IDs are not UUIDs**
  - `resolvePickup()` currently copies the floor entity ID into the inventory item ID
  - Example floor entity IDs look like `f1_r1_bh-corrupted-heart_loot_00`
  - `inventory_items.id` in Postgres is `UUID`
  - `syncInventory()` upserts by `id`, so realm-picked items trigger a UUID cast failure
  - Shop items persist because they come from DB-generated UUIDs, and grant-item rewards persist because they already use `crypto.randomUUID()`
  - **Fix:** Change floor pickup item creation to use `crypto.randomUUID()` for the inventory item ID while continuing to use the floor entity ID for the world mutation (`"looted"`) record
  - **Files:** `shared/engine/src/turn.ts`, `backend/src/game/session.ts`, `supabase/migrations/20260407000000_initial_schema.sql`

- [ ] **4.2 -- Inventory sync failure should be easier to detect**
  - `syncInventory()` currently logs the upsert failure and aborts, which can make the bug easy to miss in gameplay
  - **Fix:** Improve observability around inventory sync failures so future persistence bugs are surfaced clearly in logs and tests
  - **Files:** `backend/src/game/session.ts`

- [ ] **4.3 -- Add tests that cover realm pickup persistence**
  - Tests should verify:
    - realm-picked items receive valid UUIDs
    - `syncInventory()` succeeds with realm-picked items
    - the bug cannot regress silently
  - **Files:** `shared/engine/__tests__/turn.test.ts`, backend session persistence tests

---

## Group 5: Equipment UI and Skill Tree Polish

**Scope:** Frontend inventory/equipment actions, skill tree validation and messaging
**Depends on:** Group 4

- [ ] **5.1 -- Equip and unequip logic exists but the UI does not expose it**
  - The engine and action validator already support:
    - `equip`
    - `unequip`
  - `computeLegalActions()` emits those actions
  - The play UI only renders equipment as read-only state, so items can sit stuck in inventory with no way to use them
  - **Fix:** In the dungeon UI, render equip/unequip controls based on `legal_actions`
  - Equip buttons should show the target slot and any meaningful stat bonuses
  - **Files:** `frontend/app/play/page.tsx`, `frontend/app/hooks/use-game-session.ts`, `shared/engine/src/turn.ts`

- [ ] **5.2 -- Skill point accrual is technically working but the UX is confusing**
  - Available points are derived from `max(0, (level - 1) - unlocked_count)`
  - Tier 1 unlocks at level 3
  - That means a level 2 character can earn their first point but still be unable to spend it
  - This may be acceptable design, but the current experience is unclear
  - **Fix:** Keep the current point accrual model unless testing proves it broken, but improve the UI text so players understand when their saved points become usable
  - **Files:** `frontend/app/play/page.tsx`, `backend/src/routes/characters.ts`

- [ ] **5.3 -- Skill tree validation does not enforce one choice per tier**
  - `docs/ABILITIES_AND_SKILLS.md` describes a one-choice-per-tier model
  - `validateSkillAllocation()` currently checks level gates, prerequisites, duplicates, and available points, but not mutual exclusion within the same tier
  - **Fix:** Reject allocations when another node in the same tier is already unlocked
  - **Files:** `backend/src/game/skill-tree.ts`, `backend/__tests__/skill-tree.test.ts`, `shared/engine/content/skill-trees/*.json`

- [ ] **5.4 -- Add tests and UI messaging coverage**
  - Add focused tests around:
    - one-choice-per-tier enforcement
    - equip/unequip action rendering or behavior where practical
  - Update player-facing text to explicitly explain when points are banked but tier-locked
  - **Files:** `backend/__tests__/skill-tree.test.ts`, frontend tests if present

> NOTE: If hub-side equip/unequip is desired, document the chosen approach inside the implementation. Dungeon-side equip controls are the minimum required to resolve the reported issue.

---

## Group 6: Stairs Up and Tutorial Gating

**Scope:** Multi-floor traversal, tutorial-first progression
**Depends on:** Group 1

- [ ] **6.1 -- Multi-floor realms only support descending, not ascending**
  - `tryFloorTransition()` only handles moving to `floor + 1`
  - `placeDoors()` only places descent stairs
  - This traps players on lower floors in realms like:
    - `shared/engine/content/realms/sunken-crypt.json`
    - `shared/engine/content/realms/collapsed-mines.json`
  - **Design decision:** Ascending should be allowed freely. It is a staircase.
  - **Fix:** Add a distinct tile such as `"stairs_up"` and support transitions to `floor - 1`
  - **Files:** `shared/engine/src/realm.ts`, `shared/engine/src/turn.ts`, `shared/schemas/src/index.ts`, `frontend/app/components/ascii-map.tsx`

- [ ] **6.2 -- Generate upward stairs on non-first floors**
  - Each non-first floor should provide a visible return path to the previous floor
  - **Fix:** Place `stairs_up` at the entrance side of each floor above floor 1 and update map rendering so players can distinguish up vs down stairs clearly
  - **Files:** `shared/engine/src/realm.ts`, `frontend/app/components/ascii-map.tsx`

- [ ] **6.3 -- Tutorial realm exists in content but is hidden from new players**
  - `tutorial-cellar` exists and is marked `is_tutorial: true`
  - The realm picker explicitly filters tutorial realms out of the UI
  - Character creation does not automatically route players into the tutorial flow
  - New characters can currently spend their one free realm on a more advanced realm
  - **Design decision:** New characters should only see the tutorial realm until it is completed. The tutorial is where they get their first equipment, and it should be the only free realm.
  - **Files:** `shared/engine/content/realms/tutorial-cellar.json`, `frontend/app/play/page.tsx`, `backend/src/routes/realms.ts`

- [ ] **6.4 -- Enforce tutorial-first progression in both UI and backend**
  - **Fix:** Implement the following together:
    - show only the tutorial realm for characters who have not completed it
    - keep the tutorial free regardless of account state
    - prevent non-tutorial realm generation until tutorial completion is recorded
    - only expose the normal realm list after the tutorial is completed
  - **Files:** `frontend/app/play/page.tsx`, `backend/src/routes/realms.ts`

- [ ] **6.5 -- Add tests for ascent and tutorial gating**
  - Add coverage for:
    - up-stair generation and traversal
    - floor return positioning
    - tutorial-only access before completion
    - non-tutorial generation rejection before tutorial completion
  - **Files:** engine traversal tests, backend route tests

---

## Group 7: Spectator Discovery and Legends Link Fixes

**Scope:** Spectator entry UX, legend navigation accuracy
**Why grouped:** Both issues are primarily frontend/navigation cleanup with a small API addition

- [ ] **7.1 -- Spectator mode has no entry page or discovery flow**
  - `/spectate/[characterId]` exists and works
  - There is no way to browse active live runs or enter spectator mode from the app naturally
  - **Fix:** Add a public endpoint that lists active spectatable sessions and build a spectator index page that links into the existing per-character spectate route
  - **Files:** `backend/src/game/active-sessions.ts`, `backend/src/index.ts`, `backend/src/server/security-config.ts`, `frontend/app/spectate/page.tsx`

- [ ] **7.2 -- Legends links are shown in places where there is nothing to show**
  - The legends API only returns data for dead characters
  - The leaderboard currently links all entries to `/legends/:characterId`, including alive characters, which causes avoidable 404s
  - The death screen says "Your legend has been written" but does not link to the new legend
  - **Fix:** Only show legend links when a dead-character legend actually exists; for live characters, use a different action if appropriate (for example, `Spectate` if that run is active)
  - **Files:** `frontend/app/leaderboard/page.tsx`, `frontend/app/play/page.tsx`, `backend/src/routes/legends.ts`

- [ ] **7.3 -- Add focused tests for active spectate listings and conditional legend links**
  - Tests should verify:
    - active sessions are exposed safely through the new API
    - alive characters do not render broken legend links
    - death flow provides a correct legend destination
  - **Files:** backend route tests, relevant frontend tests if present

> NOTE: During research, no actual "View Legends" button was found on the player info panel. The likely user-facing problem is the leaderboard linking alive characters to a legends page that only supports dead characters.

---

## Execution Order

Groups can mostly be worked in parallel, with these dependencies:

- **Group 1** before **Groups 3 and 6**
- **Group 4** before **Group 5**
- **Group 2** and **Group 7** are independent

## Priority Summary

| Priority | Groups | Description |
|----------|--------|-------------|
| **P0** | 1, 4 | Completion rewards and inventory persistence block core progression |
| **P1** | 2, 6 | Starting balance and tutorial/stairs strongly affect early gameplay quality |
| **P2** | 3, 5 | Realm UX, loot accuracy, equipment usability, skill-tree clarity |
| **P3** | 7 | Spectator discovery and legends navigation polish |

## Change Log

_Record completed fixes here with date and commit hash._

| Date | Group.Item | Commit | Notes |
|------|------------|--------|-------|
| 2026-04-09 | 1.1-1.3 | uncommitted | Added `realm_cleared`, wired backend completion rewards/persistence, covered bossless completion with tests, and polished bossless completion UI copy/state messaging. |
| 2026-04-09 | 2.1-2.4 | uncommitted | Rebalanced all class starting stats, switched level-ups to percentage-based growth, tuned low-scale hit chance math, added focused regression tests, and polished the class selection/stat reveal UI for the new ranges. |
| 2026-04-09 | 3.1-3.3 | uncommitted | Wired completed-realm regeneration into the play UI and payment modal with better replay messaging, filtered extraction loot to exclude items brought into the run, and added focused backend tests for regeneration plus loot-summary accuracy. |
