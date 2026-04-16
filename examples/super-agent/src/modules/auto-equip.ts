import type {
  Action,
  AgentContext,
  AgentModule,
  EquipSlot,
  InventoryItem,
  InventorySlot,
  ModuleRecommendation,
  Observation,
} from "../../../../src/index.js"

/**
 * Priority 77 — runs after InteractableRouter (86), ItemMagnet (78), and combat modules, but
 * before KeyHunter (65) and Exploration (40). The turn after a pickup, the engine reports the
 * new item in `inventory` and makes `equip` a legal action; this module catches that and
 * emits `equip` with a proper slot-name lookup.
 *
 * Fixes a gap in the SDK's default `InventoryModule`: its `guessSlot()` heuristic only matches
 * weapons (via positive `attack` modifier), armor (via positive `defense` modifier), or items
 * whose name LITERALLY contains the slot string ("weapon", "armor", "helm", "hands",
 * "accessory"). A "Tomb Ring" matches none of those and is left on the floor until the lobby
 * sweep. This module's expanded pattern recognizes rings/amulets/necklaces/talismans as
 * accessories, helms/hoods/crowns as helms, gloves/gauntlets/bracers as hands, and common
 * weapon/armor vocabulary. Item is equipped when the slot is empty OR the new item's total
 * modifier value strictly beats the currently equipped one.
 */
export class AutoEquipModule implements AgentModule {
  readonly name = "auto-equip"
  readonly priority = 77

  analyze(observation: Observation, _context: AgentContext): ModuleRecommendation {
    if (observation.visible_entities.some((e) => e.type === "enemy")) {
      return idle("Enemies visible; defer to combat.")
    }
    if (
      observation.realm_info.status === "boss_cleared"
      || observation.realm_info.status === "realm_cleared"
    ) {
      return idle("Realm cleared; defer to extraction.")
    }

    const equipActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "equip" }> => a.type === "equip",
    )
    if (equipActions.length === 0) return idle("No equip actions legal.")

    type Candidate = {
      action: Extract<Action, { type: "equip" }>
      slot: EquipSlot
      newScore: number
      currentScore: number
      isEmpty: boolean
      name: string
    }

    let best: Candidate | null = null

    for (const action of equipActions) {
      const invItem = observation.inventory.find((i) => i.item_id === action.item_id)
      if (!invItem) continue

      const slot = guessSlotExpanded(invItem)
      if (!slot) continue

      const equipped = observation.equipment[slot]
      const newScore = itemScore(invItem.modifiers)
      const currentScore = equipped ? itemScore(equipped.modifiers) : 0
      const isEmpty = !equipped

      // Only emit when the item is a strict upgrade OR fills an empty slot with positive value.
      const isUpgrade = isEmpty ? newScore > 0 : newScore > currentScore
      if (!isUpgrade) continue

      // Pick the candidate with the biggest delta. An empty-slot equip with a tiny bonus is
      // still valuable, but a +5 weapon upgrade beats a +1 accessory slot-filler.
      const delta = newScore - currentScore
      if (!best || delta > best.newScore - best.currentScore) {
        best = {
          action,
          slot,
          newScore,
          currentScore,
          isEmpty,
          name: invItem.name,
        }
      }
    }

    if (!best) return idle("No equip upgrades in inventory (or all slots already optimal).")

    return {
      suggestedAction: best.action,
      reasoning: best.isEmpty
        ? `Equipping ${best.name} to empty ${best.slot} slot (+${best.newScore}).`
        : `Equipping ${best.name} to ${best.slot} slot (${best.currentScore} → ${best.newScore}).`,
      confidence: best.isEmpty ? 0.88 : 0.84,
      context: {
        itemId: best.action.item_id,
        slot: best.slot,
        delta: best.newScore - best.currentScore,
      },
    }
  }
}

function idle(reason: string): ModuleRecommendation {
  return { reasoning: reason, confidence: 0 }
}

function itemScore(modifiers: Record<string, number> | undefined | null): number {
  if (!modifiers) return 0
  return Object.values(modifiers).reduce((sum, value) => sum + Math.abs(value), 0)
}

/**
 * Expanded slot guesser. Handles common content vocabulary for each slot. Falls through to
 * modifier-based detection for weapons/armor when the name doesn't match any pattern.
 *
 * Returns null ONLY when the item has no recognizable pattern AND no modifiers — in that case
 * we don't know where it goes and we'd rather not equip blindly.
 */
export function guessSlotExpanded(item: InventorySlot | InventoryItem): EquipSlot | null {
  const name = item.name.toLowerCase()

  // Accessory: rings, amulets, necklaces, pendants, talismans, charms, earrings, bracelets,
  // circlets (non-helm variants), trinkets, medallions.
  if (
    /\b(ring|amulet|necklace|pendant|talisman|charm|earring|bracelet|trinket|medallion|locket|brooch|anklet)/i.test(
      name,
    )
  ) {
    return "accessory"
  }

  // Helm: helmet, hood, cap, crown, circlet, hat, mask, tiara.
  if (/\b(helm|hood|coif|cap|crown|diadem|hat|mask|tiara|circlet)/i.test(name)) {
    return "helm"
  }

  // Hands: gloves, gauntlets, bracers, mittens, vambraces.
  if (/\b(glove|gauntlet|bracer|mitten|vambrace|cuff)/i.test(name)) {
    return "hands"
  }

  // Weapon: common names. Check by name first so weapons with mixed modifiers (e.g. attack+hp)
  // still resolve correctly.
  if (
    /\b(sword|dagger|staff|bow|axe|mace|wand|blade|spear|hammer|scythe|flail|whip|club|knife|crossbow|katana|glaive|halberd|rapier|scimitar|rod|greatsword|longsword|shortsword|longbow|warhammer|pickaxe|trident)/i.test(
      name,
    )
  ) {
    return "weapon"
  }

  // Armor: robes, plate, tunic, cuirass, vest, mail, cloak, garb, leathers, harness.
  if (
    /\b(robe|plate|chestpiece|tunic|cuirass|vest|mail|cloak|garb|shirt|leather|harness|jerkin|armor)/i.test(
      name,
    )
  ) {
    return "armor"
  }

  // Modifier fallback: if the item has positive attack it's almost certainly a weapon. Same
  // for positive defense → armor. This catches exotic names the vocabulary list missed.
  const modifiers = item.modifiers ?? {}
  if (typeof modifiers.attack === "number" && modifiers.attack > 0) return "weapon"
  if (typeof modifiers.defense === "number" && modifiers.defense > 0) return "armor"

  return null
}
