import type { Entity, Observation } from "../../../../src/index.js"
import { type ClassProfile, findReadyAbility } from "./profile.js"

/**
 * Knight profile: tanky single-target with taunts and cleaves. Avoids traps rather than
 * disarming them — knights gain no class bonus from disarm.
 */
export const knightProfile: ClassProfile = {
  klass: "knight",
  defaultSkillNodes: [
    "knight-t1-cleave",
    "knight-t2-iron-skin",
    "knight-t3-crusader",
  ],
  defaultPerks: [
    "perk-toughness",
    "perk-sharpness",
    "perk-fortitude",
    "perk-swiftness",
  ],
  trapBehavior: "avoid",
  consumableTargets: [
    { templateNamePattern: /whetstone/i, minQty: 1 },
    { templateNamePattern: /shield/i, minQty: 1 },
  ],
  tierTargets: {
    weapon: { minAttack: 10 },
    armor: { minDefense: 8 },
    helm: { minDefense: 3 },
    hands: { minDefense: 2 },
  },
  tacticalRubric: [
    "Knight tactical priorities:",
    "1. Use Shield Bash on the closest single enemy to stun/interrupt.",
    "2. Use Cleave whenever 2+ enemies are adjacent.",
    "3. Use Taunt on bosses to force single-target aggro.",
    "4. Knights avoid traps — walk around them, do not disarm.",
    "5. Heavy armor means you can stand ground at HP < 40% when retreat is not legal.",
  ].join("\n"),

  pickAbility(obs: Observation, enemies: readonly Entity[]) {
    const me = obs.character
    if (enemies.length === 0) return null

    const sorted = [...enemies].sort((a, b) => {
      if (a.is_boss && !b.is_boss) return -1
      if (!a.is_boss && b.is_boss) return 1
      return (a.hp_current ?? Infinity) - (b.hp_current ?? Infinity)
    })
    const primary = sorted[0]
    if (!primary) return null

    if (enemies.length >= 2) {
      const cleave = findReadyAbility(
        me.abilities,
        ["knight-cleave", "knight-whirlwind", "knight-aoe"],
        me.resource.current,
      )
      if (cleave) {
        return {
          abilityId: cleave.id,
          targetId: primary.id,
          reason: `Knight Cleave against ${enemies.length} enemies`,
        }
      }
    }

    if (primary.is_boss) {
      const taunt = findReadyAbility(
        me.abilities,
        ["knight-taunt", "knight-challenge"],
        me.resource.current,
      )
      if (taunt) {
        return {
          abilityId: taunt.id,
          targetId: primary.id,
          reason: `Knight Taunt vs boss ${primary.name}`,
        }
      }
    }

    const bash = findReadyAbility(
      me.abilities,
      ["knight-shield-bash", "knight-bash", "knight-stun"],
      me.resource.current,
    )
    if (bash) {
      return {
        abilityId: bash.id,
        targetId: primary.id,
        reason: `Knight Shield Bash on ${primary.name}`,
      }
    }

    return null
  },
}
