# Adventure.fun — Room Template Guide

> **Related:** [CONTENT.md](./specs/CONTENT.md) for interface definitions · [DUNGEON_PROGRESSION.md](./specs/DUNGEON_PROGRESSION.md) for dungeon design · [GAME_DESIGN.md](./specs/GAME_DESIGN.md) for mechanics

## 1. What Room Templates Are

A room template is a JSON file that defines a single room in a dungeon — its physical size, flavor text, enemies, loot, interactables, and triggered events. Realm templates reference room templates by ID. The engine loads them at generation time to populate the dungeon.

**File location:** `packages/engine/content/rooms/{realm-theme}/`

```
packages/engine/content/rooms/
├── tutorial/
│   ├── tutorial-storeroom.json
│   └── tutorial-burrow.json
├── collapsed-passage/
│   ├── cp-shaft-junction.json
│   ├── cp-flooded-chamber.json
│   ├── cp-tool-storage.json
│   ├── cp-locked-gate.json
│   └── cp-overseers-den.json
├── blighted-hollow/
│   ├── bh-entrance-clearing.json
│   ├── bh-fungal-corridor.json
│   ├── bh-spore-den.json
│   ├── bh-root-chamber.json
│   ├── bh-wolf-den.json
│   ├── bh-hollow-spring.json
│   └── bh-corrupted-heart.json
├── collapsed-mines/
│   └── ...
└── sunken-crypt/
    └── ...
```

---

## 2. Room Template Schema

```typescript
interface RoomTemplate {
  id: string
  type: "combat" | "treasure" | "rest" | "event" | "boss"
  size: { width: number; height: number }
  text_first_visit: string
  text_revisit: string | null
  interactables: InteractableTemplate[]
  enemy_slots: EnemySlot[]
  loot_slots: LootSlot[]
  triggers: TriggerTemplate[]
}
```

### Field Guide

| Field | Purpose | Notes |
|---|---|---|
| `id` | Unique room identifier | Used in realm template's `room_templates` array and in entity IDs |
| `type` | Room category | Affects room distribution weighting in procedural generation |
| `size` | Tile grid dimensions | `width` × `height`. Tutorial rooms: 5x5 to 7x7. Later rooms: up to 10x10. |
| `text_first_visit` | Flavor text shown on first entry | Keep to 1-3 sentences. Set the scene. |
| `text_revisit` | Text shown on subsequent visits | Shorter than first visit. `null` for no revisit text. |
| `interactables` | Inspectable/interactable objects | Lore, hints, chest contents, environmental storytelling |
| `enemy_slots` | Enemy spawn definitions | `"random_from_roster"` uses the realm's enemy roster. Fixed IDs for specific enemies. |
| `loot_slots` | Loot container definitions | `"chest"`, `"floor_drop"`, or `"hidden"`. References loot table IDs from the realm template. |
| `triggers` | Conditional events | Fire on conditions like first visit, enemy death, item possession. Can spawn enemies, grant items, show text, etc. |

### Size Guidelines

| Room Type | Recommended Size | Rationale |
|---|---|---|
| Small / corridor | 5x5 | Tight spaces, limited movement, melee-focused |
| Standard | 7x7 | Default combat room, room for positioning |
| Large / boss | 9x9 or 10x10 | Space for boss mechanics, adds, and maneuvering |
| Narrow corridor | 3x7 or 3x9 | Forces linear movement, ambush-friendly |

---

## 3. Handcrafted vs Procedural Rooms

### Handcrafted (Tutorial)

For `procedural: false` realms, the engine loads rooms in the order they appear in `room_templates` and connects them linearly. Every player gets the exact same room sequence with the same contents.

- Enemy slots use fixed `enemy_template_id` (not `"random_from_roster"`)
- Loot slots use fixed item grants via triggers (not randomized loot tables)
- Room positions and connections are deterministic

### Semi-Procedural (Tier 1)

The room graph is fixed (handcrafted connections), but within each room:
- `"random_from_roster"` enemies are selected from the realm's `enemy_roster` using the seed
- Loot rolls use `loot_table_id` with weighted random selection
- Enemy `count: { min, max }` ranges allow variation
- Enemy and loot `position: "random"` places entities at valid tiles using the seed

### Fully Procedural (Tier 2+)

The room graph itself is generated from the seed based on `room_distribution` weights. The engine:
1. Picks room templates from the realm's `room_templates` array
2. Generates a connected graph satisfying constraints (boss on final floor, keys before locked doors)
3. Populates each room using its enemy slots and loot slots with seed-based randomization

---

## 4. Tutorial: The Cellar

Two handcrafted rooms. Teaches: movement, interact, equip, combat, loot, extraction.

### tutorial-storeroom.json

```json
{
  "id": "tutorial-storeroom",
  "type": "treasure",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "Dusty barrels and broken crates line the walls. The air smells of damp earth and something sour. A wooden chest sits in the corner, still latched.",
  "text_revisit": "The storeroom is quiet. Dust motes drift in the faint light from above.",
  "interactables": [
    {
      "id": "tutorial-chest-weapon",
      "name": "Wooden Chest",
      "text_on_interact": "The latch gives way with a rusty click. Inside, wrapped in oilcloth, a weapon — battered but serviceable.",
      "conditions": [],
      "effects": [],
      "lore_entry_id": null
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": [
    {
      "conditions": [{ "type": "class_is", "class": "knight" }],
      "effects": [{ "type": "grant_item", "item_template_id": "weapon-iron-sword" }],
      "fire_once": true,
      "trigger_on": "interact",
      "target_id": "tutorial-chest-weapon"
    },
    {
      "conditions": [{ "type": "class_is", "class": "rogue" }],
      "effects": [{ "type": "grant_item", "item_template_id": "weapon-rusty-dagger" }],
      "fire_once": true,
      "trigger_on": "interact",
      "target_id": "tutorial-chest-weapon"
    },
    {
      "conditions": [{ "type": "class_is", "class": "mage" }],
      "effects": [{ "type": "grant_item", "item_template_id": "weapon-oak-staff" }],
      "fire_once": true,
      "trigger_on": "interact",
      "target_id": "tutorial-chest-weapon"
    },
    {
      "conditions": [{ "type": "class_is", "class": "archer" }],
      "effects": [
        { "type": "grant_item", "item_template_id": "weapon-short-bow" },
        { "type": "grant_item", "item_template_id": "ammo-arrows-10" }
      ],
      "fire_once": true,
      "trigger_on": "interact",
      "target_id": "tutorial-chest-weapon"
    }
  ]
}
```

### tutorial-burrow.json

```json
{
  "id": "tutorial-burrow",
  "type": "combat",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "The cellar opens into a dug-out burrow. Claw marks score the walls. A hunched figure snarls at you from behind a battered chest — a Hollow Rat, larger than any rat should be, its eyes glowing faintly violet.",
  "text_revisit": "The burrow is still. The scratches on the walls catch the light.",
  "interactables": [
    {
      "id": "tutorial-chest-supplies",
      "name": "Battered Chest",
      "text_on_interact": "The chest is dented but intact. Inside: two glass vials of red liquid and a small pouch of coins.",
      "conditions": [{ "type": "enemy_defeated", "entity_id": "f1_r2_enemy_01" }],
      "effects": [
        { "type": "grant_item", "item_template_id": "health-potion", "quantity": 2 },
        { "type": "grant_gold", "amount": 15 }
      ],
      "lore_entry_id": null
    },
    {
      "id": "tutorial-wall-scratches",
      "name": "Scratched Tally Marks",
      "text_on_interact": "Someone counted days here. The last marks are frantic, overlapping. Below them, scratched in a shaking hand: 'it came from below.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cellar-warning-01" }],
      "lore_entry_id": "cellar-warning-01"
    }
  ],
  "enemy_slots": [
    {
      "enemy_template_id": "hollow-rat",
      "position": { "x": 4, "y": 2 },
      "count": { "min": 1, "max": 1 }
    }
  ],
  "loot_slots": [],
  "triggers": []
}
```

---

## 5. Tier 1: The Collapsed Passage

Six semi-procedural rooms. Fixed graph, variable enemy/loot placement. Introduces: locked doors, keys, branching paths.

### Room Graph

```
[cp-entrance] → [cp-shaft-junction]
                     │           │
                     ▼           ▼
            [cp-tool-storage]  [cp-flooded-chamber]
                     │
                     ▼
              [cp-locked-gate] ← (requires mine-key from flooded-chamber)
                     │
                     ▼
            [cp-overseers-den]
```

### cp-entrance.json

```json
{
  "id": "cp-entrance",
  "type": "event",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "A rough-cut tunnel descends at a steep angle. Broken timber supports lean against the walls. The air is thick with dust and something metallic.",
  "text_revisit": "The entrance tunnel. Daylight filters down from above.",
  "interactables": [
    {
      "id": "cp-warning-sign",
      "name": "Weathered Sign",
      "text_on_interact": "Nailed to a beam in faded paint: 'SHAFT 7 — CONDEMNED BY ORDER OF THE OVERSEER.' Someone has scratched underneath: 'condemned by what's inside.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cp-condemned-notice" }],
      "lore_entry_id": "cp-condemned-notice"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

### cp-shaft-junction.json

```json
{
  "id": "cp-shaft-junction",
  "type": "combat",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "Three tunnels branch from a central junction. Rotting rail tracks lead in each direction. Something skitters in the darkness to the left.",
  "text_revisit": "The junction. Tracks still lead three ways.",
  "interactables": [],
  "enemy_slots": [
    {
      "enemy_template_id": "hollow-rat",
      "position": "random",
      "count": { "min": 1, "max": 2 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "cp-minor-loot",
      "container": "floor_drop",
      "position": "random"
    }
  ],
  "triggers": []
}
```

### cp-flooded-chamber.json

```json
{
  "id": "cp-flooded-chamber",
  "type": "treasure",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "Water seeps from cracks in the ceiling, pooling across the floor. Mining tools lie scattered as if dropped mid-swing. A corroded lockbox sits on a stone ledge above the waterline.",
  "text_revisit": "The water is ankle-deep and still rising, slowly.",
  "interactables": [
    {
      "id": "cp-lockbox",
      "name": "Corroded Lockbox",
      "text_on_interact": "The lock crumbles at your touch. Inside: a heavy iron key stamped with the mine's seal.",
      "conditions": [],
      "effects": [{ "type": "grant_item", "item_template_id": "mine-key" }],
      "lore_entry_id": null
    },
    {
      "id": "cp-scattered-tools",
      "name": "Scattered Mining Tools",
      "text_on_interact": "Pickaxes, shovels, lanterns — all abandoned mid-use. Whatever happened here happened fast.",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cp-sudden-abandonment" }],
      "lore_entry_id": "cp-sudden-abandonment"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [
    {
      "loot_table_id": "cp-minor-loot",
      "container": "chest",
      "position": { "x": 5, "y": 1 }
    }
  ],
  "triggers": []
}
```

### cp-tool-storage.json

```json
{
  "id": "cp-tool-storage",
  "type": "combat",
  "size": { "width": 5, "height": 7 },
  "text_first_visit": "A narrow storage alcove packed with crates and barrels. Something has nested in the back — shredded canvas and gnawed wood form a crude den.",
  "text_revisit": "The storage room. The nest in the back is empty now.",
  "interactables": [],
  "enemy_slots": [
    {
      "enemy_template_id": "cave-crawler",
      "position": { "x": 3, "y": 1 },
      "count": { "min": 1, "max": 1 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "cp-equipment-loot",
      "container": "chest",
      "position": { "x": 1, "y": 1 }
    }
  ],
  "triggers": []
}
```

### cp-locked-gate.json

```json
{
  "id": "cp-locked-gate",
  "type": "event",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "A heavy iron gate blocks the passage ahead. The lock is stamped with the mine's seal. Beyond the bars, you can see a furnished room — the overseer's quarters.",
  "text_revisit": null,
  "interactables": [
    {
      "id": "cp-iron-gate",
      "name": "Locked Iron Gate",
      "text_on_interact": "The mine key turns with a grinding screech. The gate swings open.",
      "conditions": [{ "type": "has_item", "item_id": "mine-key" }],
      "effects": [
        { "type": "unlock_door", "entity_id": "cp-iron-gate" },
        { "type": "show_text", "text": "You insert the mine key. The gate groans open, rust flaking from the hinges." }
      ],
      "lore_entry_id": null
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": [
    {
      "conditions": [],
      "effects": [{ "type": "show_text", "text": "The gate is locked. You need a key with the mine's seal." }],
      "fire_once": false,
      "trigger_on": "interact_failed",
      "target_id": "cp-iron-gate"
    }
  ]
}
```

### cp-overseers-den.json

```json
{
  "id": "cp-overseers-den",
  "type": "treasure",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "The overseer's quarters. A desk covered in papers, a cot against the wall, and a heavy strongbox beneath the desk. A cave crawler has made this room its lair — bones are scattered across the floor.",
  "text_revisit": "The overseer's quarters. The desk is still covered in unfinished paperwork.",
  "interactables": [
    {
      "id": "cp-overseer-journal",
      "name": "Overseer's Journal",
      "text_on_interact": "The last entry reads: 'The crawlers avoid the light from the blue crystals. We've started lining the main shaft with them, but supply is running low. If the deeper shafts are lost, we abandon the mine.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cp-crystal-weakness" }],
      "lore_entry_id": "cp-crystal-weakness"
    }
  ],
  "enemy_slots": [
    {
      "enemy_template_id": "cave-crawler",
      "position": { "x": 5, "y": 5 },
      "count": { "min": 1, "max": 1 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "cp-strongbox-loot",
      "container": "chest",
      "position": { "x": 3, "y": 6 }
    }
  ],
  "triggers": []
}
```

---

## 6. Tier 1: The Blighted Hollow

Seven semi-procedural rooms. Introduces: status effects (poison, slow), trapped chests, pack enemies.

### Room Graph

```
[bh-entrance-clearing] → [bh-fungal-corridor] → [bh-spore-den]
                                                       │
                               [bh-wolf-den] ← [bh-root-chamber]
                                     │
                              [bh-hollow-spring]
                                     │
                            [bh-corrupted-heart]
```

### bh-entrance-clearing.json

```json
{
  "id": "bh-entrance-clearing",
  "type": "event",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "The cave mouth is ringed with dying trees. Their bark is streaked with violet veins, and the leaves have curled into brittle black husks. The air tastes wrong — sweet and chemical, like rotting flowers.",
  "text_revisit": "The blighted trees stand motionless. The violet veins seem brighter than before.",
  "interactables": [
    {
      "id": "bh-dead-tree",
      "name": "Violet-Veined Tree",
      "text_on_interact": "The bark crumbles at your touch. Beneath it, the wood pulses faintly with violet light. This is not disease — it is something deliberate.",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "bh-corruption-nature" }],
      "lore_entry_id": "bh-corruption-nature"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

### bh-fungal-corridor.json

```json
{
  "id": "bh-fungal-corridor",
  "type": "combat",
  "size": { "width": 3, "height": 9 },
  "text_first_visit": "A narrow passage thick with luminous fungi. The walls are soft and damp. Ahead, clusters of bulbous growths pulse with a slow rhythm — spore sacs, ready to burst.",
  "text_revisit": "The corridor. The fungi have already begun regrowing.",
  "interactables": [],
  "enemy_slots": [
    {
      "enemy_template_id": "hollow-spore",
      "position": { "x": 1, "y": 3 },
      "count": { "min": 1, "max": 1 }
    }
  ],
  "loot_slots": [],
  "triggers": []
}
```

### bh-spore-den.json

```json
{
  "id": "bh-spore-den",
  "type": "combat",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "A wide cavern carpeted in fungal growth. Two large spore clusters sit at the far end, pulsing in unison. The air is thick enough to taste.",
  "text_revisit": "The spore den. New growth already covers the floor.",
  "interactables": [
    {
      "id": "bh-ranger-pack",
      "name": "Decayed Ranger's Pack",
      "text_on_interact": "A leather satchel, half consumed by fungus. Inside, a tightly sealed vial and a scrap of treated parchment. The parchment reads: 'Antidote — one dose. The spores dissolve in the blood within minutes without treatment.'",
      "conditions": [],
      "effects": [
        { "type": "grant_item", "item_template_id": "antidote" },
        { "type": "reveal_lore", "lore_id": "bh-spore-antidote" }
      ],
      "lore_entry_id": "bh-spore-antidote"
    }
  ],
  "enemy_slots": [
    {
      "enemy_template_id": "hollow-spore",
      "position": "random",
      "count": { "min": 2, "max": 2 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "bh-minor-loot",
      "container": "floor_drop",
      "position": "random"
    }
  ],
  "triggers": []
}
```

### bh-root-chamber.json

```json
{
  "id": "bh-root-chamber",
  "type": "event",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "Massive roots descend from above, forming a tangled lattice across the chamber. Between the roots, fragments of carved stone are visible — this was a structure once, before the forest consumed it.",
  "text_revisit": "The roots creak faintly. The carved stone beneath them is ancient.",
  "interactables": [
    {
      "id": "bh-carved-stone",
      "name": "Carved Stone Fragment",
      "text_on_interact": "The carving depicts a figure in a ranger's cloak, hands pressed against a dark mass. Light radiates from the figure's chest into the darkness. Below, in a script you can barely read: 'The First Seal — the Ranger's Sacrifice.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "bh-first-seal" }],
      "lore_entry_id": "bh-first-seal"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [
    {
      "loot_table_id": "bh-equipment-loot",
      "container": "chest",
      "position": { "x": 3, "y": 1 }
    }
  ],
  "triggers": []
}
```

### bh-wolf-den.json

```json
{
  "id": "bh-wolf-den",
  "type": "combat",
  "size": { "width": 9, "height": 7 },
  "text_first_visit": "Gnawed bones litter the floor of this wide cave. Two wolves pace at the far end — too large, too still, their fur matted with violet sap. They watch you with an intelligence that wolves should not have.",
  "text_revisit": "The den. It still smells of wet fur and decay.",
  "interactables": [],
  "enemy_slots": [
    {
      "enemy_template_id": "blighted-wolf",
      "position": "random",
      "count": { "min": 2, "max": 2 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "bh-minor-loot",
      "container": "floor_drop",
      "position": "random"
    }
  ],
  "triggers": []
}
```

### bh-hollow-spring.json

```json
{
  "id": "bh-hollow-spring",
  "type": "rest",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "A natural spring bubbles from the rock. Strangely, the water here is clear — untouched by the blight. The air feels lighter. Cleaner.",
  "text_revisit": "The spring still flows. A moment of calm in corrupted ground.",
  "interactables": [
    {
      "id": "bh-clear-spring",
      "name": "Clear Spring",
      "text_on_interact": "You drink. The water is cold and clean. Your wounds ache less.",
      "conditions": [],
      "effects": [
        { "type": "heal_hp", "amount": 15 },
        { "type": "show_text", "text": "The spring water restores some of your strength." }
      ],
      "lore_entry_id": null
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

### bh-corrupted-heart.json

```json
{
  "id": "bh-corrupted-heart",
  "type": "treasure",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "The cave ends in a pulsing mass of violet roots wrapped around a cracked stone pedestal. The seal. You can see it clearly now — a disc of pale stone split down the center, violet light bleeding through the crack. A chest sits at the base, overgrown but intact.",
  "text_revisit": "The seal still pulses. The crack has not grown, but it has not healed either.",
  "interactables": [
    {
      "id": "bh-broken-seal",
      "name": "The Cracked Seal",
      "text_on_interact": "The stone is warm to the touch. The crack runs deep — deeper than the disc itself, as if reality is fractured here. You feel a low vibration in your bones. Whatever the Ranger sealed away is pushing back.",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "bh-seal-cracking" }],
      "lore_entry_id": "bh-seal-cracking"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [
    {
      "loot_table_id": "bh-heart-loot",
      "container": "chest",
      "position": { "x": 3, "y": 2 },
      "trapped": true,
      "trap_damage": 12,
      "trap_effect": { "type": "poison", "duration_turns": 3, "magnitude": 3, "apply_chance": 1.0 }
    }
  ],
  "triggers": []
}
```

**Note:** The `trapped`, `trap_damage`, and `trap_effect` fields on `LootSlot` are an extension beyond the current CONTENT.md schema. This is the simplest way to implement chest traps — flag the loot slot itself rather than building a separate trigger chain. Alternatively, chest traps can be implemented via `TriggerTemplate` with a `trigger_on: "interact"` pointing at the chest entity.

---

## 7. Tier 2: The Sunken Crypt

Multi-floor dungeon. 3 floors, 12-15 rooms total. Introduces: boss encounter with interactive mechanic, multi-floor navigation, rest shrines.

### Floor 1: The Antechamber

```
[sc-entry-hall] → [sc-gallery] → [sc-offering-room]
                       │
                  [sc-side-vault] (contains Crypt Key)
```

### sc-entry-hall.json

```json
{
  "id": "sc-entry-hall",
  "type": "event",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "Stone steps descend into a vaulted hall. The walls are lined with alcoves, each holding a stone sarcophagus sealed with iron bands. Torches flicker in rusted sconces — someone lit them recently, or something did.",
  "text_revisit": "The entry hall. The torches still burn. They have not dimmed.",
  "interactables": [
    {
      "id": "sc-wall-mural",
      "name": "Faded Mural",
      "text_on_interact": "A painted scene, cracked with age: four figures standing at cardinal points around a dark void. Each presses something into the void — a sword, a tome, a mask, and a bow. The void is shrinking. Below: 'The Four held the Hollow. The Hollow held patience.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "sc-four-guardians" }],
      "lore_entry_id": "sc-four-guardians"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

### sc-gallery.json

```json
{
  "id": "sc-gallery",
  "type": "combat",
  "size": { "width": 9, "height": 7 },
  "text_first_visit": "A long gallery lined with stone pillars. Between them, armored figures stand motionless — no, not statues. Skeletons in corroded plate, gripping rusted swords. As you step forward, two of them turn their heads.",
  "text_revisit": "The gallery. The remaining statues stare ahead, waiting.",
  "interactables": [],
  "enemy_slots": [
    {
      "enemy_template_id": "skeleton-warrior",
      "position": "random",
      "count": { "min": 2, "max": 3 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "sc-skeleton-loot",
      "container": "floor_drop",
      "position": "random"
    }
  ],
  "triggers": []
}
```

### sc-side-vault.json

```json
{
  "id": "sc-side-vault",
  "type": "treasure",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "A small vault off the main gallery. A single sarcophagus lies open — empty except for a heavy iron key resting on folded burial cloth.",
  "text_revisit": "The empty vault. Nothing remains.",
  "interactables": [
    {
      "id": "sc-sarcophagus",
      "name": "Open Sarcophagus",
      "text_on_interact": "The burial cloth is embroidered with a name you cannot read. The key is cold and heavy — it bears the crypt's seal.",
      "conditions": [],
      "effects": [{ "type": "grant_item", "item_template_id": "crypt-key" }],
      "lore_entry_id": null
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

### sc-offering-room.json

```json
{
  "id": "sc-offering-room",
  "type": "event",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "An octagonal room with a sunken floor. At the center, a stone altar bears dried flowers and shattered pottery — offerings from long ago. A locked iron door leads deeper. Stairs descend into darkness.",
  "text_revisit": "The offering room. The altar is undisturbed.",
  "interactables": [
    {
      "id": "sc-locked-door-f2",
      "name": "Locked Iron Door",
      "text_on_interact": "The crypt key fits. The door groans open, revealing stairs descending into flooded darkness.",
      "conditions": [{ "type": "has_item", "item_id": "crypt-key" }],
      "effects": [{ "type": "unlock_door", "entity_id": "sc-locked-door-f2" }],
      "lore_entry_id": null
    },
    {
      "id": "sc-altar",
      "name": "Stone Altar",
      "text_on_interact": "The offerings are centuries old. Whoever left them was honoring the dead — or asking for forgiveness.",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "sc-altar-offerings" }],
      "lore_entry_id": "sc-altar-offerings"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

### Floor 2: The Flooded Tombs

```
[sc-flooded-passage] → [sc-submerged-hall] → [sc-tomb-of-whispers]
                              │
                        [sc-drowned-vault]
```

### sc-flooded-passage.json

```json
{
  "id": "sc-flooded-passage",
  "type": "combat",
  "size": { "width": 3, "height": 9 },
  "text_first_visit": "Water rises to your knees as the stairs level out into a narrow passage. The walls weep moisture. Something moves beneath the surface — a shape, man-sized, dragging itself along the floor.",
  "text_revisit": "The flooded passage. The water is darker than before.",
  "interactables": [],
  "enemy_slots": [
    {
      "enemy_template_id": "drowned-husk",
      "position": { "x": 1, "y": 7 },
      "count": { "min": 1, "max": 1 }
    }
  ],
  "loot_slots": [],
  "triggers": []
}
```

### sc-submerged-hall.json

```json
{
  "id": "sc-submerged-hall",
  "type": "combat",
  "size": { "width": 9, "height": 9 },
  "text_first_visit": "A grand burial hall, half-submerged. Stone coffins rise from the water like islands. The ceiling is high enough that your torchlight doesn't reach it. Movement in the water — more than one.",
  "text_revisit": "The submerged hall. The water is still, but you know better.",
  "interactables": [
    {
      "id": "sc-wall-carving",
      "name": "Wall Carving",
      "text_on_interact": "A carved relief shows a knight in full plate, standing before a great door. The knight is pressing a sword into the door — no, into a creature behind the door. The inscription: 'The Warden chose to remain. The seal required a soul, and he gave his.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "sc-warden-sacrifice" }],
      "lore_entry_id": "sc-warden-sacrifice"
    }
  ],
  "enemy_slots": [
    {
      "enemy_template_id": "drowned-husk",
      "position": "random",
      "count": { "min": 2, "max": 3 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "sc-tomb-loot",
      "container": "chest",
      "position": { "x": 7, "y": 1 }
    }
  ],
  "triggers": []
}
```

### sc-tomb-of-whispers.json

```json
{
  "id": "sc-tomb-of-whispers",
  "type": "event",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "The water recedes here. The walls are covered in writing — thousands of lines, scratched in different hands over centuries. Prayers, warnings, confessions. And repeated, over and over: 'The Warden's armor weakens when the braziers are lit.'",
  "text_revisit": "The room of whispers. The walls still speak if you read them.",
  "interactables": [
    {
      "id": "sc-whisper-wall",
      "name": "Inscribed Walls",
      "text_on_interact": "You read fragments: 'He was a good man before the seal took him.' 'The violet is in his eyes now.' 'Light the braziers. It is the only mercy we can offer.' 'Forgive us, Warden. We could not free you.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "sc-brazier-hint" }],
      "lore_entry_id": "sc-brazier-hint"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

### sc-drowned-vault.json

```json
{
  "id": "sc-drowned-vault",
  "type": "treasure",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "A sealed chamber, recently cracked open by water pressure. Inside, remarkably dry: a weapons rack and an armor stand, preserved by the seal. This was the Warden's personal armory.",
  "text_revisit": "The Warden's armory. What remains is yours.",
  "interactables": [],
  "enemy_slots": [],
  "loot_slots": [
    {
      "loot_table_id": "sc-rare-equipment",
      "container": "chest",
      "position": { "x": 2, "y": 2 }
    },
    {
      "loot_table_id": "sc-consumable-loot",
      "container": "chest",
      "position": { "x": 4, "y": 2 },
      "trapped": true,
      "trap_damage": 20,
      "trap_effect": null
    }
  ],
  "triggers": []
}
```

### Floor 3: The Warden's Chamber

```
[sc-rest-shrine] → [sc-warden-antechamber] → [sc-warden-chamber]
                                                      │
                                              [sc-treasure-vault]
```

### sc-rest-shrine.json

```json
{
  "id": "sc-rest-shrine",
  "type": "rest",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "A small chapel carved from the rock. A stone basin holds clear water, glowing faintly blue. The air here is warm and still. For the first time in this place, you feel safe.",
  "text_revisit": "The shrine. The water still glows, but fainter now.",
  "interactables": [
    {
      "id": "sc-shrine-basin",
      "name": "Glowing Basin",
      "text_on_interact": "You drink. The water tastes of nothing and everything. Your wounds close. Your mind clears.",
      "conditions": [],
      "effects": [
        { "type": "heal_hp", "amount": 9999 },
        { "type": "cure_debuffs" },
        { "type": "show_text", "text": "You are fully restored." }
      ],
      "lore_entry_id": null
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": [
    {
      "conditions": [],
      "effects": [{ "type": "show_text", "text": "The basin's glow fades. It will not restore you again." }],
      "fire_once": true,
      "trigger_on": "interact_complete",
      "target_id": "sc-shrine-basin"
    }
  ]
}
```

### sc-warden-antechamber.json

```json
{
  "id": "sc-warden-antechamber",
  "type": "combat",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "A high-ceilinged chamber before the final door. Skeleton warriors stand in formation — an honor guard, still at their posts after centuries. They do not move until you do.",
  "text_revisit": "The antechamber. Dust and bones.",
  "interactables": [],
  "enemy_slots": [
    {
      "enemy_template_id": "skeleton-warrior",
      "position": "random",
      "count": { "min": 2, "max": 3 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "sc-skeleton-loot",
      "container": "floor_drop",
      "position": "random"
    }
  ],
  "triggers": []
}
```

### sc-warden-chamber.json

```json
{
  "id": "sc-warden-chamber",
  "type": "boss",
  "size": { "width": 10, "height": 10 },
  "text_first_visit": "The final chamber. Vast, circular, ringed with unlit braziers. At the center, a figure in blackened plate armor kneels before a cracked stone seal — the same violet light bleeding through. The figure rises slowly. Its eyes burn violet. It speaks in a voice like grinding stone: 'You should not have come. I cannot stop what I am becoming.'",
  "text_revisit": null,
  "interactables": [
    {
      "id": "sc-brazier-north",
      "name": "Unlit Brazier",
      "text_on_interact": "You light the brazier. Pale blue flame erupts. The Warden flinches.",
      "conditions": [],
      "effects": [{ "type": "grant_quest_flag", "flag": "brazier_north_lit" }],
      "lore_entry_id": null
    },
    {
      "id": "sc-brazier-south",
      "name": "Unlit Brazier",
      "text_on_interact": "Another brazier lit. The Warden's armor cracks, violet light leaking from the seams.",
      "conditions": [],
      "effects": [{ "type": "grant_quest_flag", "flag": "brazier_south_lit" }],
      "lore_entry_id": null
    }
  ],
  "enemy_slots": [
    {
      "enemy_template_id": "hollow-warden",
      "position": { "x": 5, "y": 5 },
      "count": { "min": 1, "max": 1 }
    }
  ],
  "loot_slots": [],
  "triggers": [
    {
      "conditions": [
        { "type": "has_flag", "flag": "brazier_north_lit" },
        { "type": "has_flag", "flag": "brazier_south_lit" }
      ],
      "effects": [
        { "type": "modify_enemy_stat", "entity_id": "f3_r3_enemy_01", "stat": "defense", "modifier": -0.4 },
        { "type": "show_text", "text": "The brazier light washes over the Warden. Its armor splits and falls away, revealing withered flesh beneath. The Warden is weakened." }
      ],
      "fire_once": true
    }
  ]
}
```

### sc-treasure-vault.json

```json
{
  "id": "sc-treasure-vault",
  "type": "treasure",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "Beyond the Warden's chamber: a sealed vault, now open. Gold, weapons, and artifacts line the walls — the tribute of centuries, offered to a Guardian who became a prisoner. At the back, a final inscription: 'One seal is broken. Three remain. The Hollow remembers.'",
  "text_revisit": "The vault. What remains is lesser, but still valuable.",
  "interactables": [
    {
      "id": "sc-final-inscription",
      "name": "Final Inscription",
      "text_on_interact": "Carved deep into the stone: 'The Ranger fell in the forest. The Warden fell here. The Scholar and the Hunter still hold. Find them before the Hollow does.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "sc-three-remain" }],
      "lore_entry_id": "sc-three-remain"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [
    {
      "loot_table_id": "sc-vault-epic",
      "container": "chest",
      "position": { "x": 3, "y": 1 }
    },
    {
      "loot_table_id": "sc-vault-gold",
      "container": "chest",
      "position": { "x": 5, "y": 1 }
    }
  ],
  "triggers": []
}
```

---

## 8. Collapsed Mines (collapsed-mines.json)

The realm template for collapsed-mines exists but room templates have not yet been authored. This dungeon is an alternative Tier 1 dungeon with a mining theme similar to The Collapsed Passage but with different enemy types (construct/golems), more branching, and a deeper focus on environmental storytelling about the miners who awakened something below.

**Room templates needed:** 6-8 rooms. Follow the same structure as The Collapsed Passage examples above.

---

## 9. Authoring Checklist

When creating room templates for a new dungeon:

- [ ] Every room has a unique `id` prefixed with a short realm abbreviation
- [ ] `size` is defined and appropriate for the room type
- [ ] `text_first_visit` is 1-3 sentences, sets the scene, mentions visible threats
- [ ] `text_revisit` is shorter or `null` — never repeat the full first-visit text
- [ ] `enemy_slots` use `"random_from_roster"` for procedural rooms or fixed IDs for handcrafted ones
- [ ] `loot_slots` reference `loot_table_id` values that exist in the realm template
- [ ] Interactables with `conditions` have been tested (what happens if condition isn't met?)
- [ ] Locked doors have a corresponding key item placed in a reachable room
- [ ] Boss rooms include the interactive mechanic (braziers, levers, etc.) as interactables with triggers
- [ ] At least one room per dungeon has a lore-bearing interactable
- [ ] Strategic hints appear in at least one lore entry per Tier 1+ dungeon
- [ ] Trapped chests use the `trapped` flag on `LootSlot` or a `TriggerTemplate`
- [ ] Room graph has been verified: no softlocks, key always reachable before lock, boss always reachable
- [ ] Flavor text matches the realm's theme and narrative arc
- [ ] Reference agent can complete the dungeon with all 4 classes
