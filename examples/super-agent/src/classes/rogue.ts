import type { Entity, Observation } from "../../../../src/index.js"
import { type ClassProfile, findReadyAbility } from "./profile.js"

/**
 * Rogue build defaults. Priorities reflect the typical "burst + disarm" playstyle:
 *   - Always pick disarm-trap first at tier 1 so we gain the XP/loot path traps provide.
 *   - Lean into evasion + speed perks to survive multi-enemy rooms.
 *   - Approach visible traps to disarm them (trap-behavior: "disarm").
 */
export const rogueProfile: ClassProfile = {
  klass: "rogue",
  defaultSkillNodes: [
    "rogue-t1-disarm-trap",
    "rogue-t2-envenom",
    "rogue-t3-death-mark",
  ],
  defaultPerks: [
    "perk-swiftness",
    "perk-sharpness",
    "perk-evasion",
    "perk-toughness",
  ],
  trapBehavior: "disarm",
  consumableTargets: [
    { templateNamePattern: /lockpick/i, minQty: 2 },
    { templateNamePattern: /smoke bomb|smokebomb/i, minQty: 1 },
    { templateNamePattern: /throwing knife/i, minQty: 4 },
    { templateNamePattern: /poison/i, minQty: 2 },
  ],
  tierTargets: {
    weapon: { minAttack: 8 },
    armor: { minDefense: 4 },
    hands: { minAttack: 2 },
  },
  tacticalRubric: [
    "Rogue tactical priorities:",
    "1. Open every fight with your highest single-target burst ability (Backstab / Shadow Strike / Death Mark) when READY and affordable.",
    "2. On 3+ adjacent enemies, use any AoE ability (Fan of Knives / Smoke Bomb) before basic attacks.",
    "3. Walk TOWARD visible traps and use `disarm_trap` — disarming is free XP and often drops loot. Never walk through traps.",
    "4. Keep 2+ healing potions and 1 portal scroll. Retreat at HP < 30%.",
    "5. Never basic-attack when a ready ability fits the situation.",
  ].join("\n"),

  pickAbility(obs: Observation, enemies: readonly Entity[]) {
    const me = obs.character
    if (enemies.length === 0) return null

    const sortedEnemies = [...enemies].sort((a, b) => {
      if (a.is_boss && !b.is_boss) return -1
      if (!a.is_boss && b.is_boss) return 1
      return (a.hp_current ?? Infinity) - (b.hp_current ?? Infinity)
    })
    const primaryTarget = sortedEnemies[0]
    if (!primaryTarget) return null

    // AoE on 3+ enemies.
    if (enemies.length >= 3) {
      const aoe = findReadyAbility(
        me.abilities,
        [
          "rogue-fan-of-knives",
          "rogue.fan-of-knives",
          "rogue-whirlwind",
          "rogue-cleave",
          "rogue-aoe",
        ],
        me.resource.current,
      )
      if (aoe) {
        return {
          abilityId: aoe.id,
          targetId: primaryTarget.id,
          reason: `Rogue AoE ${aoe.name} against ${enemies.length} enemies`,
        }
      }
    }

    // Boss or elite single-target: use biggest nuke available.
    if (primaryTarget.is_boss || (primaryTarget.hp_current ?? 0) > me.effective_stats.attack * 2) {
      const burst = findReadyAbility(
        me.abilities,
        [
          "rogue-shadow-strike",
          "rogue-death-mark",
          "rogue-backstab",
          "rogue-envenom",
          "rogue-assassinate",
        ],
        me.resource.current,
      )
      if (burst) {
        return {
          abilityId: burst.id,
          targetId: primaryTarget.id,
          reason: `Rogue burst ${burst.name} on ${primaryTarget.is_boss ? "boss" : "elite"} ${primaryTarget.name}`,
        }
      }
    }

    // Opportunistic cheap ability on any target when resource is plentiful.
    if (me.resource.current >= me.resource.max * 0.7) {
      const cheap = findReadyAbility(
        me.abilities,
        [
          "rogue-backstab",
          "rogue-envenom",
          "rogue-quick-strike",
        ],
        me.resource.current,
      )
      if (cheap) {
        return {
          abilityId: cheap.id,
          targetId: primaryTarget.id,
          reason: `Rogue opportunity ${cheap.name} (resource ${me.resource.current}/${me.resource.max})`,
        }
      }
    }

    return null
  },
}
