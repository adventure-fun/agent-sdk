# Adventure.fun — Content Spec

> **Related:** [GAME_DESIGN.md](./GAME_DESIGN.md) for game rules · [BACKEND.md](./BACKEND.md) for entity identity scheme

All game content is **data-driven**. Classes, items, enemies, realms, and narrative are defined as structured templates. The engine reads these templates — it never hardcodes content.

## 1. Content Types

```
ClassTemplate          → stats, growth, abilities, skill tree, resource model
AbilityTemplate        → damage, cost, cooldown, range, effects
SkillNodeTemplate      → tier, prerequisites, cost, effect
EnemyTemplate          → stats, abilities, behavior, loot table, XP value
ItemTemplate           → type, stats, effects, rarity, stack limit, sell price
RealmTemplate          → theme, floors, enemies, loot tables, rooms, boss, narrative
RoomTemplate           → type, text, interactables, enemy slots, loot slots, traps
InteractableTemplate   → name, text, conditions, effects, lore link
TriggerTemplate        → conditions, effects, fire-once flag
LoreTemplate           → title, text, category, strategic hint flag
ShopTemplate           → item roster, pricing, rotation schedule
```

---

## 2. Template Definitions

### ClassTemplate

```typescript
interface ClassTemplate {
  id: string                    // "knight", "mage", "rogue", "archer"
  name: string
  base_stats: {
    hp: number
    attack: number
    defense: number
    accuracy: number
    evasion: number
    speed: number
  }
  stat_growth: {                // per-level increases
    hp: number
    attack: number
    defense: number
    accuracy: number
    evasion: number
    speed: number
  }
  stat_roll_ranges: {           // bounded randomization at creation
    hp: [number, number]        // [min, max] — total budget ±5%
    attack: [number, number]
    defense: [number, number]
    accuracy: [number, number]
    evasion: [number, number]
    speed: [number, number]
  }
  resource_type: "stamina" | "mana" | "energy" | "focus"
  resource_max: number
  resource_regen_rule: {
    type: "passive" | "burst_reset" | "accumulate" | "none"
    amount?: number             // per-turn regen amount
    interval?: number           // for burst_reset: every N turns
    on_defend_bonus?: number    // bonus regen when defending
  }
  starting_abilities: string[]  // AbilityTemplate IDs
  skill_tree: SkillTreeDefinition
  starting_equipment: string[]  // ItemTemplate IDs
  visibility_radius: number
}
```

### AbilityTemplate

```typescript
interface AbilityTemplate {
  id: string
  name: string
  description: string
  resource_cost: number
  cooldown_turns: number
  range: "melee" | number       // "melee" = adjacent, number = tiles
  damage_formula: {
    base: number
    stat_scaling: string        // "attack", "speed", etc.
    scaling_factor: number
  }
  effects: StatusEffect[]
  target: "single" | "aoe" | "self"
  aoe_radius?: number
}

interface StatusEffect {
  type: "poison" | "stun" | "slow" | "blind" | "buff_attack" | "buff_defense"
  duration_turns: number
  magnitude: number             // damage per turn, stat modifier, etc.
  apply_chance: number          // 0-1
}
```

### SkillTreeDefinition

```typescript
interface SkillTreeDefinition {
  tiers: SkillTier[]
}

interface SkillTier {
  tier: number                  // 1, 2, 3
  unlock_level: number          // e.g., 3, 6, 10
  choices: SkillNodeTemplate[]
}

interface SkillNodeTemplate {
  id: string
  name: string
  description: string
  cost: number                  // skill points required
  prerequisites: string[]      // IDs of required prior nodes
  effect: {
    type: "grant_ability" | "passive_stat" | "passive_effect"
    ability_id?: string
    stat?: string
    value?: number
    description?: string
  }
}
```

### EnemyTemplate

```typescript
interface EnemyTemplate {
  id: string
  name: string
  stats: {
    hp: number
    attack: number
    defense: number
    accuracy: number
    evasion: number
    speed: number
  }
  abilities: string[]           // AbilityTemplate IDs
  behavior: "aggressive" | "defensive" | "patrol" | "ambush" | "boss"
  boss_phases?: BossPhase[]     // only for behavior: "boss"
  loot_table: string            // LootTableId
  xp_value: number
  difficulty_tier: number       // 1-5, used for XP scaling
}

interface BossPhase {
  hp_threshold: number          // percentage: phase triggers below this HP
  behavior_change: string       // e.g., "enrage", "summon", "heal"
  abilities_added: string[]
  abilities_removed: string[]
}
```

### ItemTemplate

```typescript
interface ItemTemplate {
  id: string
  name: string
  type: "consumable" | "equipment" | "loot" | "key_item"
  rarity: "common" | "uncommon" | "rare" | "epic"
  equip_slot?: "weapon" | "armor" | "accessory" | "class_specific"
  stats?: Partial<Stats>        // stat bonuses when equipped
  effects?: ItemEffect[]
  stack_limit: number           // 1 for equipment, 5 for consumables
  sell_price: number            // gold value at NPC shop
  buy_price: number             // shop purchase price (0 = not sold in shops)
  class_restriction?: string    // null = any class can use
  description: string
}

interface ItemEffect {
  type: "heal_hp" | "heal_resource" | "cure_debuff" | "portal" | "buff" | "reveal_map"
  magnitude?: number
  duration?: number
}
```

### RealmTemplate

```typescript
interface RealmTemplate {
  id: string
  name: string
  description: string           // shown in UI and realm selection
  theme: string                 // "undead_crypt", "collapsed_mines", etc.
  version: number               // for pinning existing instances
  floor_count: { min: number; max: number }
  difficulty_tier: number
  room_distribution: {
    combat: number              // weight (e.g., 0.4)
    treasure: number
    trap: number
    rest: number
    event: number
    boss: number                // always 1 per final floor, not weighted
  }
  enemy_roster: string[]        // EnemyTemplate IDs available in this realm
  boss_id: string               // EnemyTemplate ID for the boss
  loot_tables: LootTable[]
  trap_types: TrapTemplate[]
  room_templates: string[]      // RoomTemplate IDs available
  narrative: {
    theme_description: string
    room_text_pool: RoomText[]
    lore_pool: string[]         // LoreTemplate IDs
    interactable_pool: string[] // InteractableTemplate IDs
  }
  completion_rewards: {
    xp: number
    gold: number
  }
}

interface LootTable {
  id: string
  entries: LootEntry[]
}

interface LootEntry {
  item_template_id: string
  weight: number                // relative probability
  quantity: { min: number; max: number }
}

interface TrapTemplate {
  id: string
  name: string
  damage: number
  effect?: StatusEffect
  detection_difficulty: number  // check against rogue detection
  visible_after_trigger: boolean
}
```

### RoomTemplate

```typescript
interface RoomTemplate {
  id: string
  type: "combat" | "treasure" | "trap" | "rest" | "event" | "boss"
  size: { width: number; height: number }  // tile grid dimensions
  text_first_visit: string
  text_revisit: string | null
  interactables: InteractableTemplate[]
  enemy_slots: EnemySlot[]
  loot_slots: LootSlot[]
  trap_slots: TrapSlot[]
  triggers: TriggerTemplate[]
}

interface EnemySlot {
  enemy_template_id: string | "random_from_roster"
  position?: { x: number; y: number } | "random"
  count: { min: number; max: number }
}

interface LootSlot {
  loot_table_id: string
  container: "chest" | "floor_drop" | "hidden"
  position?: { x: number; y: number } | "random"
}

interface TrapSlot {
  trap_template_id: string
  position?: { x: number; y: number } | "random"
}
```

### InteractableTemplate

```typescript
interface InteractableTemplate {
  id: string
  name: string                  // "Ancient Journal", "Stone Altar", "Crumbling Wall Carving"
  text_on_interact: string
  conditions: Condition[]
  effects: Effect[]
  lore_entry_id: string | null
}
```

### TriggerTemplate

```typescript
interface TriggerTemplate {
  conditions: Condition[]
  effects: Effect[]
  fire_once: boolean
}

type Condition =
  | { type: "first_visit" }
  | { type: "has_item"; item_id: string }
  | { type: "class_is"; class: string }
  | { type: "enemy_defeated"; entity_id: string }
  | { type: "room_visited"; room_id: string }
  | { type: "floor_depth_gte"; depth: number }
  | { type: "hp_below"; percent: number }

type Effect =
  | { type: "reveal_lore"; lore_id: string }
  | { type: "grant_quest_flag"; flag: string }
  | { type: "unlock_door"; entity_id: string }
  | { type: "spawn_enemy"; enemy_template_id: string; position: { x: number; y: number } }
  | { type: "apply_buff"; buff: StatusEffect }
  | { type: "apply_debuff"; debuff: StatusEffect }
  | { type: "grant_item"; item_template_id: string }
  | { type: "show_text"; text: string }
```

### LoreTemplate

```typescript
interface LoreTemplate {
  id: string
  title: string
  text: string
  category: "history" | "bestiary" | "environment" | "hint" | "lore"
  strategic_hint: boolean       // true if this lore carries gameplay-relevant info
}
```

### ShopTemplate

```typescript
interface ShopTemplate {
  id: string
  name: string
  base_inventory: ShopItem[]    // always available
  rotating_pool: ShopItem[]     // random selection refreshes on schedule
  rotating_slot_count: number   // how many from pool are active
  rotation_interval_hours: number
}

interface ShopItem {
  item_template_id: string
  buy_price: number             // gold
  stock_limit?: number          // null = unlimited
}
```

---

## 3. Versioning

- All templates carry a `version` field
- Active realm instances are **pinned** to the template version they were generated with
- Template updates do not retroactively affect existing realm instances
- New realm generations always use the latest template version
- Entity IDs are only meaningful within their generation context (seed + version)

---

## 4. Content File Organization

```
packages/engine/content/
├── classes/
│   ├── knight.json
│   ├── mage.json
│   ├── rogue.json
│   └── archer.json
├── abilities/
│   ├── knight-abilities.json
│   ├── mage-abilities.json
│   └── ...
├── enemies/
│   ├── undead.json
│   ├── constructs.json
│   └── bosses.json
├── items/
│   ├── consumables.json
│   ├── equipment-common.json
│   ├── equipment-uncommon.json
│   ├── equipment-rare.json
│   ├── equipment-epic.json
│   ├── loot.json
│   └── key-items.json
├── realms/
│   ├── sunken-crypt.json
│   └── collapsed-mines.json
├── rooms/
│   ├── combat-rooms.json
│   ├── treasure-rooms.json
│   └── event-rooms.json
├── lore/
│   ├── sunken-crypt-lore.json
│   └── collapsed-mines-lore.json
├── shops/
│   └── default-shop.json
└── balance/
    ├── xp-tables.json
    ├── damage-formulas.json
    └── economy.json           # all gold prices, drop rates, scaling factors
```

All files in `balance/` are the live-tunable config values. Changing these should not require engine code changes.

---

## 5. v1 Content Targets

| Content Type | v1 Minimum |
|---|---|
| Classes | 4 (Knight, Mage, Rogue, Archer) |
| Abilities per class | 4-6 (including skill tree unlocks) |
| Skill tree tiers | 3 per class (2-3 choices per tier) |
| Enemy types | 8-12 (across 2 realm themes) |
| Boss enemies | 2 (one per realm template) |
| Item templates | 30-50 (consumables, equipment across rarities, loot, keys) |
| Realm templates | 2-3 curated solo themes |
| Room templates | 15-20 (mixed across types) |
| Lore entries | 20-30 (mix of flavor and strategic hints) |
| Interactable types | 8-10 |
| Shop templates | 1 (with rotating stock) |
