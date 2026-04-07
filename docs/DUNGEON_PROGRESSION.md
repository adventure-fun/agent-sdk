# Adventure.fun — Dungeon Progression Spec

> **Related:** [CONTENT.md](./CONTENT.md) for template formats · [GAME_DESIGN.md](./GAME_DESIGN.md) for mechanics · [ECONOMY.md](./ECONOMY.md) for free tier and pricing

## 1. Overview

Dungeons are released as `RealmTemplate` content packs. They progress from a handcrafted tutorial through increasingly complex procedural dungeons connected by an overarching storyline. Each dungeon introduces new mechanics, enemies, and narrative depth while reinforcing the core loop: explore, fight, loot, survive, extract.

### Design Principles

- **Teach through play, not text.** The tutorial dungeon teaches mechanics by making the player use them, not by explaining them.
- **Every dungeon introduces something new.** A new enemy type, a new mechanic (traps, keys, boss phases), or a new narrative thread.
- **The story is optional but rewarding.** Players who read lore get strategic hints. Players who skip it can still progress.
- **Difficulty scales through complexity, not just stats.** Harder dungeons have more rooms, branching paths, traps, keys, and multi-phase bosses — not just bigger HP numbers.

---

## 2. Dungeon Tier System

| Tier | Dungeons | Rooms | Floors | Cost | Purpose |
|---|---|---|---|---|---|
| **Tutorial** | 1 | 2 | 1 | Free (every account) | Learn mechanics, get starter gear |
| **Tier 1** | 2-3 | 5-8 | 1 | x402 ($0.25) | First real challenge, introduces traps and keys |
| **Tier 2** | 2-3 | 10-15 | 2-3 | x402 ($0.25) | Multi-floor, bosses, branching paths |
| **Tier 3** | 1-2 | 15-25 | 3-5 | x402 ($0.25) | Full dungeons with deep lore, complex bosses |

v1 ships with: Tutorial + 2 Tier 1 dungeons + 1 Tier 2 dungeon. Additional dungeons are content updates post-launch.

---

## 3. The Overarching Story

### The Premise

*The world of Adventure.fun was once protected by four ancient Guardians — warriors, scholars, tricksters, and hunters who sealed away a creeping corruption known as the Hollow. Centuries later, the seals are failing. The Hollow is leaking through cracks in forgotten places — cellars, mines, crypts, ruins. New heroes must descend into these corrupted sites, push back the Hollow, and discover what broke the seals.*

### The Story Arc (Hero's Journey)

| Phase | Dungeons | Narrative Beat |
|---|---|---|
| **The Call** | Tutorial: The Cellar | Something is wrong beneath the town. You're sent to investigate. |
| **First Trial** | Tier 1: The Collapsed Passage | The corruption runs deeper than anyone thought. You find evidence of the old seals. |
| **Deepening Mystery** | Tier 1: The Blighted Hollow | You encounter the corruption directly. Lore reveals the Guardians' sacrifice. |
| **Descent** | Tier 2: The Sunken Crypt | You follow the trail to an ancient Guardian's tomb. A corrupted Guardian awaits. |
| **Escalation** | Tier 2-3: future content | More seals, more Guardians, the source of the Hollow |

Each dungeon's lore fragments connect to this arc. A player who collects lore across multiple dungeons (and multiple characters — lore persists on legend pages) can piece together the full story.

---

## 4. Tutorial Dungeon: "The Cellar"

### Design Goal

Teach the complete game loop in 2 rooms with zero prior knowledge. The player should learn: movement, interacting with objects, equipping items, combat, using items, and extracting.

### Template Configuration

```
RealmTemplate {
  id: "tutorial-cellar"
  name: "The Cellar"
  description: "Something stirs beneath the old inn. The innkeeper asks you to investigate."
  theme: "cellar"
  version: 1
  floor_count: { min: 1, max: 1 }
  difficulty_tier: 0
  is_tutorial: true
  procedural: false                    // fully handcrafted, no random generation
}
```

### Room 1: "The Storeroom"

**Layout:** 5x5 tile grid. Entrance on south wall. Door to Room 2 on north wall.

**On entry (room text):**
> *Dusty barrels and broken crates line the walls. The air smells of damp earth and something sour. A wooden chest sits in the corner, still latched.*

**Contents:**
- 1 chest (interactable) containing class-specific starter weapon:
  - Knight: Iron Sword (+5 attack)
  - Mage: Oak Staff (+4 attack, +2 mana regen per rest)
  - Rogue: Rusty Dagger (+3 attack, +2 speed)
  - Archer: Short Bow (+4 attack, range 3) + 10 Arrows
- No enemies
- Door to Room 2 is visible and unlocked

**What the player learns:**
- Movement (navigate to chest)
- Interact action (open chest)
- Pickup action (take weapon)
- Equip action (equip weapon)
- Move to next room (use door)

**Interactable — the chest:**
```
InteractableTemplate {
  id: "tutorial-chest-weapon"
  name: "Wooden Chest"
  text_on_interact: "The latch gives way. Inside, wrapped in oilcloth: {class_specific_weapon}."
  conditions: []
  effects: [
    { type: "grant_item", item_template_id: "{class_weapon_id}" }
  ]
  lore_entry_id: null
}
```

The `{class_specific_weapon}` is resolved at generation time based on the character's class.

### Room 2: "The Burrow"

**Layout:** 7x7 tile grid. Entrance on south wall (from Room 1). No exit beyond — must return through Room 1 to extract.

**On entry (room text):**
> *The cellar opens into a dug-out burrow. Claw marks score the walls. A hunched figure snarls at you from behind a battered chest — a Hollow Rat, larger than any rat should be, its eyes glowing faintly violet.*

**Contents:**
- 1 enemy: Hollow Rat (tutorial-tier, very low stats)
- 1 chest (locked behind the enemy — interactable only after enemy is defeated)
  - Contains: 2 Health Potions + 15 gold
- Lore interactable on the wall (optional): scratched tally marks

**What the player learns:**
- Combat (attack the rat)
- Taking damage (rat attacks back)
- Looting (open chest after combat)
- Using items (can use health potion if injured)
- Extraction (must walk back through Room 1 to the entrance to leave)
- The extraction rule: there is no auto-complete, you must leave the way you came

**Enemy — Hollow Rat:**
```
EnemyTemplate {
  id: "hollow-rat"
  name: "Hollow Rat"
  stats: { hp: 15, attack: 3, defense: 1, accuracy: 60, evasion: 20, speed: 4 }
  abilities: ["basic_bite"]
  behavior: "aggressive"
  loot_table: "tutorial-rat-loot"
  xp_value: 10
  difficulty_tier: 0
}
```

Designed to be killed in 2-3 hits by any class with the starter weapon. Deals low damage — enough to teach the player about HP but not enough to kill unless they do nothing.

**Lore interactable — wall scratches:**
```
InteractableTemplate {
  id: "tutorial-wall-scratches"
  name: "Scratched Tally Marks"
  text_on_interact: "Someone counted days here. The last marks are frantic, overlapping. Below them, scratched in a shaking hand: 'it came from below.'"
  conditions: []
  effects: [{ type: "reveal_lore", lore_id: "cellar-warning-01" }]
  lore_entry_id: "cellar-warning-01"
}
```

**Lore entry:**
```
LoreTemplate {
  id: "cellar-warning-01"
  title: "The Cellar Warning"
  text: "Someone was trapped in the cellar before you. They counted seven days before something drove them deeper — or consumed them. The violet glow in the rat's eyes is not natural."
  category: "history"
  strategic_hint: false
}
```

### Tutorial Completion

When the player returns to the entrance of Room 1 after clearing Room 2:
- Realm status → COMPLETED
- XP awarded: 25 (rat kill + room discovery + completion)
- Player returns to lobby with: starter weapon, 2 health potions, 15 gold, 25 XP
- This is enough gold to buy 1-2 more potions or save toward a portal scroll

---

## 5. Tier 1 Dungeons

### 5.1: "The Collapsed Passage"

**Theme:** Abandoned mine tunnel. Unstable, claustrophobic. Introduction to traps and locked doors.

**Structure:** 1 floor, 6 rooms

```
[Entrance] → [Shaft Junction] → [Flooded Chamber]
                    ↓
              [Tool Storage] → [Locked Gate] → [Overseer's Den]
```

**New mechanics introduced:**
- **Locked door:** Gate to Overseer's Den requires a key found in Flooded Chamber.
- **Branching path:** Junction offers choice of which direction to explore first.

**Enemies:**
- Hollow Rats (2-3, scattered)
- Cave Crawler (new enemy: slow, tanky, ambush behavior — hides in dark corners)

**Boss:** None (Tier 1 doesn't have bosses)

**Loot highlights:**
- Uncommon equipment drop in Overseer's Den
- Key item: Mine Key (found in Flooded Chamber, opens Locked Gate)
- Gold scattered in chests and floor drops

**Narrative thread:**
- Room text establishes that miners abandoned this passage suddenly
- Lore fragments reveal the mine broke through into something old beneath
- Connects to the Hollow backstory: "They dug too deep and found violet stone"

**Flavor text examples:**

*Shaft Junction:*
> *Three tunnels branch from here. The left one is flooded ankle-deep. The center one has fresh claw marks on the support beams. The right one is blocked by a rusted gate.*

*Flooded Chamber:*
> *Water seeps from cracks in the ceiling. Mining tools lie scattered as if dropped mid-swing. A corroded lockbox sits on a stone ledge above the waterline.*

*Overseer's Den (strategic lore):*
> *A journal lies open on the desk. The last entry reads: 'The crawlers avoid the light from the blue crystals. We've started lining the main shaft with them, but supply is running low.'*

This teaches the player that lore can carry gameplay hints — Cave Crawlers might have a light-based weakness in future dungeons.

### 5.2: "The Blighted Hollow"

**Theme:** Forest cave system corrupted by the Hollow. Organic, unsettling. Introduction to status effects.

**Structure:** 1 floor, 7 rooms

**New mechanics introduced:**
- **Poison:** Blight Spores (environmental hazard) deal poison DoT if player enters without clearing them first
- **Status effects in combat:** Blighted Wolves apply a slow debuff on hit
- **Trapped chest:** One chest is trapped — deals damage when opened. Players learn that not every chest is safe. Risk/reward: the trapped chest contains rare loot.

**Enemies:**
- Blighted Wolf (new: fast, applies slow debuff, pack behavior — 2 appear together)
- Hollow Spore (new: stationary, defensive, explodes poison AoE when killed at melee range — ranged classes have advantage)

**Boss:** None

**Loot highlights:**
- Antidote consumable (cures poison — teaches player about debuff management)
- Rare equipment possible from trapped chest (risk/reward)
- First portal scroll drop (low chance, from hidden chest)

**Narrative thread:**
- The corruption is visibly spreading into the natural world
- Lore reveals the first Guardian was a ranger who sealed the Hollow here
- The seal is cracked — violet light seeps through tree roots

---

## 6. Tier 2 Dungeon

### 6.1: "The Sunken Crypt"

**Theme:** Ancient burial site of the first Guardian. Undead enemies. Water hazards. The first boss encounter.

**Structure:** 3 floors, 12-15 rooms total

**Floor 1: The Antechamber (4-5 rooms)**
- Entry hall with lore-rich murals (interactables)
- Skeleton Warriors (new enemy: moderate stats, patrol behavior)
- Locked door requiring a Crypt Key (found in a side room)

**Floor 2: The Flooded Tombs (4-5 rooms)**
- Partially flooded rooms with limited movement (some tiles are water — slow movement)
- Drowned Husks (new enemy: slow but high HP, ambush from water tiles)
- Lore interactables: wall carvings depicting the Guardian's sacrifice
- Strategic lore: *"The Warden's armor weakens when the braziers are lit"* — hints at boss mechanic

**Floor 3: The Warden's Chamber (3-4 rooms)**
- Pre-boss room with a rest shrine (one-time free heal — teaches that rest shrines exist)
- **Boss: The Hollow Warden** — a corrupted Guardian
  - Phase 1: Standard melee attacks, high defense
  - Phase 2 (below 50% HP): Summons 2 Skeleton Warriors, gains ranged attack
  - Mechanic: Lighting the braziers in the room (interact action) reduces Warden's defense by 40%
  - Players who found the lore hint on Floor 2 know this; others must figure it out or brute-force
- Post-boss room with a treasure vault (high-value loot)
- **Must still extract alive** — walk back through all 3 floors to entrance

**Loot highlights:**
- Rare and Epic equipment possible from boss and vault
- Gold rewards significantly higher than Tier 1
- Lore completion: full story of the first Guardian's fall to the Hollow

**Narrative climax:**
- The Guardian didn't just seal the Hollow — they absorbed part of it to create the seal
- The Hollow corrupted them over centuries
- Defeating the Warden breaks the first seal further — the Hollow grows stronger
- Sets up Tier 3: "If one seal is broken, the others may be failing too"

---

## 7. Dungeon Feature Progression Matrix

Shows which mechanics each dungeon introduces:

| Feature | Tutorial | Collapsed Passage | Blighted Hollow | Sunken Crypt |
|---|---|---|---|---|
| Movement | ✅ | ✅ | ✅ | ✅ |
| Combat (basic) | ✅ | ✅ | ✅ | ✅ |
| Interact / loot | ✅ | ✅ | ✅ | ✅ |
| Equip items | ✅ | ✅ | ✅ | ✅ |
| Extraction | ✅ | ✅ | ✅ | ✅ |
| Locked doors / keys | | ✅ | | ✅ |
| Branching paths | | ✅ | ✅ | ✅ |
| Status effects | | | ✅ | ✅ |
| Trapped chests | | | ✅ | ✅ |
| Environmental hazards | | | ✅ | ✅ |
| Multiple floors | | | | ✅ |
| Boss encounter | | | | ✅ |
| Boss mechanics (interactive) | | | | ✅ |
| Strategic lore hints | | | ✅ | ✅ |
| Rest shrine | | | | ✅ |

---

## 8. Implementation Details

### Handcrafted vs Procedural

| Dungeon | Generation Mode | Rationale |
|---|---|---|
| Tutorial: The Cellar | **Fully handcrafted** | Must be identical for every player. Teaching sequence can't vary. |
| Tier 1 dungeons | **Semi-procedural** | Room layout is fixed (handcrafted graph), but enemy placement, loot rolls, and trap positions vary by seed within defined slots. |
| Tier 2+ dungeons | **Procedural with constraints** | Room graph generated from seed, but boss room placement, key/lock chains, and floor transitions follow template rules. |

### How Templates Map to the Engine

The `RealmTemplate` (defined in CONTENT.md) already supports everything needed:

- `procedural: false` for tutorial — engine uses fixed room layout instead of generating from seed
- `room_distribution` weights control room type frequency for procedural dungeons
- `enemy_roster` defines which enemies can appear
- `loot_tables` define drop pools per room type
- `narrative.room_text_pool` provides flavor text
- `narrative.lore_pool` links to `LoreTemplate` entries
- `narrative.interactable_pool` provides inspectable objects
- `TriggerTemplate` handles conditional events (boss phase changes, locked doors, trapped chests)

### Class-Specific Tutorial Loot

The tutorial chest uses a `Condition` to grant different items:

```json
{
  "effects": [
    { "type": "grant_item", "item_template_id": "weapon-iron-sword", "condition": { "type": "class_is", "class": "knight" } },
    { "type": "grant_item", "item_template_id": "weapon-rusty-dagger", "condition": { "type": "class_is", "class": "rogue" } },
    { "type": "grant_item", "item_template_id": "weapon-oak-staff", "condition": { "type": "class_is", "class": "mage" } },
    { "type": "grant_item", "item_template_id": "weapon-short-bow", "condition": { "type": "class_is", "class": "archer" } }
  ]
}
```

This requires a small extension to the `Effect` type in CONTENT.md — effects with inline conditions. Alternatively, implement as four separate `TriggerTemplate` entries, each with a `class_is` condition.

### Locked Doors and Keys

Locked doors use the existing entity/mutation system:

1. Door entity `f1_r4_door_01` is generated with `locked: true`
2. Key item `crypt-key` is placed in a chest in another room
3. When player uses `interact` on the locked door:
   - Engine checks `has_item: "crypt-key"` condition
   - If true: door mutation `unlocked`, key consumed, door opens
   - If false: "The gate is locked. You need a key."

### Trapped Chests

Trapped chests trigger when opened — there is no pre-detection for most classes.

- `interact` on a trapped chest → trap triggers (damage + possible poison), then chest opens and loot is available
- The player takes the hit as the cost of looting
- **Rogue Tier 1 skill tree (level 3): "Disarm Trap"** — active ability, costs 1 energy, targets a chest. If trapped, disarms it. If not, nothing happens. This is a class-defining utility that makes Rogues the safe looters.
- **Consumable (future): Trap Disarm Kit** — purchasable item that lets any class disarm one chest. Gold cost makes it a loadout decision.

Implementation: `TriggerTemplate` on the chest interactable with `fire_once: true`, effect `{ type: "deal_damage", amount: 15 }`. Trap fires on `interact`. The Rogue's Disarm Trap ability adds a mutation `{ entity_id: "f1_r3_chest_01", mutation: "disarmed" }` — the trigger checks for this mutation before firing.

### Key/Lock Dependency Chains

For procedural dungeons (Tier 2+), the engine must guarantee:

1. The key room is always reachable before the locked door
2. The locked door is never on the only path to the key
3. At least one path to the boss exists through locked doors (prevents softlocks)

This is a constraint on the room graph generator, not on the template. The generator builds a dependency chain: `key_room → ... → locked_door → ... → boss_room` and ensures the graph satisfies it.

---

## 9. Enemy Roster (v1 Complete)

| Enemy | Tier | HP | Behavior | Special | First Appears |
|---|---|---|---|---|---|
| Hollow Rat | 0 | 15 | Aggressive | None | Tutorial |
| Cave Crawler | 1 | 35 | Ambush | Surprise attack from hiding | Collapsed Passage |
| Blighted Wolf | 1 | 25 | Aggressive (pack) | Slow debuff on hit, appears in pairs | Blighted Hollow |
| Hollow Spore | 1 | 20 | Defensive | Poison AoE on melee kill | Blighted Hollow |
| Skeleton Warrior | 2 | 45 | Patrol | Moderate all-around stats | Sunken Crypt |
| Drowned Husk | 2 | 60 | Ambush | High HP, slow, ambushes from water | Sunken Crypt |
| The Hollow Warden | 2 (boss) | 150 | Boss | 2 phases, summons adds, brazier mechanic | Sunken Crypt |

All enemy definitions live in `packages/engine/content/enemies/` as JSON files per theme.

---

## 10. Lore Progression

Lore fragments are collected across dungeons and persist on legend pages (even after death). They tell the story of the Guardians and the Hollow across multiple characters and playthroughs.

### Lore Categories

| Category | Purpose | Example |
|---|---|---|
| **History** | World backstory | "The four Guardians sealed the Hollow at the cost of their mortality" |
| **Bestiary** | Enemy intel | "Hollow Spores release toxic clouds when destroyed at close range" |
| **Guardian Journals** | Character-driven narrative | "Day 47. The violet light is beautiful. I understand now why it calls to us." |
| **Hints** | Strategic gameplay value | "The Warden's armor weakens when the braziers are lit" |
| **Warnings** | Foreshadowing for future content | "The eastern seal was always the weakest. If the Crypt falls, the Reach is next." |

### Codex Structure

The player's codex (discovered lore) organizes entries by dungeon and category. On legend pages, a dead character's codex is fully visible — spectators and other players can read the lore a fallen hero discovered.

---

## 11. Future Dungeon Roadmap (Post-v1)

| Dungeon | Tier | Theme | Story Beat |
|---|---|---|---|
| The Withered Reach | 2 | Corrupted forest, outdoor ruins | Second Guardian's domain, nature corruption |
| The Iron Depths | 3 | Deep underground forge complex | Third Guardian's domain, construct enemies |
| The Hollow Throne | 3 | The source of the corruption | Final Guardian, climactic boss |
| Seasonal dungeons | Varies | Limited-time themed content | Holiday events, community challenges |
| Community dungeons | Varies | Contributor-designed (post-v1 pipeline) | Expanded world via open-source content packs |

---

## 12. Content Authoring Workflow

### For v1 (Team-Authored)

1. Design dungeon on paper: room graph, enemy placement, loot tables, narrative beats
2. Write JSON template files following CONTENT.md interfaces
3. Run reference agent through dungeon in local testing harness
4. Verify: beatable by all 4 classes, balanced XP/gold rewards, no softlocks
5. Review flavor text and lore for consistency with overarching story
6. Merge into `packages/engine/content/realms/`

### For Post-v1 (Community-Authored)

Community dungeon contributions follow the same template format. Contributors submit:
- `RealmTemplate` JSON
- Associated `RoomTemplate`, `EnemyTemplate`, `LoreTemplate` entries
- A brief design doc explaining the dungeon's theme and narrative connection

Review criteria: balance, no softlocks, lore consistency, playtested by reference agent. Dungeons are declarative content packs — no executable code from contributors in v1.
