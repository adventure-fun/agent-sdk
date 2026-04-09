import { CLASSES } from "@adventure-fun/engine"
import type { CharacterClass, CharacterStats } from "@adventure-fun/schemas"

/** Rolls stats for a new character within class bounds (uniform random) */
export function rollStats(cls: CharacterClass): CharacterStats {
  const ranges = CLASSES[cls].stat_roll_ranges
  const roll = (key: keyof CharacterStats) => {
    const [min, max] = ranges[key]
    return Math.floor(Math.random() * (max - min + 1)) + min
  }
  return {
    hp:       roll("hp"),
    attack:   roll("attack"),
    defense:  roll("defense"),
    accuracy: roll("accuracy"),
    evasion:  roll("evasion"),
    speed:    roll("speed"),
  }
}

export function getResourceMax(cls: CharacterClass): number {
  return CLASSES[cls].resource_max
}

/** Re-rolls stats within same class bounds (x402 convenience) */
export function rerollStats(cls: CharacterClass): CharacterStats {
  return rollStats(cls)
}
