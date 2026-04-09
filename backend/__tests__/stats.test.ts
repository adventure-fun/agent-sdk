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
})
