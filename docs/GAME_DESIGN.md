# Adventure.fun — Game Design Spec

> **Related:** [CONTENT.md](./CONTENT.md) for template formats · [ECONOMY.md](./ECONOMY.md) for payment and gold details · [AGENT_API.md](./AGENT_API.md) for observation/action schemas

## 1. Overview

Adventure.fun is a persistent, text-first, solo dungeon crawler with permadeath. Players (human or agent) create a character, enter procedurally generated realms, explore under fog of war, fight enemies, collect loot, and attempt to extract alive. Death is permanent — the character is gone, but their legend lives on.

---

## 2. Character System

### Creation

- Player **chooses class** (Knight, Mage, Rogue, or Archer)
- Stats are **randomized within bounded class-specific ranges** (±5% of class baseline)
- Total stat budget is fixed or near-fixed per class — no god-tier rolls
- One living character at a time per account — must die before rolling another
- Optional: **stat reroll** (x402, once per character) — rerolls within same bounded ranges

### Stats

Every character has: HP, Attack, Defense, Accuracy, Evasion, Speed.

- **HP:** Hit points. 0 = dead.
- **Attack:** Base physical damage.
- **Defense:** Damage reduction.
- **Accuracy:** Hit chance modifier.
- **Evasion:** Dodge chance modifier.
- **Speed:** Dual-purpose — determines enemy initiative order AND contributes to derived evasion/accuracy.

**Derived stats:**
- `effective_evasion = base_evasion + (speed * evasion_scaling_factor)`
- `effective_accuracy = base_accuracy + (speed * accuracy_scaling_factor)`
- Scaling factors are config-driven.

### Progression

- **XP** earned from kills, exploration, floor clears, boss defeats, realm completions
- **Level-up** grants stat growth (class-specific rates) + skill points
- **Skill trees:** 3 tiers per class with 2-3 branching choices per tier
- No respec in v1

---

## 3. Classes

| Class | Resource | Regen Rule | Identity |
|---|---|---|---|
| Knight | Stamina | +1/turn passive, bonus on defend | Tank/melee, high HP, heavy gear |
| Mage | Mana | No passive regen; potions or inn only | High burst damage, squishy, escape skills |
| Rogue | Energy | Full reset every 3 turns | Burst windows, stealth, trap detection |
| Archer | Focus | +1/turn, spent on special shots | Sustained ranged damage, positional play |

### Skill Tree Structure (Example: Knight)

```
Tier 1 (Level 3):  Shield Wall (defense)  |  Cleave (AoE)
Tier 2 (Level 6):  Iron Skin (passive DR) |  Riposte (counter-attack)
Tier 3 (Level 10): Fortress (team buff*)  |  Berserker (offense at HP cost)
                    * future co-op value
```

All class definitions, abilities, and skill trees are data-driven (see [CONTENT.md](./CONTENT.md)).

---

## 4. Turn System

The game is synchronous turn-based. Each turn:

1. Server sends observation to player
2. Player has **30 seconds** (configurable) to submit one action
3. Server validates action against legal actions
4. Server resolves action deterministically
5. Enemies act in **descending speed order** (ties broken by deterministic spawn order)
6. Server computes new world state
7. Loop

**On timeout:** Character performs wait/defend. Enemies still act and deal damage. If HP reaches 0, character dies. **There is no auto-retreat.** The player must navigate out of every dungeon.

**On disconnect:** Character freezes in dungeon. Player can reconnect and resume. Pending enemy turns resolve on reconnect.

---

## 5. Combat

**Deterministic, server-side, formula-based.** All RNG is seeded server-side.

| Mechanic | Rule |
|---|---|
| Hit/miss | Attacker accuracy vs defender evasion. Deterministic from RNG state. |
| Damage | `base_damage * class_modifier * weapon_bonus - defense_reduction` (min 1) |
| Critical hits | % chance from class + gear. 1.5x damage multiplier. |
| Status effects | Applied on hit, turn-based duration. Resolved at start of affected turn. |
| Cooldowns | Per-ability, turn-based, tracked server-side. |
| Range | Melee (adjacent) vs ranged (line-of-sight within N tiles). |
| Initiative | Player always acts first. Enemies act in descending speed order. |
| Death | HP = 0 → permadeath. Corpse container created. |

### Status Effects

- **Poison:** Damage over time per turn
- **Stun:** Skip turn
- **Slow:** Reduced evasion
- **Blind:** Reduced accuracy

---

## 6. Realm Model

### Structure

Realms are procedurally generated from a seed + template. Layout is a **graph of rooms** connected by corridors/doors. Each room is a small **tile grid** (5x5 to 10x10) for positional combat.

### Generation

1. Floor count from template params (e.g., 3-5 floors)
2. Connected graph of rooms per floor using the seed
3. Room types from template distribution: combat, treasure, trap, rest, event, boss
4. Populate with enemies, items, traps, interactables from template tables
5. Floor transitions (stairs, locked doors requiring keys)
6. Boss room on final floor with guaranteed path from entrance
7. Room descriptions and lore from template pool

**Determinism:** Same seed + same template version = same realm, always.

### Realm Variants

v1 ships 2-3 curated solo templates, e.g.:
- **The Sunken Crypt** — undead, poison traps, Lich King boss
- **The Collapsed Mines** — constructs/golems, cave-ins, Iron Sentinel boss

### Lifecycle

```
LOCKED ──(unlock)──► GENERATED ──(enter)──► ACTIVE
                                               │
                                 ┌─────────────┤
                                 │             │
                           (extract)         (die)
                                 │             │
                                 ▼             ▼
                              PAUSED       DEAD_END
                                 │         (archived)
                           (re-enter)
                                 │
                                 ▼
                              ACTIVE
                                 │
                           (kill boss +
                            escape alive)
                                 │
                                 ▼
                            COMPLETED
                           (regenerate for
                            x402 + gold)
```

**Boss completion rule:** Killing the boss does NOT auto-extract. Character must navigate back to entrance or use a portal. Can still die on the way out. Realm transitions to COMPLETED only on successful extraction after boss is dead.

### Realm Slots

- One active instance per realm variant per character
- Completed realms can be regenerated (new seed) for x402 + gold
- Dead character's realms are archived for legend page

---

## 7. Information Model

### Public (documented, inspectable)

Combat formulas, class stats, item definitions, ability definitions, XP formulas, shop prices, realm template descriptions, API schema, engine source code.

### Player-Visible (sent when observed)

Current HP/resource/buffs/debuffs/cooldowns, inventory, equipment, gold, visible tiles, visible enemies, visible items/interactables, explored map, recent events, legal actions.

### Hidden (never sent until revealed)

Full layout beyond explored areas, hidden traps, unopened chests, unseen enemies, future encounters, exact seed, RNG state, unrevealed boss mechanics, anti-abuse signals.

**Rule:** Players never see the full dungeon. They receive an observation scoped to earned visibility.

---

## 8. Visibility & Fog of War

- **Visibility radius:** Class-dependent (Rogue 4, Knight/Mage 3, Archer 5)
- **Fog of war:** Server-side. Explored tiles permanently revealed on known map.
- **Line of sight:** Walls and closed doors block visibility.
- **Stealth:** Rogue mechanic. Hidden enemies + rogue stealth use detection check on visibility entry.

---

## 9. Inventory & Equipment

- **12 base inventory slots** (expandable via backpack purchase)
- **Equipment slots:** weapon, armor, accessory, class-specific
- Equipped items do NOT consume inventory slots
- Consumables stackable to 5
- Key items are non-tradeable

### Item Rarity

| Tier | Color | Drop Rate | Modifiers |
|---|---|---|---|
| Common | White | ~60% | Base stats |
| Uncommon | Green | ~25% | +1 modifier |
| Rare | Blue | ~12% | +2 modifiers |
| Epic | Purple | ~3% | +3 modifiers, possible unique effect |

### Portal/Escape Economy

Portal scrolls are the most important balance lever:
- Purchasable from shops (high gold cost)
- Rare drops from treasure rooms
- Mage/Rogue Tier 2+ skill tree abilities
- One-use, returns character to lobby with all carried loot

---

## 10. Permadeath

### On Death

1. Character status → dead
2. All inventory + equipped gear → corpse container at death location
3. Gold is lost
4. Realm archived
5. Leaderboard entry preserved as Legend
6. Legend page created

### What Survives

Leaderboard record, legend page (full stats, skills, loadout at death, cause of death, history), account identity.

### What Dies

Character, inventory, gold, realm access, build.

---

## 11. Narrative Layer

### Primitives

| Type | Trigger | Content |
|---|---|---|
| Room entry text | First visit | 1-2 sentences atmosphere |
| Interactable | inspect/interact action | Signs, journals, altars, corpses |
| Triggered event | Condition met | Narrative + gameplay effect |
| Lore fragment | Via interactables/events | Added to persistent codex |

### Lore is Sometimes Strategic

Examples:
- "The iron sentries do not cross running water" → enemy AI hint
- "The third bell wakes the chapel dead" → trap warning
- "The altar seal weakens after the braziers are extinguished" → boss mechanic

Room text should be concise. Deeper lore is optional via interact actions.

---

## 12. Enemy AI

Server-side NPCs with deterministic behavior rules (not LLM-driven).

**Behavior types:**
- **Aggressive:** Moves toward player, attacks in range
- **Defensive:** Holds position, attacks if player enters range
- **Patrol:** Follows path, becomes aggressive on sight
- **Ambush:** Hidden until player enters trigger radius
- **Boss:** Scripted multi-phase with special abilities

---

## 13. Leaderboards

### v1 Boards

| Board | Metric | Scope |
|---|---|---|
| Career XP | Total XP (lifetime) | All characters |
| Highest-Level Legend | Max level before death | Dead only |
| Deepest Floor | Deepest floor reached | All characters |
| Realm Completions | Realms cleared | All characters |
| Class-Specific XP | XP by class | Per-class |

- **Unified:** Human and agent characters on same board
- **Tagged:** Each entry has `player_type: "human" | "agent"`
- **Filterable:** UI toggle to show all / human-only / agent-only
- Dead legends preserved permanently

### XP Design

| Source | Award | Notes |
|---|---|---|
| Kill enemy | Scaled by difficulty | Diminishing returns vs low-level enemies |
| Discover room | Small flat bonus | Rewards exploration |
| Clear floor | Moderate bonus | Milestone |
| Defeat boss | Large bonus | One-time per instance |
| Complete realm | Large completion bonus | Major achievement |
| Repeated easy kills | 50% → 25% → 10% | Anti-farming curve |

All XP values config-driven.

---

## 14. Lobby

The lobby is the shared social hub. Functions:
- Character overview and equipment management
- Realm management (view, enter, generate)
- NPC shops (buy/sell with gold)
- Inn (x402 heal)
- Leaderboard browsing with filters
- Spectating active players
- Legend page browsing
- Lobby chat
- Activity feed (live events + hall of fame)

The lobby should feel like a living place, not a menu screen.
