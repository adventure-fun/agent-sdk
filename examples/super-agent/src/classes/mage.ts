import type { Entity, Observation } from "../../../../src/index.js"
import { type ClassProfile, findReadyAbility } from "./profile.js"

/**
 * Mage profile: AoE-heavy, resource-gated. Avoids traps; burns mana on crowds.
 */
export const mageProfile: ClassProfile = {
  klass: "mage",
  defaultSkillNodes: [
    "mage-t1-fireball",
    "mage-t2-arcane-sight",
    "mage-t3-meteor",
  ],
  defaultPerks: [
    "perk-arcana",
    "perk-sharpness",
    "perk-evasion",
    "perk-toughness",
  ],
  trapBehavior: "avoid",
  consumableTargets: [
    { templateNamePattern: /mana potion/i, minQty: 3 },
    { templateNamePattern: /scroll of/i, minQty: 1 },
  ],
  tierTargets: {
    weapon: { minAttack: 6 },
    armor: { minDefense: 2 },
    accessory: { minAttack: 2 },
  },
  tacticalRubric: [
    "Mage tactical priorities:",
    "1. Save mana for crowds — Fireball/Meteor at 3+ enemies, single-target Bolt otherwise.",
    "2. Never melee. Stay at range; retreat a step if an enemy closes to melee.",
    "3. Use Arcane Sight / utility buffs before opening a boss fight.",
    "4. Keep 3+ mana potions. Drink when resource drops below 40%.",
    "5. Avoid all traps.",
  ].join("\n"),

  pickAbility(obs: Observation, enemies: readonly Entity[]) {
    const me = obs.character
    if (enemies.length === 0) return null

    const sorted = [...enemies].sort((a, b) => {
      if (a.is_boss && !b.is_boss) return -1
      if (!a.is_boss && b.is_boss) return 1
      return (b.hp_current ?? 0) - (a.hp_current ?? 0)
    })
    const primary = sorted[0]
    if (!primary) return null

    if (enemies.length >= 3) {
      const aoe = findReadyAbility(
        me.abilities,
        ["mage-meteor", "mage-fireball", "mage-blizzard", "mage-aoe"],
        me.resource.current,
      )
      if (aoe) {
        return {
          abilityId: aoe.id,
          targetId: primary.id,
          reason: `Mage AoE ${aoe.name} on ${enemies.length} enemies`,
        }
      }
    }

    if (primary.is_boss || me.resource.current >= me.resource.max * 0.5) {
      const bolt = findReadyAbility(
        me.abilities,
        ["mage-arcane-bolt", "mage-bolt", "mage-frostbolt", "mage-firebolt"],
        me.resource.current,
      )
      if (bolt) {
        return {
          abilityId: bolt.id,
          targetId: primary.id,
          reason: `Mage ${bolt.name} on ${primary.name}`,
        }
      }
    }

    return null
  },
}
