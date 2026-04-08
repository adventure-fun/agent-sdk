# Adventure.fun — Classes, Abilities & Skill Trees Spec

> **Related:** [CONTENT.md](./specs/CONTENT.md) for schema interfaces · [GAME_DESIGN.md](./specs/GAME_DESIGN.md) for combat rules · [DUNGEON_PROGRESSION.md](./specs/DUNGEON_PROGRESSION.md) for progression context

## 1. File Locations

```
packages/engine/content/
├── classes/
│   ├── knight.json           # ClassTemplate: stats, growth, resource, references to abilities + tree
│   ├── mage.json
│   ├── rogue.json
│   └── archer.json
├── abilities/
│   ├── shared.json           # basic-attack (available to all classes)
│   ├── knight.json           # all Knight abilities (starting + skill tree unlocks)
│   ├── mage.json
│   ├── rogue.json
│   └── archer.json
└── skill-trees/
    ├── knight-tree.json      # SkillTreeDefinition for Knight
    ├── mage-tree.json
    ├── rogue-tree.json
    └── archer-tree.json
```

The class JSON references ability IDs and skill tree IDs. The engine loads all three to build the full class definition. Abilities and skill trees are separate files because the engine needs to look up abilities by ID at combat resolution time — they're not just class metadata.

---

## 2. How Classes Work

### At Character Creation

1. Player chooses a class
2. Engine loads the `ClassTemplate` for that class
3. Stats are randomized within `stat_roll_ranges` (±5% of `base_stats`)
4. Character receives `starting_abilities` (always available, no unlock needed)
5. Character receives `basic-attack` from shared abilities (every class gets this)
6. Resource pool set to `resource_max` at full
7. Skill tree is loaded but all nodes are locked

### During Gameplay

- Character earns XP → levels up → gains 1 skill point per level
- Stat growth applied per level (from `stat_growth`)
- Resource max may increase with level (optional, config-driven)
- At tier unlock levels (3, 6, 10), the corresponding skill tree tier becomes available
- Player spends skill points to pick ONE node per tier (branching choice, irreversible)

### ClassTemplate Fields

| Field | Purpose |
|---|---|
| `id` | Class identifier (`"knight"`, `"mage"`, `"rogue"`, `"archer"`) |
| `name` | Display name |
| `description` | Class fantasy description |
| `base_stats` | Midpoint stats — used for derived calculations and reroll baseline |
| `stat_roll_ranges` | `[min, max]` per stat for character creation randomization |
| `stat_growth` | Per-level stat increases |
| `resource_type` | `"stamina"` / `"mana"` / `"energy"` / `"focus"` |
| `resource_max` | Starting resource pool size |
| `resource_regen_rule` | How the resource regenerates each turn |
| `starting_abilities` | Ability IDs available immediately (not counting basic-attack) |
| `skill_tree_id` | Reference to the SkillTreeDefinition file |
| `starting_equipment` | Item template IDs character spawns with (empty — tutorial provides gear) |
| `visibility_radius` | Fog of war sight range in tiles |

---

## 3. How Abilities Work

### Resolution Flow (Every Time an Ability Is Used)

```
Player submits: { type: "attack", target_id: "f1_r2_enemy_01", ability_id: "backstab" }
    │
    ├── Does the character have this ability?
    │     (starting_abilities + any granted by skill tree nodes)
    │     NO → reject action, return error
    │
    ├── Does the character have enough resource?
    │     (resource_current >= ability.resource_cost)
    │     NO → reject action, return error
    │
    ├── Is the ability off cooldown?
    │     (cooldowns[ability_id] == 0)
    │     NO → reject action, return error
    │
    ├── Is the target in range?
    │     ("melee" = adjacent tile, number = tile distance with line of sight)
    │     NO → reject action, return error
    │
    ├── All checks pass → RESOLVE:
    │     1. Roll hit/miss: attacker effective_accuracy vs defender effective_evasion
    │     2. If hit: calculate damage
    │        damage = (ability.base + (character[ability.stat_scaling] * ability.scaling_factor))
    │        damage = damage - target.defense  (min 1)
    │     3. Apply each status effect: roll apply_chance, if success add to target
    │     4. If ability.special exists: run hardcoded engine behavior
    │     5. Deduct resource_cost from character
    │     6. Set cooldowns[ability_id] = ability.cooldown_turns
    │
    └── Return result in observation.recent_events
```

### Key Rules

- `basic-attack` always costs 0 resource and has 0 cooldown — it's the fallback
- Class starting abilities are always available, never locked behind skill tree
- Skill tree abilities are available only after the player unlocks the corresponding node
- `target: "self"` abilities skip hit/miss and range checks
- `target: "aoe"` hits all entities within `aoe_radius` tiles of the target point
- `target: "single_or_self"` allows targeting self OR another entity in range (used by cleric healing abilities)
- `special` field triggers hardcoded engine behavior that can't be expressed through the template

### Healing Effects

The cleric abilities require effect types not in the current `StatusEffect` interface. These need to be added:

| Effect Type | Behavior | Used By |
|---|---|---|
| `"heal_hp"` | Restore HP to target. `magnitude` = base heal amount. Can be combined with stat scaling from the damage formula (repurposed as heal formula). | Healing Light, Restoration |
| `"cure_debuffs"` | Remove all negative status effects from target. | Purify |

These are **effect types**, not `special` values — they should work through the standard ability resolution flow, just applied as beneficial effects instead of damage. The engine's ability resolver needs to check: if the ability has `heal_hp` or `cure_debuffs` effects, skip the hit/miss roll and apply directly.

### The `special` Field

Most abilities should work through the standard damage + effects formula. The `special` field is an escape hatch for abilities that need unique engine behavior. Each `special` value is a named case in the engine's ability resolver.

| Special Value | Behavior | Used By |
|---|---|---|
| `"counter_on_hit"` | If character is hit this turn, automatically counter-attack | Knight: Riposte |
| `"self_damage_20pct"` | Deal 20% of max HP to self on use | Knight: Berserker Rage |
| `"restore_resource_on_hit"` | Restore resource equal to `magnitude` on successful hit | Mage: Mana Drain |
| `"reveal_room_enemies"` | Reveal all enemies in current room ignoring fog of war | Mage: Arcane Sight |
| `"portal_escape"` | Exit dungeon immediately, return to lobby with loot | Mage: Portal |
| `"stealth"` | Become untargetable for N turns, break on attack | Rogue: Vanish (upgrade) |
| `"disarm_trap"` | Target a chest, if trapped remove the trap | Rogue: Disarm Trap |
| `"mark_target"` | Next attack against this target deals double damage | Rogue: Death Mark |
| `"piercing_shot"` | Ignore target defense entirely | Archer: Piercing Shot |
| `"multishot"` | Hit all enemies in a line (not AoE radius) | Archer: Volley |
| `"disengage"` | Move 2 tiles away from target after attacking | Archer: Disengage |

New `special` values require engine code changes. Don't add them lightly.

---

## 4. How Skill Trees Work

### Structure

Each class has one skill tree with 3 tiers. Each tier has 2-3 mutually exclusive choices. Picking one locks out the others in that tier permanently. No respec in v1.

```
Tier 1 (unlocks at Level 3):   Choice A  |  Choice B
Tier 2 (unlocks at Level 6):   Choice A  |  Choice B
Tier 3 (unlocks at Level 10):  Choice A  |  Choice B
```

### Skill Point Economy

- 1 skill point per level-up
- Each node costs 1 skill point (v1 — keep it simple)
- Players will have more skill points than tier unlocks, but tier gates (level requirement) prevent rushing
- Extra skill points beyond tier choices are banked (future use: sub-nodes, passive upgrades)

### Node Effect Types

| Effect Type | What It Does | Example |
|---|---|---|
| `grant_ability` | Unlocks a new ability the character can use in combat | "Learn Cleave" |
| `passive_stat` | Permanently increases a stat | "+5 max HP" |
| `passive_effect` | Adds a permanent mechanic | "10% chance to dodge attacks" |

### Prerequisites

Tier 2 nodes can require a specific Tier 1 choice. Tier 3 nodes can require a specific Tier 2 choice. This enables branching specialization paths.

Example: Knight Tier 3 "Fortress" requires Tier 1 "Shield Wall" (defensive path). Knight Tier 3 "Berserker Rage" requires Tier 1 "Cleave" (offensive path).

### Where Skill Tree State Is Stored

On the character record in the database:
```json
{
  "skill_tree": {
    "tier_1": "knight-shield-wall",
    "tier_2": "knight-iron-skin",
    "tier_3": null
  },
  "skill_points": 2
}
```

The engine checks this when determining available abilities: starting abilities + any abilities granted by selected skill nodes.

---

## 5. Complete Ability & Skill Tree Roster

### Shared (All Classes)

| ID | Name | Type | Cost | CD | Range | Notes |
|---|---|---|---|---|---|---|
| `basic-attack` | Basic Attack | Damage | 0 | 0 | melee | Weapon-based, always available |

---

### Knight

**Identity:** Tanky frontliner. High HP and defense. Stamina regenerates passively (+1/turn, +3 on defend). Melee-only. The last one standing.

**Starting Abilities:**

| ID | Name | Type | Cost | CD | Range | Notes |
|---|---|---|---|---|---|---|
| `knight-slash` | Slash | Damage | 3 stam | 0 | melee | 1.2x attack scaling, 30% chance to reduce target defense by 2 for 2 turns |
| `knight-shield-block` | Shield Block | Defensive | 0 stam | 2 | self | +8 defense for 1 turn, regenerates bonus stamina |

**Skill Tree:**

```
TIER 1 (Level 3) ─── Pick one:
│
├── [knight-t1-shield-wall] Shield Wall
│     grant_ability: "knight-shield-wall"
│     A: 8 stam, 6 CD, self
│     +15 defense for 3 turns, but immobilized (slow magnitude 99)
│
└── [knight-t1-cleave] Cleave
      grant_ability: "knight-cleave"
      A: 6 stam, 3 CD, melee AoE radius 1
      Hits all adjacent enemies, 0.8x attack scaling

TIER 2 (Level 6) ─── Pick one:
│
├── [knight-t2-iron-skin] Iron Skin
│     passive_stat: defense +4
│     Permanent defense increase. Simple but strong.
│
└── [knight-t2-riposte] Riposte
      grant_ability: "knight-riposte"
      A: 4 stam, 3 CD, self
      Counter-attack stance: if hit this turn, auto-strike back
      special: "counter_on_hit"

TIER 3 (Level 10) ─── Pick one:
│
├── [knight-t3-fortress] Fortress
│     prerequisite: knight-t1-shield-wall
│     grant_ability: "knight-fortress"
│     A: 12 stam, 8 CD, self
│     +10 defense for 4 turns. Future co-op: also buffs allies.
│
└── [knight-t3-berserker] Berserker Rage
      prerequisite: knight-t1-cleave
      grant_ability: "knight-berserker-rage"
      A: 10 stam, 10 CD, self
      Lose 20% max HP, gain +12 attack for 5 turns
      special: "self_damage_20pct"
```

**Design notes:** The Knight branches into a defensive tank (Shield Wall → Iron Skin → Fortress) or an aggressive bruiser (Cleave → Riposte → Berserker). Both are viable — the tank survives deeper, the bruiser clears faster.

---

### Mage

**Identity:** Glass cannon. Highest burst damage, lowest HP. Mana does NOT regenerate passively — restored only by potions, inn, or Mana Drain. Resource management is the core challenge.

**Starting Abilities:**

| ID | Name | Type | Cost | CD | Range | Notes |
|---|---|---|---|---|---|---|
| `mage-arcane-bolt` | Arcane Bolt | Damage | 5 mana | 0 | 4 tiles | 1.3x attack scaling, ranged primary attack |
| `mage-mana-shield` | Mana Shield | Defensive | 8 mana | 4 | self | +12 defense for 2 turns |

**Skill Tree:**

```
TIER 1 (Level 3) ─── Pick one:
│
├── [mage-t1-frost-nova] Frost Nova
│     grant_ability: "mage-frost-nova"
│     A: 10 mana, 4 CD, melee AoE radius 2
│     Damage + 80% chance to slow for 2 turns
│     Emergency crowd control for when enemies close in
│
├── [mage-t1-fireball] Fireball
│     grant_ability: "mage-fireball"
│     A: 12 mana, 3 CD, 5 tiles range
│     High single-target damage (base 15, 1.5x scaling)
│     Pure damage upgrade over Arcane Bolt
│
└── [mage-t1-healing-light] Healing Light
      grant_ability: "mage-healing-light"
      A: 6 mana, 2 CD, 3 tiles range
      Restore 15 + (attack * 0.4) HP to self or target ally
      No damage. The entry point to the cleric path.
      target: "single_or_self"

TIER 2 (Level 6) ─── Pick one:
│
├── [mage-t2-arcane-sight] Arcane Sight
│     grant_ability: "mage-arcane-sight"
│     A: 6 mana, 8 CD, self
│     Reveals all enemies in current room for 3 turns
│     special: "reveal_room_enemies"
│
├── [mage-t2-mana-drain] Mana Drain
│     grant_ability: "mage-mana-drain"
│     A: 0 mana, 5 CD, 3 tiles range
│     Moderate damage + restores 8 mana on hit
│     special: "restore_resource_on_hit"
│     The Mage's only way to regenerate mana in combat
│
└── [mage-t2-purify] Purify
      prerequisite: mage-t1-healing-light
      grant_ability: "mage-purify"
      A: 8 mana, 5 CD, 3 tiles range
      Remove all debuffs from self or target ally + heal 10 HP
      target: "single_or_self"
      Critical for poison/slow/blind removal in blight-heavy dungeons

TIER 3 (Level 10) ─── Pick one:
│
├── [mage-t3-portal] Portal
│     prerequisite: none
│     grant_ability: "mage-portal"
│     A: 20 mana, 1 use per dungeon run
│     Exit dungeon immediately with all loot
│     special: "portal_escape"
│     The Mage's class-defining escape — but costs almost all mana
│
├── [mage-t3-meteor] Meteor Strike
│     prerequisite: mage-t1-fireball
│     grant_ability: "mage-meteor"
│     A: 25 mana, 8 CD, 5 tiles range
│     Massive AoE damage (base 25, 1.8x scaling, radius 2)
│     Room-clearing nuke. Expensive.
│
└── [mage-t3-restoration] Restoration
      prerequisite: mage-t2-purify
      grant_ability: "mage-restoration"
      A: 18 mana, 8 CD, 3 tiles range
      Massive heal: 40 + (attack * 0.8) HP + grants +5 defense for 3 turns
      target: "single_or_self"
      The ultimate sustain ability. Expensive but can save a run.
```

**Design notes:** The Mage now has three distinct paths. **Utility:** Frost Nova → Arcane Sight → Portal (survivalist). **Damage:** Fireball → Mana Drain → Meteor (glass cannon). **Cleric:** Healing Light → Purify → Restoration (healer — solo sustain now, co-op support later). Mana Drain on the damage path is critical — without it the damage Mage runs dry. Portal on the utility path gives the only class-based dungeon escape. The cleric path trades offensive power for self-sustain and will become the most valuable path in future co-op play.

---

### Rogue

**Identity:** Burst damage in windows. Energy fully resets every 3 turns — spend everything, wait, repeat. High evasion and speed. Stealth and utility. **The only class that can disarm chest traps.**

**Starting Abilities:**

| ID | Name | Type | Cost | CD | Range | Notes |
|---|---|---|---|---|---|---|
| `rogue-backstab` | Backstab | Damage | 2 energy | 0 | melee | 1.1x attack scaling, high base damage (22). Bread and butter. |
| `rogue-dodge-roll` | Dodge Roll | Defensive | 1 energy | 2 | self | +15 evasion for 1 turn. Also moves 1 tile in chosen direction. |

**Skill Tree:**

```
TIER 1 (Level 3) ─── Pick one:
│
├── [rogue-t1-smoke-bomb] Smoke Bomb
│     grant_ability: "rogue-smoke-bomb"
│     A: 2 energy, 5 CD, melee AoE radius 2
│     90% chance to blind all nearby enemies for 2 turns
│     Crowd control + escape tool
│
└── [rogue-t1-disarm-trap] Disarm Trap
      grant_ability: "rogue-disarm-trap"
      A: 1 energy, 0 CD, melee
      Target a chest. If trapped, removes the trap safely.
      special: "disarm_trap"
      THE class-defining utility — no other class can do this

TIER 2 (Level 6) ─── Pick one:
│
├── [rogue-t2-envenom] Envenom
│     grant_ability: "rogue-envenom"
│     A: 2 energy, 6 CD, melee
│     Damage + 90% chance to poison (5 damage/turn for 4 turns)
│     Sustained damage over time — strong against high-HP enemies
│
└── [rogue-t2-vanish] Vanish
      grant_ability: "rogue-vanish"
      A: 3 energy, 8 CD, self
      Become untargetable for 1 turn (+20 defense as fallback)
      Repositioning tool. Break combat, move freely, re-engage.
      special: "stealth"

TIER 3 (Level 10) ─── Pick one:
│
├── [rogue-t3-death-mark] Death Mark
│     prerequisite: rogue-t2-envenom
│     grant_ability: "rogue-death-mark"
│     A: 4 energy, 7 CD, melee
│     Brand target. Next attack against them deals 2.0x scaling + ignores armor.
│     70% chance to slow for 1 turn.
│     Assassination combo: Death Mark → Backstab for massive burst
│
└── [rogue-t3-shadow-step] Shadow Step
      prerequisite: rogue-t2-vanish
      grant_ability: "rogue-shadow-step"
      A: 3 energy, 5 CD, 4 tiles range
      Teleport to any tile within range. If enemy adjacent to landing, deal backstab damage.
      special: "teleport_attack"
      Mobility + damage in one action. The ultimate hit-and-run.
```

**Design notes:** The Rogue branches into a poison assassin (Disarm Trap or Smoke Bomb → Envenom → Death Mark) or a mobility ghost (Smoke Bomb or Disarm Trap → Vanish → Shadow Step). Note that Disarm Trap is Tier 1 — Rogues have to give up Smoke Bomb to get it. That's a real choice: crowd control vs utility. Both paths are strong but serve different playstyles.

**CRITICAL: Disarm Trap MUST be in this roster.** It is the only way to safely open trapped chests. Without a Rogue with this skill, all classes eat trap damage on trapped chests. This was a key design decision — see DUNGEON_PROGRESSION.md.

---

### Archer

**Identity:** Sustained ranged damage. Focus builds +1 per turn, spent on powerful special shots. Highest accuracy, good speed, moderate survivability. Excels in large rooms with positioning options. Struggles in tight corridors.

**Starting Abilities:**

| ID | Name | Type | Cost | CD | Range | Notes |
|---|---|---|---|---|---|---|
| `archer-aimed-shot` | Aimed Shot | Damage | 3 focus | 0 | 5 tiles | 1.2x attack scaling. Reliable ranged damage. |
| `archer-quick-shot` | Quick Shot | Damage | 1 focus | 1 | 4 tiles | Low cost, low damage (0.6x scaling). For turns when you can't afford Aimed Shot. |

**Skill Tree:**

```
TIER 1 (Level 3) ─── Pick one:
│
├── [archer-t1-piercing-shot] Piercing Shot
│     grant_ability: "archer-piercing-shot"
│     A: 5 focus, 3 CD, 5 tiles range
│     Ignores target defense entirely. 1.0x scaling.
│     special: "piercing_shot"
│     Anti-tank ability — shreds high-defense enemies
│
└── [archer-t1-pin-shot] Pin Shot
      grant_ability: "archer-pin-shot"
      A: 4 focus, 4 CD, 5 tiles range
      Moderate damage (0.8x scaling) + 80% chance to slow for 2 turns
      Kiting tool — keep enemies from closing in

TIER 2 (Level 6) ─── Pick one:
│
├── [archer-t2-volley] Volley
│     grant_ability: "archer-volley"
│     A: 8 focus, 5 CD, 4 tiles range
│     Hit all enemies in a 2-tile radius. 0.7x scaling.
│     special: "multishot"
│     The Archer's only AoE — expensive but room-clearing
│
└── [archer-t2-disengage] Disengage
      grant_ability: "archer-disengage"
      A: 2 focus, 3 CD, melee
      Attack adjacent enemy (0.8x scaling) then move 2 tiles away
      special: "disengage"
      Escape tool when enemies close the gap

TIER 3 (Level 10) ─── Pick one:
│
├── [archer-t3-snipe] Snipe
│     prerequisite: archer-t1-piercing-shot
│     grant_ability: "archer-snipe"
│     A: 12 focus, 6 CD, 7 tiles range
│     Extreme range, extreme damage (base 20, 2.0x scaling), ignores defense
│     special: "piercing_shot"
│     The ultimate single-target nuke. Requires saving focus.
│
└── [archer-t3-rain-of-arrows] Rain of Arrows
      prerequisite: archer-t2-volley
      grant_ability: "archer-rain-of-arrows"
      A: 15 focus, 8 CD, 5 tiles range
      Massive AoE (radius 3), 1.0x scaling, hits everything in the area
      special: "multishot"
      Room-wide devastation. Max focus dump.
```

**Design notes:** The Archer branches into a single-target sniper (Piercing Shot → Volley or Disengage → Snipe) or an AoE controller (Pin Shot → Volley → Rain of Arrows). The Focus mechanic means Archers build up to big turns — patient play is rewarded. Disengage is the survival option for Archers who keep getting cornered.

---

## 6. Complete Ability ID Reference

Use this to verify your JSON files have everything needed.

### Shared
- `basic-attack`

### Knight (2 starting + 6 tree = 8 total)
Starting:
- `knight-slash`
- `knight-shield-block`

Tree unlocks:
- `knight-shield-wall` (T1)
- `knight-cleave` (T1)
- `knight-iron-skin` — NOT an ability, passive_stat node
- `knight-riposte` (T2)
- `knight-fortress` (T3)
- `knight-berserker-rage` (T3)

### Mage (2 starting + 9 tree = 11 total)
Starting:
- `mage-arcane-bolt`
- `mage-mana-shield`

Tree unlocks:
- `mage-frost-nova` (T1)
- `mage-fireball` (T1)
- `mage-healing-light` (T1, cleric)
- `mage-arcane-sight` (T2)
- `mage-mana-drain` (T2)
- `mage-purify` (T2, cleric)
- `mage-portal` (T3)
- `mage-meteor` (T3)
- `mage-restoration` (T3, cleric)

### Rogue (2 starting + 6 tree = 8 total)
Starting:
- `rogue-backstab`
- `rogue-dodge-roll`

Tree unlocks:
- `rogue-smoke-bomb` (T1)
- `rogue-disarm-trap` (T1)
- `rogue-envenom` (T2)
- `rogue-vanish` (T2)
- `rogue-death-mark` (T3)
- `rogue-shadow-step` (T3)

### Archer (2 starting + 6 tree = 8 total)
Starting:
- `archer-aimed-shot`
- `archer-quick-shot`

Tree unlocks:
- `archer-piercing-shot` (T1)
- `archer-pin-shot` (T1)
- `archer-volley` (T2)
- `archer-disengage` (T2)
- `archer-snipe` (T3)
- `archer-rain-of-arrows` (T3)

---

## 7. What to Reconcile With Existing Files

If your ability JSON files already exist, check against the ID reference above:

1. **Are IDs prefixed with class name?** The spec uses `rogue-backstab` not `backstab`. Prefixing prevents ID collisions across classes and makes debugging easier. Reconcile now or you'll have ambiguous IDs later.

2. **Does Rogue have `rogue-disarm-trap`?** This is the critical missing one you identified. It must exist with `special: "disarm_trap"`.

3. **Do starting abilities match the class file's `starting_abilities` array?** Whatever IDs are in the ability JSON must exactly match what the class file references.

4. **Are there abilities in the JSON that aren't in this roster?** They're either custom additions (fine, just document them) or orphans that nothing references.

5. **Do the `special` values match what the engine implements?** Every unique `special` string requires a corresponding hardcoded case in the engine's ability resolver. If the ability JSON references a `special` value the engine doesn't handle, it will silently do nothing.

---

## 8. Balance Notes

All numeric values (damage, costs, cooldowns, durations) are starting points. They should be config-driven and tunable without code changes. Key balance levers:

- **Resource costs** control how often abilities can be used per energy cycle / mana pool
- **Cooldowns** prevent spam of powerful abilities
- **Scaling factors** determine how much stats amplify ability damage (1.0 = 100% of stat added)
- **Status effect durations and apply_chance** control crowd control power
- **Portal mana cost (20)** must be high enough that Mages can't trivially escape every run
- **Disarm Trap energy cost (1)** should be cheap — the cost is the skill tree slot, not the resource
- **Berserker self-damage (20% HP)** must be meaningful — Knight should feel the tradeoff

Run the reference agent through all dungeons with all 4 classes and all skill tree paths before considering these balanced. Expect multiple tuning passes.
