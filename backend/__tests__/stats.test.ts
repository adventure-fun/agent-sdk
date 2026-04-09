import { describe, it, expect } from "bun:test"
import { CLASSES } from "@adventure-fun/engine"
import type { CharacterClass, CharacterStats } from "@adventure-fun/schemas"
import { getResourceMax, rerollStats, rollStats } from "../src/game/stats.js"

const CLASSES_TO_TEST: CharacterClass[] = ["knight", "mage", "rogue", "archer"]
const STAT_KEYS: Array<keyof CharacterStats> = [
  "hp",
  "attack",
  "defense",
  "accuracy",
  "evasion",
  "speed",
]
const NON_HP_STAT_KEYS = STAT_KEYS.filter((key) => key !== "hp")

function projectStatsWithGrowth(
  startingStats: CharacterStats,
  growth: CharacterStats,
  levelsGained: number,
): CharacterStats {
  const projected = { ...startingStats }

  for (let level = 0; level < levelsGained; level += 1) {
    for (const key of STAT_KEYS) {
      const gain = Math.max(1, Math.round(projected[key] * growth[key]))
      projected[key] += gain
    }
  }

  return projected
}

function expectStatsWithinTemplateRanges(
  cls: CharacterClass,
  stats: CharacterStats,
) {
  const ranges = CLASSES[cls].stat_roll_ranges

  for (const key of STAT_KEYS) {
    const [min, max] = ranges[key]
    expect(stats[key]).toBeGreaterThanOrEqual(min)
    expect(stats[key]).toBeLessThanOrEqual(max)
  }
}

describe("stats", () => {
  it.each(CLASSES_TO_TEST)(
    "returns resource max from engine class templates for %s",
    (cls) => {
      expect(getResourceMax(cls)).toBe(CLASSES[cls].resource_max)
    },
  )

  it.each(CLASSES_TO_TEST)(
    "rollStats stays within engine stat roll ranges for %s",
    (cls) => {
      for (let i = 0; i < 100; i += 1) {
        expectStatsWithinTemplateRanges(cls, rollStats(cls))
      }
    },
  )

  it.each(CLASSES_TO_TEST)(
    "rerollStats stays within engine stat roll ranges for %s",
    (cls) => {
      for (let i = 0; i < 100; i += 1) {
        expectStatsWithinTemplateRanges(cls, rerollStats(cls))
      }
    },
  )

  it("keeps all starting stat ceilings within the Group 2 rebalance caps", () => {
    for (const cls of CLASSES_TO_TEST) {
      const ranges = CLASSES[cls].stat_roll_ranges
      expect(ranges.hp[1]).toBeLessThanOrEqual(40)

      for (const key of NON_HP_STAT_KEYS) {
        expect(ranges[key][1]).toBeLessThanOrEqual(20)
      }
    }
  })

  it("keeps percentage growth rates inside the rebalance bounds", () => {
    for (const cls of CLASSES_TO_TEST) {
      const growth = CLASSES[cls].stat_growth
      expect(growth.hp).toBeGreaterThanOrEqual(0.01)
      expect(growth.hp).toBeLessThanOrEqual(0.1)

      for (const key of NON_HP_STAT_KEYS) {
        expect(growth[key]).toBeGreaterThanOrEqual(0.01)
        expect(growth[key]).toBeLessThanOrEqual(0.08)
      }
    }
  })

  it("preserves class role identity in the new stat ranges", () => {
    const defenseMaxima = CLASSES_TO_TEST.map((cls) => ({
      cls,
      max: CLASSES[cls].stat_roll_ranges.defense[1],
    }))
    const accuracyMaxima = CLASSES_TO_TEST.map((cls) => ({
      cls,
      max: CLASSES[cls].stat_roll_ranges.accuracy[1],
    }))
    const evasionMaxima = CLASSES_TO_TEST.map((cls) => ({
      cls,
      max: CLASSES[cls].stat_roll_ranges.evasion[1],
    }))
    const attackMaxima = CLASSES_TO_TEST.map((cls) => ({
      cls,
      max: CLASSES[cls].stat_roll_ranges.attack[1],
    }))

    expect(defenseMaxima.sort((a, b) => b.max - a.max)[0]?.cls).toBe("knight")
    expect(accuracyMaxima.sort((a, b) => b.max - a.max)[0]?.cls).toBe("archer")
    expect(evasionMaxima.sort((a, b) => b.max - a.max)[0]?.cls).toBe("rogue")
    expect(attackMaxima.sort((a, b) => b.max - a.max)[0]?.cls).toBe("mage")
  })

  it.each(CLASSES_TO_TEST)(
    "keeps %s growth projections within sane level-20 ceilings",
    (cls) => {
      const projected = projectStatsWithGrowth(CLASSES[cls].base_stats, CLASSES[cls].stat_growth, 19)
      expect(projected.hp).toBeLessThanOrEqual(100)

      for (const key of NON_HP_STAT_KEYS) {
        expect(projected[key]).toBeLessThanOrEqual(50)
      }
    },
  )
})
