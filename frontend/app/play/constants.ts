import type { CharacterClass, EquipSlot } from "@adventure-fun/schemas"

export const STAT_KEYS = ["hp", "attack", "defense", "accuracy", "evasion", "speed"] as const

export const STAT_LABELS: Record<string, string> = {
  hp: "HP", attack: "Attack", defense: "Defense",
  accuracy: "Accuracy", evasion: "Evasion", speed: "Speed",
}

export const CLASS_ROLE_LABELS: Record<CharacterClass, string> = {
  knight: "Tank",
  mage: "Glass Cannon",
  rogue: "Burst DPS",
  archer: "Marksman",
}

export const REALM_STATUS_LABELS: Record<string, string> = {
  generated: "Ready", active: "In Progress", paused: "Paused",
  boss_cleared: "Boss Cleared", realm_cleared: "Cleared", completed: "Completed", dead_end: "Lost",
}

export const TUTORIAL_TEMPLATE_ID = "tutorial-cellar"

export const EQUIP_SLOT_ORDER: EquipSlot[] = ["weapon", "armor", "helm", "hands", "accessory"]
export const EQUIP_SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: "Weapon",
  armor: "Armor",
  helm: "Helm",
  hands: "Hands",
  accessory: "Accessory",
}
