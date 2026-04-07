// ============================================================
// content.ts — Game content loader
// Imports all JSON content files and exports typed maps for
// use by the engine, server, and any other consumers.
// ============================================================

import type {
  ClassTemplate,
  AbilityTemplate,
  EnemyTemplate,
  ItemTemplate,
  RealmTemplate,
} from "@adventure-fun/schemas"

// ---- Raw JSON imports (ESM, Bun/Node supports JSON imports) -

import knightJson from "../content/classes/knight.json" assert { type: "json" }
import mageJson from "../content/classes/mage.json" assert { type: "json" }
import rogueJson from "../content/classes/rogue.json" assert { type: "json" }
import archerJson from "../content/classes/archer.json" assert { type: "json" }

import knightAbilitiesJson from "../content/abilities/knight-abilities.json" assert { type: "json" }
import mageAbilitiesJson from "../content/abilities/mage-abilities.json" assert { type: "json" }
import rogueAbilitiesJson from "../content/abilities/rogue-abilities.json" assert { type: "json" }
import archerAbilitiesJson from "../content/abilities/archer-abilities.json" assert { type: "json" }

import undeadJson from "../content/enemies/undead.json" assert { type: "json" }
import bossesJson from "../content/enemies/bosses.json" assert { type: "json" }

import consumablesJson from "../content/items/consumables.json" assert { type: "json" }
import equipmentCommonJson from "../content/items/equipment-common.json" assert { type: "json" }

import sunkenCryptJson from "../content/realms/sunken-crypt.json" assert { type: "json" }
import collapsedMinesJson from "../content/realms/collapsed-mines.json" assert { type: "json" }

// ---- Classes ------------------------------------------------

export const CLASSES: Record<string, ClassTemplate> = {
  knight: knightJson as unknown as ClassTemplate,
  mage: mageJson as unknown as ClassTemplate,
  rogue: rogueJson as unknown as ClassTemplate,
  archer: archerJson as unknown as ClassTemplate,
}

// ---- Abilities ----------------------------------------------

const allAbilities: AbilityTemplate[] = [
  ...(knightAbilitiesJson as unknown as AbilityTemplate[]),
  ...(mageAbilitiesJson as unknown as AbilityTemplate[]),
  ...(rogueAbilitiesJson as unknown as AbilityTemplate[]),
  ...(archerAbilitiesJson as unknown as AbilityTemplate[]),
]

export const ABILITIES: Record<string, AbilityTemplate> = Object.fromEntries(
  allAbilities.map((a) => [a.id, a])
)

// ---- Enemies ------------------------------------------------

const allEnemies: EnemyTemplate[] = [
  ...(undeadJson as unknown as EnemyTemplate[]),
  ...(bossesJson as unknown as EnemyTemplate[]),
]

export const ENEMIES: Record<string, EnemyTemplate> = Object.fromEntries(
  allEnemies.map((e) => [e.id, e])
)

// ---- Items --------------------------------------------------

const allItems: ItemTemplate[] = [
  ...(consumablesJson as unknown as ItemTemplate[]),
  ...(equipmentCommonJson as unknown as ItemTemplate[]),
]

export const ITEMS: Record<string, ItemTemplate> = Object.fromEntries(
  allItems.map((i) => [i.id, i])
)

// ---- Realms -------------------------------------------------

export const REALMS: Record<string, RealmTemplate> = {
  "sunken-crypt": sunkenCryptJson as unknown as RealmTemplate,
  "collapsed-mines": collapsedMinesJson as unknown as RealmTemplate,
}

// ---- Accessor helpers ---------------------------------------

export function getClass(id: string): ClassTemplate {
  const cls = CLASSES[id]
  if (!cls) throw new Error(`Unknown class: "${id}"`)
  return cls
}

export function getAbility(id: string): AbilityTemplate {
  const ability = ABILITIES[id]
  if (!ability) throw new Error(`Unknown ability: "${id}"`)
  return ability
}

export function getEnemy(id: string): EnemyTemplate {
  const enemy = ENEMIES[id]
  if (!enemy) throw new Error(`Unknown enemy: "${id}"`)
  return enemy
}

export function getItem(id: string): ItemTemplate {
  const item = ITEMS[id]
  if (!item) throw new Error(`Unknown item: "${id}"`)
  return item
}

export function getRealm(id: string): RealmTemplate {
  const realm = REALMS[id]
  if (!realm) throw new Error(`Unknown realm: "${id}"`)
  return realm
}
