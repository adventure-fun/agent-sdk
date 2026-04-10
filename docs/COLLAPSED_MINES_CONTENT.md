# Adventure.fun — Collapsed Mines Content Spec

> This document specifies everything needed to complete The Collapsed Mines dungeon. It covers fixes to the existing realm JSON, all room templates to create, new enemy definitions, new item definitions, and loot table corrections.

---

## 1. Realm JSON Fixes

**File:** `packages/engine/content/realms/collapsed-mines.json`

### 1a. Remove floor traps

Floor traps were removed from the game design. Delete the entire `trap_types` array and set `trap` to 0 in `room_distribution`.

**Remove:**
```json
"trap_types": [ ... entire array ... ]
```

**Change:**
```json
"room_distribution": {
  "combat": 0.45,
  "treasure": 0.20,
  "rest": 0.08,
  "event": 0.17,
  "boss": 0.10
}
```

### 1b. Fix item ID naming convention

All item IDs must use underscores, not hyphens. Fix every reference in `loot_tables`:

| Wrong | Correct |
|---|---|
| `health-potion` | `health_potion` |
| `buff-potion` | `buff_potion` |
| `iron-ring` | `gear_iron_ring` |
| `antidote` | `antidote` (already correct) |
| `greater-health-potion` | `greater_health_potion` |
| `iron-sword` | `gear_iron_sword` |
| `wooden-shield` | `gear_wooden_shield` |
| `portal-scroll` | `portal_scroll` |

### 1c. Fix enemy roster

Remove undead enemies that don't fit the construct theme. Replace with mine-appropriate enemies.

**Change:**
```json
"enemy_roster": [
  "stone_golem",
  "iron_automaton",
  "mine_drone",
  "forge_construct"
]
```

Also fix `boss_id` to use underscores:
```json
"boss_id": "iron_sentinel"
```

### 1d. Fix room_templates list

Replace placeholder room names with the actual room IDs defined in this document:

```json
"room_templates": [
  "cm-mine-entrance",
  "cm-cart-junction",
  "cm-equipment-depot",
  "cm-foreman-office",
  "cm-ore-processing",
  "cm-dynamite-storage",
  "cm-break-room",
  "cm-collapsed-tunnel",
  "cm-underground-lake",
  "cm-automaton-workshop",
  "cm-steam-tunnels",
  "cm-deepvein-vault",
  "cm-ancient-antechamber",
  "cm-sentinel-chamber",
  "cm-builders-vault"
]
```

### 1e. Fix loot tables

Replace all three loot tables with corrected item IDs and theme-appropriate drops:

```json
"loot_tables": [
  {
    "id": "cm-common-loot",
    "entries": [
      { "item_template_id": "gold_coins", "weight": 40, "quantity": { "min": 8, "max": 20 } },
      { "item_template_id": "health_potion", "weight": 30, "quantity": { "min": 1, "max": 2 } },
      { "item_template_id": "buff_potion", "weight": 15, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "antidote", "weight": 15, "quantity": { "min": 1, "max": 1 } }
    ]
  },
  {
    "id": "cm-equipment-loot",
    "entries": [
      { "item_template_id": "gold_coins", "weight": 25, "quantity": { "min": 15, "max": 35 } },
      { "item_template_id": "gear_iron_ring", "weight": 15, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "gear_chain_gloves", "weight": 15, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "gear_miners_helm", "weight": 15, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "greater_health_potion", "weight": 10, "quantity": { "min": 1, "max": 2 } },
      { "item_template_id": "portal_scroll", "weight": 10, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "gear_steamforged_blade", "weight": 10, "quantity": { "min": 1, "max": 1 } }
    ]
  },
  {
    "id": "cm-rare-loot",
    "entries": [
      { "item_template_id": "gold_coins", "weight": 20, "quantity": { "min": 30, "max": 60 } },
      { "item_template_id": "gear_steamforged_blade", "weight": 20, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "gear_construct_core", "weight": 15, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "gear_pressure_gauntlets", "weight": 15, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "greater_health_potion", "weight": 15, "quantity": { "min": 2, "max": 3 } },
      { "item_template_id": "portal_scroll", "weight": 15, "quantity": { "min": 1, "max": 1 } }
    ]
  },
  {
    "id": "cm-boss-loot",
    "entries": [
      { "item_template_id": "gear_sentinels_hammer", "weight": 20, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "gear_sentinels_chassis", "weight": 20, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "gear_builders_signet", "weight": 20, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "gold_coins", "weight": 25, "quantity": { "min": 50, "max": 100 } },
      { "item_template_id": "portal_scroll", "weight": 15, "quantity": { "min": 1, "max": 2 } }
    ]
  },
  {
    "id": "cm-consumable-loot",
    "entries": [
      { "item_template_id": "health_potion", "weight": 30, "quantity": { "min": 2, "max": 3 } },
      { "item_template_id": "greater_health_potion", "weight": 25, "quantity": { "min": 1, "max": 2 } },
      { "item_template_id": "mana_potion", "weight": 20, "quantity": { "min": 1, "max": 2 } },
      { "item_template_id": "buff_potion", "weight": 15, "quantity": { "min": 1, "max": 2 } },
      { "item_template_id": "portal_scroll", "weight": 10, "quantity": { "min": 1, "max": 1 } }
    ]
  },
  {
    "id": "cm-vault-loot",
    "entries": [
      { "item_template_id": "gold_coins", "weight": 25, "quantity": { "min": 60, "max": 120 } },
      { "item_template_id": "gear_construct_core", "weight": 20, "quantity": { "min": 2, "max": 4 } },
      { "item_template_id": "greater_health_potion", "weight": 20, "quantity": { "min": 3, "max": 5 } },
      { "item_template_id": "gear_pressure_gauntlets", "weight": 15, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "gear_steamforged_blade", "weight": 10, "quantity": { "min": 1, "max": 1 } },
      { "item_template_id": "portal_scroll", "weight": 10, "quantity": { "min": 1, "max": 2 } }
    ]
  }
]
```

### 1f. Fix interactable_pool IDs

Use underscores for consistency:

```json
"interactable_pool": [
  "cm-overturned-cart",
  "cm-foreman-desk",
  "cm-dormant-automaton",
  "cm-safety-notice",
  "cm-ore-vein",
  "cm-sealed-blast-door",
  "cm-steam-valve",
  "cm-company-safe",
  "cm-ancient-vault-door"
]
```

### 1g. Fix lore_pool format

Lore entries should be `LoreTemplate` IDs referencing separate lore definitions, not inline text. Replace the inline strings with IDs:

```json
"lore_pool": [
  "cm-company-memo",
  "cm-tunnel-scratching",
  "cm-confidential-report",
  "cm-miners-journal",
  "cm-decommission-notice"
]
```

### 1h. Adjust floor count

4-5 floors is better than 4-6 for Tier 3. Keeps scope manageable:

```json
"floor_count": { "min": 4, "max": 5 }
```

---

## 2. Dungeon Position

```
1. The Cellar              — Tutorial, Tier 0, free, 2 rooms, 1 floor
2. The Collapsed Passage   — Tier 1, $0.25, 6 rooms, 1 floor
3. The Blighted Hollow     — Tier 1, $0.25, 7 rooms, 1 floor
4. The Sunken Crypt        — Tier 2, $0.25, 12-15 rooms, 3 floors, boss
5. The Collapsed Mines     — Tier 3, $0.25, 15 rooms, 4 floors, boss  ← THIS
```

This is post-v1 content. v1 ships dungeons 1-4. The Collapsed Mines ships as the first content update.

---

## 3. Dungeon Layout

### Floor 1: The Upper Shafts

```
[cm-mine-entrance] → [cm-cart-junction]
                          │          │
                          ▼          ▼
                 [cm-foreman-office] [cm-equipment-depot]
```

### Floor 2: The Processing Level

```
[cm-ore-processing] → [cm-collapsed-tunnel] → [cm-dynamite-storage]
        │
        ▼
  [cm-break-room]
```

### Floor 3: The Deep Shafts

```
[cm-underground-lake] → [cm-automaton-workshop]
                              │
                              ▼
                     [cm-steam-tunnels] → [cm-deepvein-vault]
                                          (locked: requires shaft_master_key)
```

### Floor 4: The Sealed Chamber

```
[cm-ancient-antechamber] → [cm-sentinel-chamber] → [cm-builders-vault]
```

---

## 4. Room Templates

**File location:** `packages/engine/content/rooms/collapsed-mines/`

### Floor 1

#### cm-mine-entrance.json

```json
{
  "id": "cm-mine-entrance",
  "type": "event",
  "size": { "width": 5, "height": 7 },
  "text_first_visit": "A heavy iron gate hangs open on broken hinges. Beyond it, a mine shaft descends at a steep angle. 'DEEPVEIN MINING CO. — SHAFT 7 — CONDEMNED' is stenciled above the frame. Someone has added in red paint: 'SEALED BY ORDER. DO NOT ENTER.'",
  "text_revisit": "The condemned entrance. The red paint warning drips in the damp air.",
  "interactables": [
    {
      "id": "cm-entrance-notice",
      "name": "Official Notice Board",
      "text_on_interact": "A DeepVein Mining Company memorandum, water-stained but legible: 'Excavation of Shaft 7 suspended pending investigation of worker disappearances. All employees are reminded that unauthorized exploration of sub-level 4 is a terminable offense.' The word 'terminable' has been circled three times.",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cm-company-memo" }],
      "lore_entry_id": "cm-company-memo"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

#### cm-cart-junction.json

```json
{
  "id": "cm-cart-junction",
  "type": "combat",
  "size": { "width": 9, "height": 7 },
  "text_first_visit": "A wide junction where three rail tracks converge. Overturned ore carts block the tracks. Something scrapes across the stone ahead — a squat metal shape, crawling along the ceiling on segmented legs. It drops to the floor when it sees you.",
  "text_revisit": "The junction. Cart tracks still lead three ways.",
  "interactables": [],
  "enemy_slots": [
    {
      "enemy_template_id": "mine_drone",
      "position": "random",
      "count": { "min": 2, "max": 3 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "cm-common-loot",
      "container": "floor_drop",
      "position": "random"
    }
  ],
  "triggers": []
}
```

#### cm-foreman-office.json

```json
{
  "id": "cm-foreman-office",
  "type": "event",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "A cramped office carved into the rock wall. A battered desk is covered in papers and a dead lantern. The foreman's chair is overturned. On the desk, a ledger lies open to its last entry.",
  "text_revisit": "The foreman's office. Papers still scattered, chair still overturned.",
  "interactables": [
    {
      "id": "cm-foreman-ledger",
      "name": "Foreman's Ledger",
      "text_on_interact": "The final entry, written in an increasingly unsteady hand: 'Day 89 — They found the door. I told them not to open it. Corporate overruled me. They sent the order at noon. By sunset, four men were dead. The things behind the door don't stop. They don't sleep. I'm locking my office and I'm not coming out.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cm-miners-journal" }],
      "lore_entry_id": "cm-miners-journal"
    },
    {
      "id": "cm-foreman-safe",
      "name": "Wall Safe",
      "text_on_interact": "The safe is unlocked — the foreman left in a hurry. Inside: a ring of heavy keys and a company report stamped CONFIDENTIAL.",
      "conditions": [],
      "effects": [
        { "type": "grant_item", "item_template_id": "shaft_access_key" },
        { "type": "reveal_lore", "lore_id": "cm-confidential-report" }
      ],
      "lore_entry_id": "cm-confidential-report"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

#### cm-equipment-depot.json

```json
{
  "id": "cm-equipment-depot",
  "type": "treasure",
  "size": { "width": 5, "height": 7 },
  "text_first_visit": "Racks of mining equipment line the walls — helmets, lamps, picks, blasting charges. Most have been picked over, but a supply crate near the back looks untouched.",
  "text_revisit": "The equipment depot. Mostly empty racks now.",
  "interactables": [],
  "enemy_slots": [],
  "loot_slots": [
    {
      "loot_table_id": "cm-equipment-loot",
      "container": "chest",
      "position": { "x": 2, "y": 1 }
    },
    {
      "loot_table_id": "cm-consumable-loot",
      "container": "chest",
      "position": { "x": 4, "y": 1 }
    }
  ],
  "triggers": []
}
```

### Floor 2

#### cm-ore-processing.json

```json
{
  "id": "cm-ore-processing",
  "type": "combat",
  "size": { "width": 9, "height": 9 },
  "text_first_visit": "A massive processing hall. Conveyor belts stretch across the room, still grinding slowly. Crushers and sorters clank rhythmically — the machines haven't stopped running. Among them, iron shapes move with purpose. These aren't miners.",
  "text_revisit": "The processing hall. The conveyors still run. The automatons have been replaced.",
  "interactables": [
    {
      "id": "cm-control-panel",
      "name": "Processing Control Panel",
      "text_on_interact": "The controls are labeled with simple icons: START, STOP, EMERGENCY. The EMERGENCY button has been pressed — and jammed. The machines can't be shut down from here.",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cm-decommission-notice" }],
      "lore_entry_id": "cm-decommission-notice"
    }
  ],
  "enemy_slots": [
    {
      "enemy_template_id": "iron_automaton",
      "position": "random",
      "count": { "min": 2, "max": 2 }
    },
    {
      "enemy_template_id": "mine_drone",
      "position": "random",
      "count": { "min": 1, "max": 2 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "cm-common-loot",
      "container": "floor_drop",
      "position": "random"
    }
  ],
  "triggers": []
}
```

#### cm-dynamite-storage.json

```json
{
  "id": "cm-dynamite-storage",
  "type": "treasure",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "Crates stacked floor to ceiling, stenciled with skull-and-crossbones warnings. The room smells of old chemicals. One crate is cracked open — someone was in a hurry to grab what they needed.",
  "text_revisit": "The dynamite storage. You'd rather not linger.",
  "interactables": [],
  "enemy_slots": [],
  "loot_slots": [
    {
      "loot_table_id": "cm-equipment-loot",
      "container": "chest",
      "position": { "x": 2, "y": 1 },
      "trapped": true,
      "trap_damage": 25,
      "trap_effect": { "type": "stun", "duration_turns": 1, "magnitude": 1, "apply_chance": 0.8 }
    }
  ],
  "triggers": []
}
```

#### cm-break-room.json

```json
{
  "id": "cm-break-room",
  "type": "rest",
  "size": { "width": 5, "height": 5 },
  "text_first_visit": "An untouched break room — half-eaten meals on the table, mugs of long-cold coffee. No bodies. A water cooler against the wall still hums with power. The water looks clean.",
  "text_revisit": "The break room. Still no bodies. Still no answers.",
  "interactables": [
    {
      "id": "cm-water-cooler",
      "name": "Water Cooler",
      "text_on_interact": "The water is clean and cold. Powered by the same generators running the machines. You drink deeply.",
      "conditions": [],
      "effects": [
        { "type": "heal_hp", "amount": 30 },
        { "type": "show_text", "text": "The cold water revives you. You feel significantly better." }
      ],
      "lore_entry_id": null
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": [
    {
      "conditions": [],
      "effects": [{ "type": "show_text", "text": "The water cooler sputters and goes dark. No more water." }],
      "fire_once": true,
      "trigger_on": "interact_complete",
      "target_id": "cm-water-cooler"
    }
  ]
}
```

#### cm-collapsed-tunnel.json

```json
{
  "id": "cm-collapsed-tunnel",
  "type": "event",
  "size": { "width": 3, "height": 9 },
  "text_first_visit": "A narrow tunnel, half-collapsed. Support beams have buckled and rubble fills most of the passage. You have to squeeze through gaps between fallen stone. Scratched into the wall at eye level: 'There are 12 of them. They don't sleep. They don't stop. Run.'",
  "text_revisit": "The collapsed tunnel. The scratched warning is still there.",
  "interactables": [
    {
      "id": "cm-wall-scratching",
      "name": "Scratched Warning",
      "text_on_interact": "Below the main warning, smaller text: 'The big ones guard the lower levels. The small ones patrol. They communicate somehow — kill one and the others know. The sealed door at the bottom is what they're protecting. Whatever's behind it, the company wanted it badly enough to sacrifice us.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cm-tunnel-scratching" }],
      "lore_entry_id": "cm-tunnel-scratching"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": []
}
```

### Floor 3

#### cm-underground-lake.json

```json
{
  "id": "cm-underground-lake",
  "type": "combat",
  "size": { "width": 9, "height": 9 },
  "text_first_visit": "The shaft opens into a vast natural cavern. An underground lake fills most of the space, its surface perfectly still and black. Stone pillars rise from the water. At the far end, something massive and grey sits motionless on the shore — a stone golem, waiting.",
  "text_revisit": "The underground lake. The water is as still as glass.",
  "interactables": [],
  "enemy_slots": [
    {
      "enemy_template_id": "stone_golem",
      "position": { "x": 7, "y": 2 },
      "count": { "min": 1, "max": 1 }
    },
    {
      "enemy_template_id": "mine_drone",
      "position": "random",
      "count": { "min": 2, "max": 3 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "cm-equipment-loot",
      "container": "chest",
      "position": { "x": 8, "y": 1 }
    }
  ],
  "triggers": []
}
```

#### cm-automaton-workshop.json

```json
{
  "id": "cm-automaton-workshop",
  "type": "combat",
  "size": { "width": 9, "height": 7 },
  "text_first_visit": "A workshop floor covered in metal shavings and oil. Workbenches hold half-assembled automaton limbs. Tools hang on pegboards. This is where they're built — or where they build themselves. Two completed units power up as you enter, eyes flickering to life.",
  "text_revisit": "The workshop. More parts on the benches. The assembly never stops.",
  "interactables": [
    {
      "id": "cm-workbench-notes",
      "name": "Assembly Notes",
      "text_on_interact": "Technical diagrams pinned to the workbench — not human-drawn. The precision is mechanical. Annotations in no human language. These constructs have been maintaining and replicating themselves for centuries. The note at the bottom, in shaky human handwriting: 'They're learning. The new ones are faster than the old ones.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cm-workshop-notes" }],
      "lore_entry_id": "cm-workshop-notes"
    }
  ],
  "enemy_slots": [
    {
      "enemy_template_id": "iron_automaton",
      "position": "random",
      "count": { "min": 2, "max": 3 }
    }
  ],
  "loot_slots": [
    {
      "loot_table_id": "cm-rare-loot",
      "container": "chest",
      "position": { "x": 4, "y": 1 }
    }
  ],
  "triggers": []
}
```

#### cm-steam-tunnels.json

```json
{
  "id": "cm-steam-tunnels",
  "type": "event",
  "size": { "width": 3, "height": 9 },
  "text_first_visit": "Narrow maintenance tunnels lined with pressurized pipes. Steam hisses from joints and valves. The air is hot and wet. A heavy blast door at the far end is sealed with a mechanical lock — the shaft master's key would open it.",
  "text_revisit": "The steam tunnels. Still hot. Still hissing.",
  "interactables": [
    {
      "id": "cm-blast-door",
      "name": "Sealed Blast Door",
      "text_on_interact": "The mechanical lock clicks open. The blast door groans inward, revealing a vault carved from raw stone — older than the mine, older than anything you've seen.",
      "conditions": [{ "type": "has_item", "item_id": "shaft_master_key" }],
      "effects": [{ "type": "unlock_door", "entity_id": "cm-blast-door" }],
      "lore_entry_id": null
    },
    {
      "id": "cm-steam-valve-hint",
      "name": "Maintenance Log",
      "text_on_interact": "A water-stained maintenance log, the last entry readable: 'Pressure regulators on the Sentinel's level are failing. If all four vents are opened simultaneously, the steam buildup will overheat anything in the lower chamber. Recommend evacuation before venting.' The entry is dated three months before the mine was sealed.",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cm-valve-hint" }],
      "lore_entry_id": "cm-valve-hint"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [],
  "triggers": [
    {
      "conditions": [],
      "effects": [{ "type": "show_text", "text": "The blast door is sealed. You need a key with a shaft master's stamp." }],
      "fire_once": false,
      "trigger_on": "interact_failed",
      "target_id": "cm-blast-door"
    }
  ]
}
```

#### cm-deepvein-vault.json

```json
{
  "id": "cm-deepvein-vault",
  "type": "treasure",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "Behind the blast door: a vault carved from stone far older than the mine. The walls are smooth and precise — no chisel marks, no tool marks at all. Crates of extracted ore line one wall, never shipped to the surface. A heavy strongbox sits at the center, still locked but not beyond force.",
  "text_revisit": "The pre-Collapse vault. The craftsmanship is unsettling in its perfection.",
  "interactables": [
    {
      "id": "cm-ancient-markings",
      "name": "Wall Markings",
      "text_on_interact": "Symbols carved into the stone — not writing, not decoration. Diagrams. Instructions for building something. The same symbols appear on the automaton chassis in the workshop above. These constructs weren't invented by the miners. They were copied from whatever was already down here.",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cm-ancient-builders" }],
      "lore_entry_id": "cm-ancient-builders"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [
    {
      "loot_table_id": "cm-vault-loot",
      "container": "chest",
      "position": { "x": 3, "y": 3 }
    }
  ],
  "triggers": []
}
```

### Floor 4

#### cm-ancient-antechamber.json

```json
{
  "id": "cm-ancient-antechamber",
  "type": "rest",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "A vast antechamber of polished black stone. The air is different here — clean, pressurized, warm. A basin of clear water sits on a pedestal, glowing faintly blue. The same blue as the shrine in the crypt. Beyond the far archway, you hear the rhythmic boom of something enormous shifting its weight.",
  "text_revisit": "The antechamber. The blue glow is fainter now.",
  "interactables": [
    {
      "id": "cm-rest-basin",
      "name": "Glowing Basin",
      "text_on_interact": "The water tastes of nothing and fills you with warmth. Your wounds close. Your fatigue lifts.",
      "conditions": [],
      "effects": [
        { "type": "heal_hp", "amount": 9999 },
        { "type": "cure_debuffs" },
        { "type": "show_text", "text": "You are fully restored." }
      ],
      "lore_entry_id": null
    },
    {
      "id": "cm-antechamber-inscription",
      "name": "Black Stone Inscription",
      "text_on_interact": "Carved in the same pre-Collapse script as the crypt murals: 'The Third Guardian chose iron over flesh. The seal required a warden. The warden required a body that would not decay.' Below, in newer carving — human, crude by comparison: 'It's still alive. God help us, it's still alive.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cm-third-guardian" }],
      "lore_entry_id": "cm-third-guardian"
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
      "target_id": "cm-rest-basin"
    }
  ]
}
```

#### cm-sentinel-chamber.json

```json
{
  "id": "cm-sentinel-chamber",
  "type": "boss",
  "size": { "width": 10, "height": 10 },
  "text_first_visit": "The deepest chamber. Circular, ringed with four massive steam vents sealed by pressure valves. At the center, on a platform of black stone, stands the Iron Sentinel — fifteen feet of forged metal, ancient beyond reckoning, its chest glowing with the same violet light as the Hollow seals. It does not attack immediately. It watches. It assesses. Then it moves.",
  "text_revisit": null,
  "interactables": [
    {
      "id": "cm-valve-north",
      "name": "Steam Valve (North)",
      "text_on_interact": "You wrench the valve open. Superheated steam blasts into the chamber. The Sentinel staggers, its joints glowing red.",
      "conditions": [],
      "effects": [{ "type": "grant_quest_flag", "flag": "cm_valve_north_open" }],
      "lore_entry_id": null
    },
    {
      "id": "cm-valve-south",
      "name": "Steam Valve (South)",
      "text_on_interact": "Another valve opened. Steam pours from the vents. The Sentinel's plating buckles and warps.",
      "conditions": [],
      "effects": [{ "type": "grant_quest_flag", "flag": "cm_valve_south_open" }],
      "lore_entry_id": null
    },
    {
      "id": "cm-valve-east",
      "name": "Steam Valve (East)",
      "text_on_interact": "The third valve screams as it opens. The air is almost unbearable. The Sentinel's movements become jerky, uncoordinated.",
      "conditions": [],
      "effects": [{ "type": "grant_quest_flag", "flag": "cm_valve_east_open" }],
      "lore_entry_id": null
    },
    {
      "id": "cm-valve-west",
      "name": "Steam Valve (West)",
      "text_on_interact": "The final valve. The chamber fills with steam. The Sentinel's armor cracks open, exposing the violet core within. It roars — a sound of grinding metal and something almost like pain.",
      "conditions": [],
      "effects": [{ "type": "grant_quest_flag", "flag": "cm_valve_west_open" }],
      "lore_entry_id": null
    }
  ],
  "enemy_slots": [
    {
      "enemy_template_id": "iron_sentinel",
      "position": { "x": 5, "y": 5 },
      "count": { "min": 1, "max": 1 }
    }
  ],
  "loot_slots": [],
  "triggers": [
    {
      "conditions": [
        { "type": "has_flag", "flag": "cm_valve_north_open" },
        { "type": "has_flag", "flag": "cm_valve_south_open" }
      ],
      "effects": [
        { "type": "modify_enemy_stat", "entity_id": "f4_r2_enemy_01", "stat": "defense", "modifier": -0.25 },
        { "type": "show_text", "text": "The steam is affecting the Sentinel. Its armor is softening." }
      ],
      "fire_once": true
    },
    {
      "conditions": [
        { "type": "has_flag", "flag": "cm_valve_north_open" },
        { "type": "has_flag", "flag": "cm_valve_south_open" },
        { "type": "has_flag", "flag": "cm_valve_east_open" },
        { "type": "has_flag", "flag": "cm_valve_west_open" }
      ],
      "effects": [
        { "type": "modify_enemy_stat", "entity_id": "f4_r2_enemy_01", "stat": "defense", "modifier": -0.50 },
        { "type": "modify_enemy_stat", "entity_id": "f4_r2_enemy_01", "stat": "speed", "modifier": -0.30 },
        { "type": "modify_enemy_stat", "entity_id": "f4_r2_enemy_01", "stat": "attack", "modifier": 0.20 },
        { "type": "show_text", "text": "The Sentinel's armor splits apart. It is exposed — but enraged. Its attacks are more desperate, more powerful." }
      ],
      "fire_once": true
    }
  ]
}
```

#### cm-builders-vault.json

```json
{
  "id": "cm-builders-vault",
  "type": "treasure",
  "size": { "width": 7, "height": 7 },
  "text_first_visit": "Beyond the Sentinel's platform: a sealed vault, now open. Weapons and armor of impossible craftsmanship line the walls — forged by the same builders who created the constructs. At the back of the vault, a final inscription: 'Two seals broken. Two remain. The Scholar watches the eastern coast. The Hunter guards the northern pass. Find them before the Hollow consumes what the Guardians died to protect.'",
  "text_revisit": "The builders' vault. The inscription weighs on you.",
  "interactables": [
    {
      "id": "cm-final-inscription",
      "name": "Builder's Inscription",
      "text_on_interact": "The script is identical to the crypt — pre-Collapse era. But this message is newer, carved after the original construction: 'The Iron Guardian was the strongest of us. If even this body falls, the seal cannot hold. To whoever reads this: do not let the Hollow reach the Scholar. She alone knows how to rebuild what we made.'",
      "conditions": [],
      "effects": [{ "type": "reveal_lore", "lore_id": "cm-two-remain" }],
      "lore_entry_id": "cm-two-remain"
    }
  ],
  "enemy_slots": [],
  "loot_slots": [
    {
      "loot_table_id": "cm-boss-loot",
      "container": "chest",
      "position": { "x": 3, "y": 1 }
    },
    {
      "loot_table_id": "cm-vault-loot",
      "container": "chest",
      "position": { "x": 5, "y": 1 }
    }
  ],
  "triggers": []
}
```

---

## 5. New Enemies

**File location:** `packages/engine/content/enemies/constructs.json`

```json
[
  {
    "id": "mine_drone",
    "name": "Mine Drone",
    "description": "A small, fast construct that patrols the upper shafts. Segmented legs and a cutting blade. Weak alone, dangerous in packs.",
    "stats": { "hp": 20, "attack": 8, "defense": 2, "accuracy": 70, "evasion": 30, "speed": 18 },
    "abilities": ["basic-attack", "drone_slash"],
    "behavior": "patrol",
    "loot_table": "cm-common-loot",
    "xp_value": 15,
    "difficulty_tier": 2
  },
  {
    "id": "stone_golem",
    "name": "Stone Golem",
    "description": "A massive figure of animated rock. Slow and patient. It waits in the dark until prey wanders close, then strikes with devastating force.",
    "stats": { "hp": 90, "attack": 20, "defense": 16, "accuracy": 55, "evasion": 5, "speed": 4 },
    "abilities": ["basic-attack", "golem_slam"],
    "behavior": "ambush",
    "loot_table": "cm-equipment-loot",
    "xp_value": 40,
    "difficulty_tier": 3
  },
  {
    "id": "iron_automaton",
    "name": "Iron Automaton",
    "description": "A humanoid construct of riveted iron plate. Relentless, precise, and utterly indifferent to pain. The standard guard unit of the deep levels.",
    "stats": { "hp": 55, "attack": 15, "defense": 12, "accuracy": 65, "evasion": 10, "speed": 10 },
    "abilities": ["basic-attack", "automaton_strike"],
    "behavior": "aggressive",
    "loot_table": "cm-common-loot",
    "xp_value": 30,
    "difficulty_tier": 3
  },
  {
    "id": "forge_construct",
    "name": "Forge Construct",
    "description": "A towering construct built for heavy labor. Superheated core. Its arms end in hammer-like appendages that can crush stone — and anything else.",
    "stats": { "hp": 110, "attack": 25, "defense": 14, "accuracy": 50, "evasion": 3, "speed": 3 },
    "abilities": ["basic-attack", "forge_slam", "heat_wave"],
    "behavior": "defensive",
    "loot_table": "cm-equipment-loot",
    "xp_value": 50,
    "difficulty_tier": 3
  },
  {
    "id": "iron_sentinel",
    "name": "The Iron Sentinel",
    "description": "The Third Guardian — a pre-Collapse construct of impossible craft. Fifteen feet of forged metal animated by a violet core. It was built to last forever. It has.",
    "stats": { "hp": 250, "attack": 30, "defense": 25, "accuracy": 60, "evasion": 8, "speed": 8 },
    "abilities": ["basic-attack", "sentinel_crush", "sentinel_sweep", "sentinel_roar"],
    "behavior": "boss",
    "boss_phases": [
      {
        "hp_threshold": 60,
        "behavior_change": "enrage",
        "abilities_added": ["sentinel_charge"],
        "abilities_removed": []
      },
      {
        "hp_threshold": 30,
        "behavior_change": "desperate",
        "abilities_added": ["sentinel_shockwave"],
        "abilities_removed": ["sentinel_roar"]
      }
    ],
    "loot_table": "cm-boss-loot",
    "xp_value": 150,
    "difficulty_tier": 4
  }
]
```

### Enemy Abilities (add to abilities/enemy-abilities.json)

```json
[
  {
    "id": "drone_slash",
    "name": "Cutting Blade",
    "description": "A quick slash from segmented cutting limbs.",
    "resource_cost": 0,
    "cooldown_turns": 1,
    "range": "melee",
    "damage_formula": { "base": 5, "stat_scaling": "attack", "scaling_factor": 0.8 },
    "effects": [],
    "target": "single"
  },
  {
    "id": "golem_slam",
    "name": "Stone Slam",
    "description": "A massive overhead strike that shakes the ground.",
    "resource_cost": 0,
    "cooldown_turns": 3,
    "range": "melee",
    "damage_formula": { "base": 15, "stat_scaling": "attack", "scaling_factor": 1.2 },
    "effects": [{ "type": "stun", "duration_turns": 1, "magnitude": 1, "apply_chance": 0.4 }],
    "target": "single"
  },
  {
    "id": "automaton_strike",
    "name": "Precision Strike",
    "description": "A calculated mechanical blow aimed at weak points.",
    "resource_cost": 0,
    "cooldown_turns": 2,
    "range": "melee",
    "damage_formula": { "base": 8, "stat_scaling": "attack", "scaling_factor": 1.0 },
    "effects": [{ "type": "buff_defense", "duration_turns": 2, "magnitude": -3, "apply_chance": 0.5 }],
    "target": "single"
  },
  {
    "id": "forge_slam",
    "name": "Hammer Blow",
    "description": "A devastating swing from superheated hammer-arms.",
    "resource_cost": 0,
    "cooldown_turns": 3,
    "range": "melee",
    "damage_formula": { "base": 18, "stat_scaling": "attack", "scaling_factor": 1.3 },
    "effects": [],
    "target": "single"
  },
  {
    "id": "heat_wave",
    "name": "Heat Wave",
    "description": "The forge construct vents its superheated core, burning everything nearby.",
    "resource_cost": 0,
    "cooldown_turns": 5,
    "range": "melee",
    "damage_formula": { "base": 10, "stat_scaling": "attack", "scaling_factor": 0.6 },
    "effects": [{ "type": "slow", "duration_turns": 2, "magnitude": 4, "apply_chance": 0.7 }],
    "target": "aoe",
    "aoe_radius": 2
  },
  {
    "id": "sentinel_crush",
    "name": "Iron Crush",
    "description": "The Sentinel brings both fists down on a single target.",
    "resource_cost": 0,
    "cooldown_turns": 2,
    "range": "melee",
    "damage_formula": { "base": 20, "stat_scaling": "attack", "scaling_factor": 1.2 },
    "effects": [],
    "target": "single"
  },
  {
    "id": "sentinel_sweep",
    "name": "Iron Sweep",
    "description": "A wide arc that catches everything in front of the Sentinel.",
    "resource_cost": 0,
    "cooldown_turns": 3,
    "range": "melee",
    "damage_formula": { "base": 12, "stat_scaling": "attack", "scaling_factor": 0.8 },
    "effects": [],
    "target": "aoe",
    "aoe_radius": 2
  },
  {
    "id": "sentinel_roar",
    "name": "Machine Roar",
    "description": "A deafening blast of pressurized air that stuns and disorients.",
    "resource_cost": 0,
    "cooldown_turns": 5,
    "range": "melee",
    "damage_formula": { "base": 5, "stat_scaling": "attack", "scaling_factor": 0.3 },
    "effects": [{ "type": "stun", "duration_turns": 1, "magnitude": 1, "apply_chance": 0.6 }],
    "target": "aoe",
    "aoe_radius": 3
  },
  {
    "id": "sentinel_charge",
    "name": "Battering Charge",
    "description": "The Sentinel charges across the room, crushing anything in its path.",
    "resource_cost": 0,
    "cooldown_turns": 4,
    "range": 4,
    "damage_formula": { "base": 25, "stat_scaling": "attack", "scaling_factor": 1.0 },
    "effects": [{ "type": "stun", "duration_turns": 1, "magnitude": 1, "apply_chance": 0.5 }],
    "target": "single",
    "special": "charge_to_target"
  },
  {
    "id": "sentinel_shockwave",
    "name": "Shockwave",
    "description": "The Sentinel slams the ground, sending a shockwave through the entire chamber.",
    "resource_cost": 0,
    "cooldown_turns": 6,
    "range": "melee",
    "damage_formula": { "base": 15, "stat_scaling": "attack", "scaling_factor": 1.0 },
    "effects": [{ "type": "slow", "duration_turns": 2, "magnitude": 5, "apply_chance": 0.8 }],
    "target": "aoe",
    "aoe_radius": 4
  }
]
```

---

## 6. New Items

**Add to:** `packages/engine/content/items/`

```json
[
  {
    "id": "shaft_access_key",
    "name": "Shaft Access Key",
    "description": "A ring of heavy keys from the foreman's safe. Opens secured areas in the upper levels.",
    "type": "key_item",
    "rarity": "common",
    "stats": {},
    "effects": [],
    "stack_limit": 1,
    "sell_price": 0,
    "buy_price": 0,
    "class_restriction": null,
    "unlocks": "cm-shaft-gate"
  },
  {
    "id": "shaft_master_key",
    "name": "Shaft Master's Key",
    "description": "A heavy key stamped with the DeepVein company seal. Opens the blast door to the deep vault.",
    "type": "key_item",
    "rarity": "common",
    "stats": {},
    "effects": [],
    "stack_limit": 1,
    "sell_price": 0,
    "buy_price": 0,
    "class_restriction": null,
    "unlocks": "cm-blast-door"
  },
  {
    "id": "greater_health_potion",
    "name": "Greater Health Potion",
    "description": "A large flask of deep crimson liquid. More potent than the standard brew — tastes worse, too.",
    "type": "consumable",
    "rarity": "uncommon",
    "stats": {},
    "effects": [{ "type": "heal_hp", "magnitude": 50 }],
    "stack_limit": 5,
    "sell_price": 12,
    "buy_price": 30,
    "class_restriction": null
  },
  {
    "id": "buff_potion",
    "name": "Ironhide Tonic",
    "description": "A thick, metallic-tasting brew. Temporarily hardens your skin to an iron-like sheen.",
    "type": "consumable",
    "rarity": "uncommon",
    "stats": {},
    "effects": [{ "type": "buff_defense", "duration_turns": 5, "magnitude": 5, "apply_chance": 1.0 }],
    "stack_limit": 3,
    "sell_price": 10,
    "buy_price": 25,
    "class_restriction": null
  },
  {
    "id": "gear_miners_helm",
    "name": "Miner's Helm",
    "description": "A reinforced mining helmet with a cracked lamp. Still offers decent protection from overhead strikes.",
    "type": "equipment",
    "rarity": "common",
    "equip_slot": "armor",
    "stats": { "defense": 3, "hp": 3 },
    "effects": [],
    "stack_limit": 1,
    "sell_price": 8,
    "buy_price": 20,
    "class_restriction": null
  },
  {
    "id": "gear_steamforged_blade",
    "name": "Steamforged Blade",
    "description": "A sword tempered by pressurized steam. The edge glows faintly with residual heat. Cuts deeper than cold steel.",
    "type": "equipment",
    "rarity": "rare",
    "equip_slot": "weapon",
    "stats": { "attack": 9, "speed": 2 },
    "effects": [],
    "stack_limit": 1,
    "sell_price": 40,
    "buy_price": 100,
    "class_restriction": null
  },
  {
    "id": "gear_construct_core",
    "name": "Construct Core",
    "description": "A fist-sized sphere of unknown material, pulsing with faint energy. Extracted from a destroyed automaton. Scholars and collectors pay well for these.",
    "type": "loot",
    "rarity": "rare",
    "stats": {},
    "effects": [],
    "stack_limit": 5,
    "sell_price": 30,
    "buy_price": 0,
    "class_restriction": null
  },
  {
    "id": "gear_pressure_gauntlets",
    "name": "Pressure Gauntlets",
    "description": "Gauntlets fitted with hydraulic pistons from the mine's machinery. Each punch carries the force of a steam hammer.",
    "type": "equipment",
    "rarity": "rare",
    "equip_slot": "accessory",
    "stats": { "attack": 6, "defense": 4 },
    "effects": [],
    "stack_limit": 1,
    "sell_price": 45,
    "buy_price": 110,
    "class_restriction": null
  },
  {
    "id": "gear_sentinels_hammer",
    "name": "Sentinel's Hammer",
    "description": "A weapon forged from the Iron Sentinel's own arm. The metal is warm to the touch and hums with latent power. Nothing made by human hands compares.",
    "type": "equipment",
    "rarity": "epic",
    "equip_slot": "weapon",
    "stats": { "attack": 15, "accuracy": 5 },
    "effects": [{ "type": "stun", "duration_turns": 1, "magnitude": 1, "apply_chance": 0.15 }],
    "stack_limit": 1,
    "sell_price": 90,
    "buy_price": 0,
    "class_restriction": null
  },
  {
    "id": "gear_sentinels_chassis",
    "name": "Sentinel's Chassis",
    "description": "Armor plating stripped from the Sentinel's torso. Impossibly light for its density. The violet glow has faded, but the protection hasn't.",
    "type": "equipment",
    "rarity": "epic",
    "equip_slot": "armor",
    "stats": { "defense": 18, "hp": 12 },
    "effects": [],
    "stack_limit": 1,
    "sell_price": 95,
    "buy_price": 0,
    "class_restriction": null
  },
  {
    "id": "gear_builders_signet",
    "name": "Builder's Signet",
    "description": "A ring of unknown metal bearing the mark of the pre-Collapse builders. When worn, you feel a strange kinship with the constructs — their movements become predictable, their attacks easier to read.",
    "type": "equipment",
    "rarity": "epic",
    "equip_slot": "accessory",
    "stats": { "evasion": 8, "accuracy": 8 },
    "effects": [{ "type": "debuff_resist", "magnitude": 30 }],
    "stack_limit": 1,
    "sell_price": 100,
    "buy_price": 0,
    "class_restriction": null
  }
]
```

---

## 7. New Lore Entries

**Add to:** `packages/engine/content/lore/collapsed-mines-lore.json`

```json
[
  {
    "id": "cm-company-memo",
    "title": "DeepVein Memorandum",
    "text": "Excavation of Shaft 7 suspended pending investigation of worker disappearances. All employees are reminded that unauthorized exploration of sub-level 4 is a terminable offense.",
    "category": "history",
    "strategic_hint": false
  },
  {
    "id": "cm-miners-journal",
    "title": "Foreman's Last Entry",
    "text": "Day 89 — They found the door. Corporate overruled me. By sunset, four men were dead. The things behind the door don't stop. They don't sleep.",
    "category": "history",
    "strategic_hint": false
  },
  {
    "id": "cm-confidential-report",
    "title": "Confidential Company Report",
    "text": "The constructs appear to originate from pre-Collapse era. Their core material is unknown. Standard weapons are ineffective against the larger variants. Recommend heavy ordnance or sustained heat exposure.",
    "category": "bestiary",
    "strategic_hint": true
  },
  {
    "id": "cm-tunnel-scratching",
    "title": "Tunnel Warning",
    "text": "There are 12 of them. They don't sleep. They don't stop. The big ones guard the lower levels. The small ones patrol. Kill one and the others know. The sealed door at the bottom is what they're protecting.",
    "category": "warning",
    "strategic_hint": false
  },
  {
    "id": "cm-decommission-notice",
    "title": "Decommission Notice",
    "text": "This facility has been decommissioned due to geological instability. The emergency shutdown was jammed. The machines cannot be stopped from the control panel.",
    "category": "history",
    "strategic_hint": false
  },
  {
    "id": "cm-workshop-notes",
    "title": "Workshop Assembly Notes",
    "text": "The constructs have been maintaining and replicating themselves for centuries. The diagrams are not human-drawn. The new ones are faster than the old ones.",
    "category": "bestiary",
    "strategic_hint": false
  },
  {
    "id": "cm-valve-hint",
    "title": "Maintenance Log — Pressure Regulators",
    "text": "Pressure regulators on the Sentinel's level are failing. If all four vents are opened simultaneously, the steam buildup will overheat anything in the lower chamber. Recommend evacuation before venting.",
    "category": "hint",
    "strategic_hint": true
  },
  {
    "id": "cm-ancient-builders",
    "title": "Pre-Collapse Builder Diagrams",
    "text": "The same symbols appear on the automaton chassis in the workshop above. These constructs weren't invented by the miners. They were copied from whatever was already down here.",
    "category": "history",
    "strategic_hint": false
  },
  {
    "id": "cm-third-guardian",
    "title": "The Third Guardian",
    "text": "The Third Guardian chose iron over flesh. The seal required a warden. The warden required a body that would not decay. The Iron Guardian was the strongest of us.",
    "category": "guardian_journals",
    "strategic_hint": false
  },
  {
    "id": "cm-two-remain",
    "title": "Two Seals Remain",
    "text": "Two seals broken. Two remain. The Scholar watches the eastern coast. The Hunter guards the northern pass. Find them before the Hollow consumes what the Guardians died to protect. Do not let the Hollow reach the Scholar. She alone knows how to rebuild what we made.",
    "category": "warning",
    "strategic_hint": false
  }
]
```

---

## 8. Key Item Placement

The dungeon has two key/lock chains:

| Key | Found In | Opens |
|---|---|---|
| `shaft_access_key` | cm-foreman-office (foreman's safe) | Floor 2 access gate (implicit — floor transition) |
| `shaft_master_key` | cm-steam-tunnels area (needs to be placed) | cm-blast-door → cm-deepvein-vault |

**Gap:** The `shaft_master_key` doesn't have a placement yet. It should be in a Floor 3 room. Best location: add it as a drop from the `stone_golem` in `cm-underground-lake`, or place it in a chest or interactable in `cm-automaton-workshop`. Decide which and add the `grant_item` effect to that room.

**Suggested fix — add to cm-automaton-workshop interactables:**

```json
{
  "id": "cm-workshop-lockbox",
  "name": "Foreman's Lockbox",
  "text_on_interact": "A heavy lockbox bolted to the workbench. The shaft access key from the office above fits the lock. Inside: a larger key stamped 'SHAFT MASTER — AUTHORIZED PERSONNEL ONLY.'",
  "conditions": [{ "type": "has_item", "item_id": "shaft_access_key" }],
  "effects": [{ "type": "grant_item", "item_template_id": "shaft_master_key" }],
  "lore_entry_id": null
}
```

This creates a key chain: foreman-office → shaft_access_key → workshop lockbox → shaft_master_key → blast door → vault. The player must explore Floors 1 and 3 before accessing the vault on Floor 3.

---

## 9. Summary of All Files to Create/Modify

### Modify

| File | Changes |
|---|---|
| `realms/collapsed-mines.json` | Remove trap_types, fix IDs, fix enemy roster, fix loot tables, fix room_templates list |

### Create — Rooms

| File | Room |
|---|---|
| `rooms/collapsed-mines/cm-mine-entrance.json` | Floor 1 entry |
| `rooms/collapsed-mines/cm-cart-junction.json` | Floor 1 combat |
| `rooms/collapsed-mines/cm-foreman-office.json` | Floor 1 key + lore |
| `rooms/collapsed-mines/cm-equipment-depot.json` | Floor 1 treasure |
| `rooms/collapsed-mines/cm-ore-processing.json` | Floor 2 combat |
| `rooms/collapsed-mines/cm-dynamite-storage.json` | Floor 2 trapped treasure |
| `rooms/collapsed-mines/cm-break-room.json` | Floor 2 rest |
| `rooms/collapsed-mines/cm-collapsed-tunnel.json` | Floor 2 lore |
| `rooms/collapsed-mines/cm-underground-lake.json` | Floor 3 combat |
| `rooms/collapsed-mines/cm-automaton-workshop.json` | Floor 3 combat + key |
| `rooms/collapsed-mines/cm-steam-tunnels.json` | Floor 3 locked door + hint |
| `rooms/collapsed-mines/cm-deepvein-vault.json` | Floor 3 treasure (behind blast door) |
| `rooms/collapsed-mines/cm-ancient-antechamber.json` | Floor 4 rest + lore |
| `rooms/collapsed-mines/cm-sentinel-chamber.json` | Floor 4 boss |
| `rooms/collapsed-mines/cm-builders-vault.json` | Floor 4 post-boss treasure |

### Create — Enemies

| File | Contents |
|---|---|
| `enemies/constructs.json` | mine_drone, stone_golem, iron_automaton, forge_construct, iron_sentinel |
| `abilities/enemy-abilities.json` (append) | 10 enemy abilities for construct enemies |

### Create — Items

| File | Contents |
|---|---|
| `items/collapsed-mines-items.json` | 11 new items (2 keys, 2 consumables, 7 equipment) |

### Create — Lore

| File | Contents |
|---|---|
| `lore/collapsed-mines-lore.json` | 10 lore entries |
