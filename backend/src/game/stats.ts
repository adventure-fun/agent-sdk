import type { CharacterClass, CharacterStats } from "@adventure-fun/schemas"

/** Stat ranges per class: [min, max] for each stat */
const CLASS_STAT_RANGES: Record<CharacterClass, Record<keyof CharacterStats, [number, number]>> = {
  knight: {
    hp:       [90,  110],
    attack:   [15,  20],
    defense:  [10,  14],
    accuracy: [60,  75],
    evasion:  [10,  18],
    speed:    [8,   12],
  },
  mage: {
    hp:       [55,  70],
    attack:   [22,  28],
    defense:  [3,   6],
    accuracy: [70,  80],
    evasion:  [12,  18],
    speed:    [10,  14],
  },
  rogue: {
    hp:       [65,  80],
    attack:   [18,  23],
    defense:  [5,   8],
    accuracy: [75,  85],
    evasion:  [20,  28],
    speed:    [15,  20],
  },
  archer: {
    hp:       [70,  85],
    attack:   [17,  22],
    defense:  [6,   10],
    accuracy: [80,  90],
    evasion:  [15,  22],
    speed:    [12,  16],
  },
}

const RESOURCE_MAX: Record<CharacterClass, number> = {
  knight: 100,
  mage:   100,
  rogue:  100,
  archer: 100,
}

/** Rolls stats for a new character within class bounds (uniform random) */
export function rollStats(cls: CharacterClass): CharacterStats {
  const ranges = CLASS_STAT_RANGES[cls]
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
  return RESOURCE_MAX[cls]
}

/** Re-rolls stats within same class bounds (x402 convenience) */
export function rerollStats(cls: CharacterClass): CharacterStats {
  return rollStats(cls)
}
