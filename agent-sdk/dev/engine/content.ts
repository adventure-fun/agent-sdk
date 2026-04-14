// Generated local-dev content registry for the Agent SDK dev stack.
import type {
  ClassTemplate,
  AbilityTemplate,
  EnemyTemplate,
  ItemTemplate,
  RealmTemplate,
  RoomTemplate,
} from "./types.js"

import knightJson from "../content/classes/knight.json" with { type: "json" }
import mageJson from "../content/classes/mage.json" with { type: "json" }
import rogueJson from "../content/classes/rogue.json" with { type: "json" }
import archerJson from "../content/classes/archer.json" with { type: "json" }

import sharedAbilitiesJson from "../content/abilities/shared.json" with { type: "json" }
import classAbilitiesJson from "../content/abilities/class-abilities.json" with { type: "json" }
import enemyAbilitiesJson from "../content/abilities/enemy-abilities.json" with { type: "json" }

import enemiesJson from "../content/enemies/core.json" with { type: "json" }
import itemsJson from "../content/items/core.json" with { type: "json" }

import testTutorialRealmJson from "../content/realms/test-tutorial.json" with { type: "json" }
import testArenaRealmJson from "../content/realms/test-arena.json" with { type: "json" }
import testDungeonRealmJson from "../content/realms/test-dungeon.json" with { type: "json" }

import testTutorialEntryJson from "../content/rooms/test-tutorial/test-tutorial-entry.json" with { type: "json" }
import testTutorialCombatJson from "../content/rooms/test-tutorial/test-tutorial-combat.json" with { type: "json" }
import testTutorialExitJson from "../content/rooms/test-tutorial/test-tutorial-exit.json" with { type: "json" }

import testArenaGauntletJson from "../content/rooms/test-arena/test-arena-gauntlet.json" with { type: "json" }

import testDungeonEntryJson from "../content/rooms/test-dungeon/test-dungeon-entry.json" with { type: "json" }
import testDungeonTrapHallJson from "../content/rooms/test-dungeon/test-dungeon-trap-hall.json" with { type: "json" }
import testDungeonStairsJson from "../content/rooms/test-dungeon/test-dungeon-stairs.json" with { type: "json" }
import testDungeonAntechamberJson from "../content/rooms/test-dungeon/test-dungeon-antechamber.json" with { type: "json" }
import testDungeonBossJson from "../content/rooms/test-dungeon/test-dungeon-boss.json" with { type: "json" }

export const CLASSES: Record<string, ClassTemplate> = {
  knight: knightJson as unknown as ClassTemplate,
  mage: mageJson as unknown as ClassTemplate,
  rogue: rogueJson as unknown as ClassTemplate,
  archer: archerJson as unknown as ClassTemplate,
}

const allAbilities: AbilityTemplate[] = [
  ...(sharedAbilitiesJson as unknown as AbilityTemplate[]),
  ...(classAbilitiesJson as unknown as AbilityTemplate[]),
  ...(enemyAbilitiesJson as unknown as AbilityTemplate[]),
]

export const ABILITIES: Record<string, AbilityTemplate> = Object.fromEntries(
  allAbilities.map((ability) => [ability.id, ability]),
)

const allEnemies: EnemyTemplate[] = enemiesJson as unknown as EnemyTemplate[]
export const ENEMIES: Record<string, EnemyTemplate> = Object.fromEntries(
  allEnemies.map((enemy) => [enemy.id, enemy]),
)

const allItems: ItemTemplate[] = itemsJson as unknown as ItemTemplate[]
export const ITEMS: Record<string, ItemTemplate> = Object.fromEntries(
  allItems.map((item) => [item.id, item]),
)

export const REALMS: Record<string, RealmTemplate> = {
  "test-tutorial": testTutorialRealmJson as unknown as RealmTemplate,
  "test-arena": testArenaRealmJson as unknown as RealmTemplate,
  "test-dungeon": testDungeonRealmJson as unknown as RealmTemplate,
}

const allRoomTemplates: RoomTemplate[] = [
  testTutorialEntryJson as unknown as RoomTemplate,
  testTutorialCombatJson as unknown as RoomTemplate,
  testTutorialExitJson as unknown as RoomTemplate,
  testArenaGauntletJson as unknown as RoomTemplate,
  testDungeonEntryJson as unknown as RoomTemplate,
  testDungeonTrapHallJson as unknown as RoomTemplate,
  testDungeonStairsJson as unknown as RoomTemplate,
  testDungeonAntechamberJson as unknown as RoomTemplate,
  testDungeonBossJson as unknown as RoomTemplate,
]

export const ROOMS: Record<string, RoomTemplate> = Object.fromEntries(
  allRoomTemplates.map((room) => [room.id, room]),
)

export interface LoreEntry {
  id: string
  name: string
  text: string
}

export const LORE: Record<string, LoreEntry> = {}
for (const room of allRoomTemplates) {
  for (const interactable of room.interactables) {
    if (interactable.lore_entry_id && interactable.text_on_interact) {
      LORE[interactable.lore_entry_id] = {
        id: interactable.lore_entry_id,
        name: interactable.name,
        text: interactable.text_on_interact,
      }
    }
  }
}

const allSkillTrees = Object.values(CLASSES).map((classTemplate) => ({
  id: `${classTemplate.id}-tree`,
  ...classTemplate.skill_tree,
}))

export const SKILL_TREES: Record<string, { id: string; tiers: ClassTemplate["skill_tree"]["tiers"] }> =
  Object.fromEntries(allSkillTrees.map((tree) => [tree.id, tree]))

// Shared perks. Dev-stack content has none today — turn.ts imports the
// registry to layer perk bonuses into effective_stats; an empty record is
// the correct dev-mode fallback (no perks defined => no bonuses applied).
export interface PerkTemplate {
  id: string
  name: string
  description: string
  stat: string
  value_per_stack: number
  max_stacks: number
}

export const PERKS: Record<string, PerkTemplate> = {}

export function getClass(id: string): ClassTemplate {
  const classTemplate = CLASSES[id]
  if (!classTemplate) {
    throw new Error(`Unknown class: "${id}"`)
  }
  return classTemplate
}

export function getAbility(id: string): AbilityTemplate {
  const ability = ABILITIES[id]
  if (!ability) {
    throw new Error(`Unknown ability: "${id}"`)
  }
  return ability
}

export function getEnemy(id: string): EnemyTemplate {
  const enemy = ENEMIES[id]
  if (!enemy) {
    throw new Error(`Unknown enemy: "${id}"`)
  }
  return enemy
}

export function getEnemySafe(id: string): EnemyTemplate | null {
  return ENEMIES[id] ?? null
}

export function getItem(id: string): ItemTemplate {
  const item = ITEMS[id]
  if (!item) {
    throw new Error(`Unknown item: "${id}"`)
  }
  return item
}

export function getRealm(id: string): RealmTemplate {
  const realm = REALMS[id]
  if (!realm) {
    throw new Error(`Unknown realm: "${id}"`)
  }
  return realm
}

export function getRoomTemplate(id: string): RoomTemplate {
  const room = ROOMS[id]
  if (!room) {
    throw new Error(`Unknown room template: "${id}"`)
  }
  return room
}
