import { describe, expect, it } from "bun:test"
import {
  xpForLevel,
  levelForXp,
  xpToNextLevel,
  checkLevelUp,
  MAX_LEVEL,
} from "../src/leveling.js"

describe("XP curve", () => {
  it("level 1 requires 0 cumulative XP", () => {
    expect(xpForLevel(1)).toBe(0)
  })

  it("level 2 requires a positive amount of XP", () => {
    expect(xpForLevel(2)).toBeGreaterThan(0)
  })

  it("XP thresholds are strictly increasing", () => {
    for (let lvl = 2; lvl <= MAX_LEVEL; lvl++) {
      expect(xpForLevel(lvl)).toBeGreaterThan(xpForLevel(lvl - 1))
    }
  })

  it("early levels require reasonable XP gaps (not too grindy)", () => {
    const gap2 = xpForLevel(2) - xpForLevel(1)
    const gap3 = xpForLevel(3) - xpForLevel(2)
    expect(gap2).toBeGreaterThanOrEqual(20)
    expect(gap2).toBeLessThanOrEqual(200)
    expect(gap3).toBeGreaterThanOrEqual(gap2)
  })

  it("later levels require progressively more XP", () => {
    for (let lvl = 3; lvl <= MAX_LEVEL; lvl++) {
      const gapPrev = xpForLevel(lvl) - xpForLevel(lvl - 1)
      const gapCur = xpForLevel(lvl + 1 > MAX_LEVEL ? lvl : lvl + 1) - xpForLevel(lvl)
      if (lvl < MAX_LEVEL) {
        expect(gapCur).toBeGreaterThanOrEqual(gapPrev)
      }
    }
  })
})

describe("levelForXp", () => {
  it("0 XP → level 1", () => {
    expect(levelForXp(0)).toBe(1)
  })

  it("exactly at a threshold → that level", () => {
    expect(levelForXp(xpForLevel(5))).toBe(5)
  })

  it("just below a threshold → previous level", () => {
    expect(levelForXp(xpForLevel(5) - 1)).toBe(4)
  })

  it("massive XP is capped at MAX_LEVEL", () => {
    expect(levelForXp(999999999)).toBe(MAX_LEVEL)
  })

  it("negative XP returns level 1", () => {
    expect(levelForXp(-100)).toBe(1)
  })
})

describe("xpToNextLevel", () => {
  it("at level 1 with 0 XP, returns XP needed for level 2", () => {
    expect(xpToNextLevel(0, 1)).toBe(xpForLevel(2))
  })

  it("returns 0 at MAX_LEVEL", () => {
    expect(xpToNextLevel(999999999, MAX_LEVEL)).toBe(0)
  })

  it("partially through a level returns the remaining gap", () => {
    const currentXp = xpForLevel(3) + 10
    const needed = xpForLevel(4) - currentXp
    expect(xpToNextLevel(currentXp, 3)).toBe(needed)
  })
})

describe("checkLevelUp", () => {
  it("returns no levels when XP is below level 2 threshold", () => {
    const result = checkLevelUp(1, 0)
    expect(result.newLevel).toBe(1)
    expect(result.levelsGained).toBe(0)
  })

  it("returns a level-up when XP crosses the level 2 threshold", () => {
    const result = checkLevelUp(1, xpForLevel(2))
    expect(result.newLevel).toBe(2)
    expect(result.levelsGained).toBe(1)
  })

  it("handles multi-level jumps from a big XP spike", () => {
    const result = checkLevelUp(1, xpForLevel(5))
    expect(result.newLevel).toBe(5)
    expect(result.levelsGained).toBe(4)
  })

  it("does not re-level if already at the correct level", () => {
    const result = checkLevelUp(5, xpForLevel(5) + 10)
    expect(result.newLevel).toBe(5)
    expect(result.levelsGained).toBe(0)
  })

  it("caps at MAX_LEVEL", () => {
    const result = checkLevelUp(1, 999999999)
    expect(result.newLevel).toBe(MAX_LEVEL)
    expect(result.levelsGained).toBe(MAX_LEVEL - 1)
  })
})
