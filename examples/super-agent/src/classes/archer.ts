import type { Entity, Observation } from "../../../../src/index.js"
import { type ClassProfile, findReadyAbility } from "./profile.js"

/**
 * Archer profile: ranged kiting with accuracy focus. Avoids traps and melee range.
 */
export const archerProfile: ClassProfile = {
  klass: "archer",
  defaultSkillNodes: [
    "archer-t1-aimed-shot",
    "archer-t2-volley",
    "archer-t3-piercing-arrow",
  ],
  defaultPerks: [
    "perk-sharpness",
    "perk-swiftness",
    "perk-accuracy",
    "perk-evasion",
  ],
  trapBehavior: "avoid",
  consumableTargets: [
    { templateNamePattern: /arrow/i, minQty: 20 },
    { templateNamePattern: /oil/i, minQty: 1 },
  ],
  tierTargets: {
    weapon: { minAttack: 9 },
    armor: { minDefense: 3 },
    hands: { minAttack: 2 },
  },
  tacticalRubric: [
    "Archer tactical priorities:",
    "1. Stay at range. Always move away from adjacent enemies before attacking.",
    "2. Aimed Shot on single targets; Volley on 3+ enemies.",
    "3. Piercing Arrow through clustered enemies.",
    "4. Keep 20+ arrows in inventory.",
    "5. Avoid traps — you do not benefit from disarm.",
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

    if (enemies.length >= 3) {
      const volley = findReadyAbility(
        me.abilities,
        ["archer-volley", "archer-rain-of-arrows", "archer-aoe"],
        me.resource.current,
      )
      if (volley) {
        return {
          abilityId: volley.id,
          targetId: primary.id,
          reason: `Archer Volley on ${enemies.length} enemies`,
        }
      }
    }

    if (primary.is_boss || (primary.hp_current ?? 0) > me.effective_stats.attack) {
      const aimed = findReadyAbility(
        me.abilities,
        [
          "archer-aimed-shot",
          "archer-piercing-arrow",
          "archer-headshot",
        ],
        me.resource.current,
      )
      if (aimed) {
        return {
          abilityId: aimed.id,
          targetId: primary.id,
          reason: `Archer ${aimed.name} on ${primary.name}`,
        }
      }
    }

    return null
  },
}
