// ============================================================
// leveling.ts — XP curve and level-up logic
// ============================================================

import type { CharacterStats } from "./types.js"

export const MAX_LEVEL = 20
const STAT_KEYS: Array<keyof CharacterStats> = [
  "hp",
  "attack",
  "defense",
  "accuracy",
  "evasion",
  "speed",
]

export interface AppliedStatGrowth {
  nextStats: CharacterStats
  statGains: CharacterStats
}

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

/**
 * Applies compounding percentage-based stat growth over one or more levels.
 * Each level rounds the per-stat gain and enforces a minimum +1 so every
 * level-up produces visible progression in the character sheet.
 */
export function applyStatGrowth(
  currentStats: CharacterStats,
  growthRates: CharacterStats,
  levelsGained: number,
): AppliedStatGrowth {
  const nextStats: CharacterStats = { ...currentStats }
  const statGains: CharacterStats = {
    hp: 0,
    attack: 0,
    defense: 0,
    accuracy: 0,
    evasion: 0,
    speed: 0,
  }

  for (let level = 0; level < levelsGained; level += 1) {
    for (const key of STAT_KEYS) {
      const gain = Math.max(1, Math.round(nextStats[key] * growthRates[key]))
      nextStats[key] += gain
      statGains[key] += gain
    }
  }

  return { nextStats, statGains }
}
