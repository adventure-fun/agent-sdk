# Adventure.fun — Equipment System & Item Catalog

> **Priority: HIGH** — Current equipment slots are ambiguous and items lack tier classification. This document defines the complete equipment system, shop display requirements, and the full item catalog organized by dungeon tier.

---

## 1. Equipment Slot Rework

### Old System (Remove)

```
weapon | armor | accessory | class_slot
```

Problems: "armor" contains both chestplates and helmets competing for one slot. "accessory" contains rings, gloves, and amulets competing for one slot. "class_slot" has no defined purpose.

### New System

```
weapon | armor | helm | hands | accessory
```

| Slot | What Equips Here | Examples |
|---|---|---|
| **Weapon** | Swords, daggers, staves, bows | Iron Sword, Venom Blade, Oak Staff |
| **Armor** | Chest protection, shields | Leather Armor, Crypt Shield, Warden's Plate |
| **Helm** | Head protection | Leather Cap, Miner's Helm |
| **Hands** | Gloves, gauntlets | Chain Gloves, Warden's Gauntlets |
| **Accessory** | Rings, amulets, pendants | Iron Ring, Tomb Ring, Blight Ward, Hollow Ward |

Players can wear one item in each slot simultaneously — full loadout is 5 equipped items.

### Schema Change

**CONTENT.md — ItemTemplate:**
```typescript
equip_slot?: "weapon" | "armor" | "helm" | "hands" | "accessory"
```

**Observation packet — equipment field:**
```typescript
equipment: {
  weapon: Item | null
  armor: Item | null
  helm: Item | null
  hands: Item | null
  accessory: Item | null
}
```

**Database — inventory_items.slot column:**
```sql
ALTER TABLE inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_slot_check;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_slot_check
  CHECK (slot IS NULL OR slot IN ('weapon', 'armor', 'helm', 'hands', 'accessory'));
```

### Migration — Existing Item Reassignment

| Item | Old Slot | New Slot |
|---|---|---|
| All weapons | weapon | weapon (no change) |
| Leather Armor, Leather Vest | armor | armor (no change) |
| Wooden Shield, Crypt Shield | armor | armor (no change) |
| Warden's Plate, Sentinel's Chassis | armor | armor (no change) |
| Leather Cap | armor | **helm** |
| Miner's Helm | armor | **helm** |
| Chain Gloves | accessory | **hands** |
| Warden's Gauntlets | accessory | **hands** |
| Pressure Gauntlets | accessory | **hands** |
| Iron Ring, Tomb Ring | accessory | accessory (no change) |
| Blight Ward, Hollow Ward, Builder's Signet | accessory | accessory (no change) |

### Remove Class Slot

`class_slot` is removed entirely. Class-specific equipment uses `class_restriction` on items in standard slots (e.g., Wooden Shield has `class_restriction: "knight"` in the armor slot).

---

## 2. Equipment UI — Player View

```
Equipment & Inventory
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│  Weapon  │  Armor   │   Helm   │  Hands   │ Accessory│
│          │          │          │          │          │
│  Rusty   │ Leather  │ Leather  │  Chain   │  Iron    │
│  Dagger  │  Armor   │   Cap    │  Gloves  │  Ring    │
│ +3 ATK   │ +4 DEF   │ +2 DEF   │ +3 DEF   │ +10 HP   │
│ +2 SPD   │ +2 EVA   │          │ +1 ATK   │ +1 DEF   │
│ [Unequip]│ [Unequip]│ [Unequip]│ [Unequip]│ [Unequip]│
└──────────┴──────────┴──────────┴──────────┴──────────┘

Bag (4/12 slots used)
┌──────────┬──────────┬──────────┬──────────┐
│ Health   │ Health   │ Antidote │ Portal   │
│ Potion   │ Potion   │  x1      │ Scroll   │
│  x3      │  x2      │          │  x1      │
└──────────┴──────────┴──────────┴──────────┘
```

---

## 3. Shop Display Changes

The shop must display the **equipment slot type** prominently on each item so players immediately know which slot it fills.

### Shop Item Card Layout

```
┌─────────────────────────────────────────┐
│  [WEAPON]                    30g        │
│  Iron Sword                  common     │
│                                         │
│  A sturdy iron sword, well-balanced     │
│  and reliable.                          │
│                                         │
│  ATTACK +6 · ACCURACY +5               │
│                                         │
│  [Qty: 1]              [Buy]           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  [HELM]                      15g        │
│  Leather Cap                 common     │
│                                         │
│  A simple cap of boiled leather.        │
│                                         │
│  DEFENSE +2                             │
│                                         │
│  [Qty: 1]              [Buy]           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  [HANDS]                     30g        │
│  Chain Gloves                uncommon   │
│  ★ Recommended upgrade                  │
│                                         │
│  Interlocking iron rings woven into     │
│  leather gloves.                        │
│                                         │
│  DEFENSE +3 · ATTACK +1                │
│                                         │
│  [Qty: 1]              [Buy]           │
└─────────────────────────────────────────┘
```

### Shop Filter Tabs

```
[All] [Consumables] [Weapons] [Armor] [Helms] [Hands] [Accessories]
```

Players should be able to filter by slot type. The current `[All] [Consumables] [Equipment]` grouping is too coarse — when a player wants to upgrade their helm, they shouldn't have to scroll past 20 weapons and armor pieces.

### Class Restriction Display

Items with `class_restriction` should show a badge:

```
│  [ARMOR]  🛡️ Knight only     22g       │
│  Wooden Shield               common     │
```

Items the current character can't equip should be visually dimmed with "Cannot equip" replacing the Buy button, but still visible (so players know what exists for other classes).

---

## 4. Item Tier System

Every item has a `dungeon_tier` that determines where it can be found as loot. Items can only drop in dungeons at or above their tier. The shop stocks items based on which dungeons the player has unlocked.

### Tier Definitions

| Tier | Dungeons | Item Quality | Drop Context |
|---|---|---|---|
| **Tier 0** | The Cellar (Tutorial) | Starter weapons, basic consumables | Tutorial chests only, never random drops |
| **Tier 1** | Collapsed Passage, Blighted Hollow | Common equipment, standard consumables | Random loot tables, shop stock |
| **Tier 2** | Sunken Crypt | Uncommon + Rare equipment, better consumables | Deeper floor chests, boss drops |
| **Tier 3** | Collapsed Mines | Rare + Epic equipment, advanced consumables | Boss drops, vault chests |

### How Tiers Affect the Shop

The shop's available inventory expands as the player progresses:

- **New character (no dungeons completed):** Consumables only + Tier 1 common equipment
- **Any Tier 1 dungeon completed:** Full Tier 1 equipment stock
- **Tier 2 dungeon completed:** Tier 1 + Tier 2 uncommon items appear in shop
- **Tier 3 dungeon completed:** Tier 1 + Tier 2 + Tier 3 rare items appear in rotating premium stock

**Epic items are NEVER sold in the shop.** They only come from boss vaults and the P2P marketplace.

### Schema Addition

Add `dungeon_tier` to `ItemTemplate`:

```typescript
interface ItemTemplate {
  // ... existing fields ...
  dungeon_tier: number    // 0 = tutorial, 1 = tier 1, 2 = tier 2, 3 = tier 3
}
```

---

## 5. Complete Item Catalog

### 5a. Tier 0 — Tutorial Starter Gear

These items are ONLY granted from tutorial chests. `buy_price: 0`, never sold in shops.

**Weapons:**

| ID | Name | Slot | Rarity | Stats | Class | Sell |
|---|---|---|---|---|---|---|
| `weapon_iron_sword` | Iron Sword | weapon | common | ATK +5 | knight | 8g |
| `weapon_rusty_dagger` | Rusty Dagger | weapon | common | ATK +3, SPD +2 | rogue | 6g |
| `weapon_oak_staff` | Oak Staff | weapon | common | ATK +4 | mage | 7g |
| `weapon_short_bow` | Short Bow | weapon | common | ATK +4 | archer | 7g |

---

### 5b. Tier 1 — Collapsed Passage & Blighted Hollow

Found in Tier 1 dungeon loot tables and available in the shop.

**Weapons:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_iron_sword` | Iron Sword | weapon | common | ATK +6, ACC +5 | — | any | 30g | 12g |
| `gear_oak_staff_plus` | Runed Oak Staff | weapon | common | ATK +4, ACC +6, DEF +1 | — | mage | 28g | 11g |
| `gear_hunters_bow` | Hunter's Bow | weapon | common | ATK +5, ACC +8, SPD +1 | — | archer | 32g | 13g |
| `gear_combat_dagger` | Combat Dagger | weapon | common | ATK +5, SPD +3 | — | rogue | 28g | 11g |
| `gear_venom_blade` | Venom Blade | weapon | uncommon | ATK +6 | 25% poison (3 dmg, 3 turns) | any | 55g | 22g |

**Armor:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_leather_armor` | Leather Armor | armor | common | DEF +4, EVA +2 | — | any | 25g | 10g |
| `gear_leather_vest` | Leather Vest | armor | common | DEF +4 | — | any | 25g | 10g |
| `gear_wooden_shield` | Wooden Shield | armor | common | DEF +6, EVA -2 | — | knight | 22g | 9g |

**Helms:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_leather_cap` | Leather Cap | helm | common | DEF +2 | — | any | 15g | 6g |

**Hands:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_chain_gloves` | Chain Gloves | hands | uncommon | DEF +3, ATK +1 | — | any | 30g | 12g |
| `gear_leather_gloves` | Leather Gloves | hands | common | DEF +1, EVA +1 | — | any | 12g | 5g |

**Accessories:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_iron_ring` | Iron Ring | accessory | common | HP +10, DEF +1 | — | any | 20g | 8g |
| `gear_blight_ward` | Blight Ward | accessory | uncommon | DEF +3 | 50% poison resist | any | 45g | 18g |

**Loot Items (sell only):**

| ID | Name | Rarity | Sell | Notes |
|---|---|---|---|---|
| `loot_crude_gem` | Crude Gem | common | 5g | Common loot drop |
| `loot_old_coin` | Old Coin | common | 3g | Found in passage chests |
| `loot_violet_shard` | Violet Shard | uncommon | 15g | Hollow corruption fragment |
| `loot_blighted_fang` | Blighted Fang | uncommon | 12g | Wolf drop |

---

### 5c. Tier 2 — Sunken Crypt

Found in Tier 2 dungeon loot tables. Uncommon items appear in shop after Tier 2 completion.

**Weapons:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_crypt_blade` | Crypt Blade | weapon | uncommon | ATK +8, ACC +4 | — | any | 60g | 24g |
| `gear_bone_wand` | Bone Wand | weapon | uncommon | ATK +7, ACC +8 | — | mage | 65g | 26g |
| `gear_shadow_knife` | Shadow Knife | weapon | uncommon | ATK +7, SPD +4, EVA +2 | — | rogue | 58g | 23g |
| `gear_longbow` | Crypt Longbow | weapon | uncommon | ATK +7, ACC +10 | — | archer | 62g | 25g |
| `gear_wardens_blade` | Warden's Blade | weapon | epic | ATK +12, SPD +3 | — | any | 0 | 75g |

**Armor:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_chainmail` | Chainmail | armor | uncommon | DEF +6, EVA +1 | — | any | 50g | 20g |
| `gear_crypt_shield` | Crypt Shield | armor | rare | DEF +8, HP +5 | — | any | 90g | 35g |
| `gear_wardens_plate` | Warden's Plate | armor | epic | DEF +15, HP +10 | — | any | 0 | 80g |

**Helms:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_iron_helm` | Iron Helm | helm | uncommon | DEF +4, HP +5 | — | any | 35g | 14g |
| `gear_crypt_crown` | Crypt Crown | helm | rare | DEF +5, ACC +5, HP +5 | — | any | 85g | 34g |

**Hands:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_plated_gloves` | Plated Gloves | hands | uncommon | DEF +4, ATK +2 | — | any | 40g | 16g |
| `gear_warden_gauntlets` | Warden's Gauntlets | hands | rare | ATK +5, DEF +3 | — | any | 100g | 40g |

**Accessories:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_tomb_ring` | Tomb Ring | accessory | uncommon | ACC +3, EVA +2 | — | any | 50g | 20g |
| `gear_guardian_amulet` | Guardian Amulet | accessory | rare | DEF +4, HP +8 | 20% debuff resist | any | 95g | 38g |
| `gear_hollow_ward` | Hollow Ward | accessory | epic | DEF +5, EVA +5, ACC +5 | 40% debuff resist | any | 0 | 85g |

**Loot Items (sell only):**

| ID | Name | Rarity | Sell | Notes |
|---|---|---|---|---|
| `gear_bone_fragment` | Bone Fragment | common | 8g | Skeleton drop |
| `loot_crypt_relic` | Crypt Relic | uncommon | 20g | Tomb chest drop |
| `loot_guardian_sigil` | Guardian Sigil | rare | 40g | Warden drop |
| `loot_violet_crystal` | Violet Crystal | rare | 35g | Seal-related, lore value |

---

### 5d. Tier 3 — Collapsed Mines

Found in Tier 3 dungeon loot tables. Rare items appear in shop after Tier 3 completion.

**Weapons:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_steamforged_blade` | Steamforged Blade | weapon | rare | ATK +9, SPD +2 | — | any | 100g | 40g |
| `gear_pneumatic_crossbow` | Pneumatic Crossbow | weapon | rare | ATK +10, ACC +8 | — | archer | 110g | 44g |
| `gear_voltaic_staff` | Voltaic Staff | weapon | rare | ATK +9, ACC +6 | 20% stun (1 turn) | mage | 105g | 42g |
| `gear_piston_daggers` | Piston Daggers | weapon | rare | ATK +8, SPD +5, ACC +3 | — | rogue | 95g | 38g |
| `gear_sentinels_hammer` | Sentinel's Hammer | weapon | epic | ATK +15, ACC +5 | 15% stun (1 turn) | any | 0 | 90g |

**Armor:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_steamplate` | Steamplate Armor | armor | rare | DEF +10, HP +8 | — | any | 120g | 48g |
| `gear_sentinels_chassis` | Sentinel's Chassis | armor | epic | DEF +18, HP +12 | — | any | 0 | 95g |

**Helms:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_miners_helm` | Miner's Helm | helm | common | DEF +3, HP +3 | — | any | 20g | 8g |
| `gear_forged_visor` | Forged Visor | helm | rare | DEF +6, ACC +4, HP +5 | — | any | 90g | 36g |
| `gear_sentinels_crest` | Sentinel's Crest | helm | epic | DEF +8, HP +10, EVA +3 | — | any | 0 | 85g |

**Hands:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_pressure_gauntlets` | Pressure Gauntlets | hands | rare | ATK +6, DEF +4 | — | any | 110g | 45g |
| `gear_sentinels_grips` | Sentinel's Grips | hands | epic | ATK +8, DEF +6, SPD +2 | — | any | 0 | 90g |

**Accessories:**

| ID | Name | Slot | Rarity | Stats | Effects | Class | Buy | Sell |
|---|---|---|---|---|---|---|---|---|
| `gear_construct_core_ring` | Core Fragment Ring | accessory | rare | ATK +4, DEF +4, HP +5 | — | any | 95g | 38g |
| `gear_builders_signet` | Builder's Signet | accessory | epic | EVA +8, ACC +8 | 30% debuff resist | any | 0 | 100g |

**Loot Items (sell only):**

| ID | Name | Rarity | Sell | Notes |
|---|---|---|---|---|
| `gear_construct_core` | Construct Core | rare | 30g | Automaton drop |
| `loot_ancient_gear` | Ancient Gear | uncommon | 18g | Workshop drop |
| `loot_steam_crystal` | Steam Crystal | rare | 35g | Deep shaft drop |
| `loot_sentinel_fragment` | Sentinel Fragment | epic | 60g | Boss drop, extremely valuable |

---

## 6. Epic Item Summary — Boss Drops Only

These items can ONLY be obtained from boss vault chests. Never in shops, never in random loot tables, never from regular enemies. They are the primary motivation for pushing deeper and the most valuable items on the P2P marketplace.

### Sunken Crypt Boss (Hollow Warden)

| ID | Name | Slot | Stats | Sell | Special |
|---|---|---|---|---|---|
| `gear_wardens_blade` | Warden's Blade | weapon | ATK +12, SPD +3 | 75g | Violet edge glow |
| `gear_wardens_plate` | Warden's Plate | armor | DEF +15, HP +10 | 80g | Cracked but unmatched |
| `gear_hollow_ward` | Hollow Ward | accessory | DEF +5, EVA +5, ACC +5 | 85g | 40% debuff resist |

### Collapsed Mines Boss (Iron Sentinel)

| ID | Name | Slot | Stats | Sell | Special |
|---|---|---|---|---|---|
| `gear_sentinels_hammer` | Sentinel's Hammer | weapon | ATK +15, ACC +5 | 90g | 15% stun on hit |
| `gear_sentinels_chassis` | Sentinel's Chassis | armor | DEF +18, HP +12 | 95g | Lightest heavy armor |
| `gear_sentinels_crest` | Sentinel's Crest | helm | DEF +8, HP +10, EVA +3 | 85g | Boss helm drop |
| `gear_sentinels_grips` | Sentinel's Grips | hands | ATK +8, DEF +6, SPD +2 | 90g | Hydraulic grip |
| `gear_builders_signet` | Builder's Signet | accessory | EVA +8, ACC +8 | 100g | 30% debuff resist |

### Future Bosses (Placeholder — Design When Dungeons Are Built)

| Boss | Dungeon | Tier | Expected Drops |
|---|---|---|---|
| The Withered Ranger | The Withered Reach | Tier 2 | Nature-themed weapon, armor, accessory |
| The Hollow Throne | Final dungeon | Tier 4 | Best-in-slot for each slot type |

---

## 7. Item Stat Progression by Tier

This shows the general power curve. Each tier should feel like a meaningful upgrade over the previous.

### Weapons (Attack stat)

| Tier | Common | Uncommon | Rare | Epic |
|---|---|---|---|---|
| 0 (Tutorial) | 3-5 | — | — | — |
| 1 | 5-6 | 6-7 | — | — |
| 2 | — | 7-8 | 9-10 | 12 |
| 3 | — | — | 9-10 | 15 |

### Armor (Defense stat)

| Tier | Common | Uncommon | Rare | Epic |
|---|---|---|---|---|
| 0 (Tutorial) | — | — | — | — |
| 1 | 2-6 | — | — | — |
| 2 | — | 6 | 8 | 15 |
| 3 | — | — | 10 | 18 |

### Accessories (Primary stat)

| Tier | Common | Uncommon | Rare | Epic |
|---|---|---|---|---|
| 1 | 1-2 | 3 | — | — |
| 2 | — | 3-5 | 4-8 | 5+5+5 |
| 3 | — | — | 4-5 | 8+8 |

---

## 8. Consumable Catalog (All Tiers)

| ID | Name | Rarity | Tier | Effect | Buy | Sell | Stack |
|---|---|---|---|---|---|---|---|
| `health_potion` | Health Potion | common | 1 | Heal 25 HP | 12g | 5g | 5 |
| `mana_potion` | Mana Potion | common | 1 | Restore 15 resource | 15g | 6g | 5 |
| `antidote` | Antidote | common | 1 | Cure poison | 10g | 4g | 5 |
| `ammo_arrows_10` | Normal Arrows | common | 1 | Archer ammo (10) | 5g | 2g | 20 |
| `buff_potion` | Ironhide Tonic | uncommon | 2 | +5 DEF for 5 turns | 30g | 10g | 3 |
| `greater_health_potion` | Greater Health Potion | uncommon | 2 | Heal 50 HP | 50g | 12g | 3 |
| `elixir_of_focus` | Elixir of Focus | uncommon | 2 | +5 ACC for 5 turns | 35g | 14g | 3 |
| `smelling_salts` | Smelling Salts | uncommon | 2 | Cure stun + slow | 25g | 10g | 3 |
| `portal_scroll` | Portal Scroll | uncommon | 1 | Escape dungeon | 75g | 25g | 1 |
| `greater_mana_potion` | Greater Mana Potion | uncommon | 3 | Restore 30 resource | 45g | 18g | 3 |
| `berserker_draught` | Berserker Draught | rare | 3 | +8 ATK for 4 turns, -3 DEF | 70g | 28g | 2 |
| `ironflask` | Ironflask | rare | 3 | Heal 80 HP | 85g | 34g | 2 |

---

## 9. Shop Stock Rules

### Base Stock (Always Available)

All Tier 1 consumables + common Tier 1 equipment.

### Unlockable Stock

| Player Achievement | Items Unlocked in Shop |
|---|---|
| Complete any Tier 1 dungeon | All Tier 1 equipment |
| Complete Tier 2 dungeon | Tier 2 uncommon equipment + Tier 2 consumables |
| Complete Tier 3 dungeon | Tier 3 rare equipment + Tier 3 consumables |

### Rotating Premium Stock

3-5 items from the player's highest unlocked tier, refreshed every 24 hours. This keeps the shop interesting on repeat visits. Premium rotation can include higher-rarity items from lower tiers that aren't in the base stock.

### Never Sold in Shop

- Tier 0 starter weapons (tutorial only)
- Epic items (boss drops only)
- Key items
- Loot items (sell only, no buy)

### Shop Stock Schema Addition

Add to `ShopTemplate`:

```typescript
interface ShopTemplate {
  // ... existing fields ...
  tier_stock: {
    base: string[]              // item IDs always available
    tier_1_unlock: string[]     // available after any Tier 1 completion
    tier_2_unlock: string[]     // available after Tier 2 completion
    tier_3_unlock: string[]     // available after Tier 3 completion
  }
  rotating_pool: string[]       // candidates for premium rotation
  rotation_count: number        // how many rotating items are active
  rotation_interval_hours: number
}
```

---

## 10. Item Count Summary

| Category | Tier 0 | Tier 1 | Tier 2 | Tier 3 | Total |
|---|---|---|---|---|---|
| Weapons | 4 | 5 | 5 | 5 | 19 |
| Armor | 0 | 3 | 3 | 2 | 8 |
| Helms | 0 | 1 | 2 | 3 | 6 |
| Hands | 0 | 2 | 2 | 2 | 6 |
| Accessories | 0 | 2 | 3 | 2 | 7 |
| Consumables | 0 | 4 | 4 | 4 | 12 |
| Loot (sell only) | 0 | 4 | 4 | 4 | 12 |
| Key Items | 0 | 1 | 1 | 2 | 4 |
| **Total** | **4** | **22** | **24** | **24** | **74** |

74 total items across 4 tiers. This provides meaningful progression, upgrade decisions at every tier, and enough variety that players don't see the same loot repeatedly.

---

## 11. Implementation Checklist

- [ ] Update `equip_slot` enum in schemas: add `"helm"` and `"hands"`, remove `"class_specific"`
- [ ] Update Observation packet `equipment` field to 5 slots
- [ ] Update database constraint on `inventory_items.slot`
- [ ] Reassign `equip_slot` on all existing items per migration table in Section 1
- [ ] Add `dungeon_tier` field to all `ItemTemplate` definitions
- [ ] Update shop UI: add slot type badge on each item card
- [ ] Update shop UI: add filter tabs per slot type
- [ ] Update shop UI: dim items with class restrictions the current character can't use
- [ ] Update equipment UI: display 5 slots instead of 4
- [ ] Implement shop stock unlock logic based on dungeon completions
- [ ] Add all new items from Sections 5a-5d to item JSON files
- [ ] Verify all loot tables reference valid item IDs
- [ ] Remove duplicate/tutorial items from shop inventory
