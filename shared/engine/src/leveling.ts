// ============================================================
// leveling.ts — XP curve and level-up logic
// ============================================================

export const MAX_LEVEL = 20

/**
 * Cumulative XP required to reach a given level.
 * Uses a quadratic curve: XP(L) = 50 * (L-1)^2 + 50 * (L-1)
 * This gives: L2=100, L3=300, L4=600, L5=1000, L10=4500, L15=10500, L20=19000
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0
  const n = level - 1
  return 50 * n * n + 50 * n
}

/**
 * Determine the level for a given cumulative XP total.
 * Inverse of xpForLevel — finds the highest level whose threshold is <= xp.
 */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1
  let level = 1
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) {
    level++
  }
  return level
}

/**
 * XP remaining until the next level.
 * Returns 0 if already at MAX_LEVEL.
 */
export function xpToNextLevel(currentXp: number, currentLevel: number): number {
  if (currentLevel >= MAX_LEVEL) return 0
  return xpForLevel(currentLevel + 1) - currentXp
}

/**
 * Check whether XP warrants a level-up (possibly multiple levels).
 * Returns the new level and how many levels were gained.
 */
export function checkLevelUp(
  currentLevel: number,
  currentXp: number,
): { newLevel: number; levelsGained: number } {
  const targetLevel = levelForXp(currentXp)
  const newLevel = Math.max(currentLevel, targetLevel)
  return {
    newLevel,
    levelsGained: newLevel - currentLevel,
  }
}
