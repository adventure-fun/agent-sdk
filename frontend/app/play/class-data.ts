import type { CharacterClass, CharacterStats, ResourceType } from "@adventure-fun/schemas"

/** Stat ranges per class: [min, max] — duplicated from backend/src/game/stats.ts */
export const CLASS_STAT_RANGES: Record<CharacterClass, Record<keyof CharacterStats, [number, number]>> = {
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

export const CLASS_RESOURCE_TYPE: Record<CharacterClass, ResourceType> = {
  knight: "stamina",
  mage:   "mana",
  rogue:  "energy",
  archer: "focus",
}

export const CLASS_DISPLAY_NAME: Record<CharacterClass, string> = {
  knight: "Knight",
  mage:   "Mage",
  rogue:  "Rogue",
  archer: "Archer",
}

export const CLASS_DESCRIPTION: Record<CharacterClass, string> = {
  knight: "A stalwart warrior clad in heavy armor. High HP and defense make the Knight a resilient frontliner who can absorb punishment and strike back hard.",
  mage:   "A wielder of arcane power. Fragile but devastating, the Mage trades durability for raw magical damage and precise spellcasting.",
  rogue:  "A shadow-dancer who strikes from the blind spots. The Rogue excels at evasion and speed, landing critical blows before enemies can react.",
  archer: "A sharpshooter with unmatched accuracy. The Archer picks off targets from range with deadly precision and steady focus.",
}

export const ALL_CLASSES: CharacterClass[] = ["knight", "mage", "rogue", "archer"]

export const STAT_KEYS: (keyof CharacterStats)[] = [
  "hp", "attack", "defense", "accuracy", "evasion", "speed",
]

export const STAT_LABELS: Record<keyof CharacterStats, string> = {
  hp:       "HP",
  attack:   "Attack",
  defense:  "Defense",
  accuracy: "Accuracy",
  evasion:  "Evasion",
  speed:    "Speed",
}
