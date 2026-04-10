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
  RoomTemplate,
} from "@adventure-fun/schemas"

// ---- Raw JSON imports (ESM, Bun/Node supports JSON imports) -

import knightJson from "../content/classes/knight.json" with { type: "json" }
import mageJson from "../content/classes/mage.json" with { type: "json" }
import rogueJson from "../content/classes/rogue.json" with { type: "json" }
import archerJson from "../content/classes/archer.json" with { type: "json" }

import sharedAbilitiesJson from "../content/abilities/shared.json" with { type: "json" }
import knightAbilitiesJson from "../content/abilities/knight-abilities.json" with { type: "json" }
import mageAbilitiesJson from "../content/abilities/mage-abilities.json" with { type: "json" }
import rogueAbilitiesJson from "../content/abilities/rogue-abilities.json" with { type: "json" }
import archerAbilitiesJson from "../content/abilities/archer-abilities.json" with { type: "json" }
import enemyAbilitiesJson from "../content/abilities/enemy-abilities.json" with { type: "json" }

import knightTreeJson from "../content/skill-trees/knight-tree.json" with { type: "json" }
import mageTreeJson from "../content/skill-trees/mage-tree.json" with { type: "json" }
import rogueTreeJson from "../content/skill-trees/rogue-tree.json" with { type: "json" }
import archerTreeJson from "../content/skill-trees/archer-tree.json" with { type: "json" }

import undeadJson from "../content/enemies/undead.json" with { type: "json" }
import hollowJson from "../content/enemies/hollow.json" with { type: "json" }
import bossesJson from "../content/enemies/bosses.json" with { type: "json" }
import constructsJson from "../content/enemies/constructs.json" with { type: "json" }

import consumablesJson from "../content/items/consumables.json" with { type: "json" }
import equipmentCommonJson from "../content/items/equipment-common.json" with { type: "json" }
import collapsedMinesItemsJson from "../content/items/collapsed-mines-items.json" with { type: "json" }

// ---- Room template JSON imports -----------------------------

// Tutorial
import tutorialStoreroomJson from "../content/rooms/tutorial/tutorial-storeroom.json" with { type: "json" }
import tutorialBurrowJson from "../content/rooms/tutorial/tutorial-burrow.json" with { type: "json" }

// Collapsed Passage
import cpEntranceJson from "../content/rooms/collapsed-passage/cp-entrance.json" with { type: "json" }
import cpShaftJunctionJson from "../content/rooms/collapsed-passage/cp-shaft-junction.json" with { type: "json" }
import cpFloodedChamberJson from "../content/rooms/collapsed-passage/cp-flooded-chamber.json" with { type: "json" }
import cpToolStorageJson from "../content/rooms/collapsed-passage/cp-tool-storage.json" with { type: "json" }
import cpLockedGateJson from "../content/rooms/collapsed-passage/cp-locked-gate.json" with { type: "json" }
import cpOverseersdenJson from "../content/rooms/collapsed-passage/cp-overseers-den.json" with { type: "json" }

// Blighted Hollow
import bhEntranceClearingJson from "../content/rooms/blighted-hollow/bh-entrance-clearing.json" with { type: "json" }
import bhFungalCorridorJson from "../content/rooms/blighted-hollow/bh-fungal-corridor.json" with { type: "json" }
import bhSporeDenJson from "../content/rooms/blighted-hollow/bh-spore-den.json" with { type: "json" }
import bhRootChamberJson from "../content/rooms/blighted-hollow/bh-root-chamber.json" with { type: "json" }
import bhWolfDenJson from "../content/rooms/blighted-hollow/bh-wolf-den.json" with { type: "json" }
import bhHollowSpringJson from "../content/rooms/blighted-hollow/bh-hollow-spring.json" with { type: "json" }
import bhCorruptedHeartJson from "../content/rooms/blighted-hollow/bh-corrupted-heart.json" with { type: "json" }

// Sunken Crypt
import scEntryHallJson from "../content/rooms/sunken-crypt/sc-entry-hall.json" with { type: "json" }
import scGalleryJson from "../content/rooms/sunken-crypt/sc-gallery.json" with { type: "json" }
import scSideVaultJson from "../content/rooms/sunken-crypt/sc-side-vault.json" with { type: "json" }
import scOfferingRoomJson from "../content/rooms/sunken-crypt/sc-offering-room.json" with { type: "json" }
import scFloodedPassageJson from "../content/rooms/sunken-crypt/sc-flooded-passage.json" with { type: "json" }
import scSubmergedHallJson from "../content/rooms/sunken-crypt/sc-submerged-hall.json" with { type: "json" }
import scTombOfWhispersJson from "../content/rooms/sunken-crypt/sc-tomb-of-whispers.json" with { type: "json" }
import scDrownedVaultJson from "../content/rooms/sunken-crypt/sc-drowned-vault.json" with { type: "json" }
import scRestShrineJson from "../content/rooms/sunken-crypt/sc-rest-shrine.json" with { type: "json" }
import scWardenAntechamberJson from "../content/rooms/sunken-crypt/sc-warden-antechamber.json" with { type: "json" }
import scWardenChamberJson from "../content/rooms/sunken-crypt/sc-warden-chamber.json" with { type: "json" }
import scTreasureVaultJson from "../content/rooms/sunken-crypt/sc-treasure-vault.json" with { type: "json" }

// ---- Realm JSON imports -------------------------------------

import tutorialCellarJson from "../content/realms/tutorial-cellar.json" with { type: "json" }
import collapsedPassageJson from "../content/realms/collapsed-passage.json" with { type: "json" }
import blightedHollowJson from "../content/realms/blighted-hollow.json" with { type: "json" }
import sunkenCryptJson from "../content/realms/sunken-crypt.json" with { type: "json" }
import collapsedMinesJson from "../content/realms/collapsed-mines.json" with { type: "json" }

// ---- Classes ------------------------------------------------

export const CLASSES: Record<string, ClassTemplate> = {
  knight: knightJson as unknown as ClassTemplate,
  mage: mageJson as unknown as ClassTemplate,
  rogue: rogueJson as unknown as ClassTemplate,
  archer: archerJson as unknown as ClassTemplate,
}

// ---- Abilities ----------------------------------------------

const allAbilities: AbilityTemplate[] = [
  ...(sharedAbilitiesJson as unknown as AbilityTemplate[]),
  ...(knightAbilitiesJson as unknown as AbilityTemplate[]),
  ...(mageAbilitiesJson as unknown as AbilityTemplate[]),
  ...(rogueAbilitiesJson as unknown as AbilityTemplate[]),
  ...(archerAbilitiesJson as unknown as AbilityTemplate[]),
  ...(enemyAbilitiesJson as unknown as AbilityTemplate[]),
]

export const ABILITIES: Record<string, AbilityTemplate> = Object.fromEntries(
  allAbilities.map((a) => [a.id, a])
)

// ---- Enemies ------------------------------------------------

const allEnemies: EnemyTemplate[] = [
  ...(undeadJson as unknown as EnemyTemplate[]),
  ...(hollowJson as unknown as EnemyTemplate[]),
  ...(bossesJson as unknown as EnemyTemplate[]),
  ...(constructsJson as unknown as EnemyTemplate[]),
]

export const ENEMIES: Record<string, EnemyTemplate> = Object.fromEntries(
  allEnemies.map((e) => [e.id, e])
)

// ---- Items --------------------------------------------------

const allItems: ItemTemplate[] = [
  ...(consumablesJson as unknown as ItemTemplate[]),
  ...(equipmentCommonJson as unknown as ItemTemplate[]),
  ...(collapsedMinesItemsJson as unknown as ItemTemplate[]),
]

export const ITEMS: Record<string, ItemTemplate> = Object.fromEntries(
  allItems.map((i) => [i.id, i])
)

// ---- Realms -------------------------------------------------

export const REALMS: Record<string, RealmTemplate> = {
  "tutorial-cellar": tutorialCellarJson as unknown as RealmTemplate,
  "collapsed-passage": collapsedPassageJson as unknown as RealmTemplate,
  "blighted-hollow": blightedHollowJson as unknown as RealmTemplate,
  "sunken-crypt": sunkenCryptJson as unknown as RealmTemplate,
  "collapsed-mines": collapsedMinesJson as unknown as RealmTemplate,
}

// ---- Room Templates -----------------------------------------

const allRoomTemplates: RoomTemplate[] = [
  // Tutorial
  tutorialStoreroomJson as unknown as RoomTemplate,
  tutorialBurrowJson as unknown as RoomTemplate,
  // Collapsed Passage
  cpEntranceJson as unknown as RoomTemplate,
  cpShaftJunctionJson as unknown as RoomTemplate,
  cpFloodedChamberJson as unknown as RoomTemplate,
  cpToolStorageJson as unknown as RoomTemplate,
  cpLockedGateJson as unknown as RoomTemplate,
  cpOverseersdenJson as unknown as RoomTemplate,
  // Blighted Hollow
  bhEntranceClearingJson as unknown as RoomTemplate,
  bhFungalCorridorJson as unknown as RoomTemplate,
  bhSporeDenJson as unknown as RoomTemplate,
  bhRootChamberJson as unknown as RoomTemplate,
  bhWolfDenJson as unknown as RoomTemplate,
  bhHollowSpringJson as unknown as RoomTemplate,
  bhCorruptedHeartJson as unknown as RoomTemplate,
  // Sunken Crypt
  scEntryHallJson as unknown as RoomTemplate,
  scGalleryJson as unknown as RoomTemplate,
  scSideVaultJson as unknown as RoomTemplate,
  scOfferingRoomJson as unknown as RoomTemplate,
  scFloodedPassageJson as unknown as RoomTemplate,
  scSubmergedHallJson as unknown as RoomTemplate,
  scTombOfWhispersJson as unknown as RoomTemplate,
  scDrownedVaultJson as unknown as RoomTemplate,
  scRestShrineJson as unknown as RoomTemplate,
  scWardenAntechamberJson as unknown as RoomTemplate,
  scWardenChamberJson as unknown as RoomTemplate,
  scTreasureVaultJson as unknown as RoomTemplate,
]

export const ROOMS: Record<string, RoomTemplate> = Object.fromEntries(
  allRoomTemplates.map((r) => [r.id, r])
)

// ---- Lore Registry ------------------------------------------

export interface LoreEntry {
  id: string
  name: string
  text: string
}

export const LORE: Record<string, LoreEntry> = {}
for (const room of allRoomTemplates) {
  for (const inter of room.interactables) {
    if (inter.lore_entry_id && inter.text_on_interact) {
      LORE[inter.lore_entry_id] = {
        id: inter.lore_entry_id,
        name: inter.name,
        text: inter.text_on_interact,
      }
    }
  }
}

// ---- Skill Trees --------------------------------------------

const allSkillTrees = [
  knightTreeJson,
  mageTreeJson,
  rogueTreeJson,
  archerTreeJson,
]

export const SKILL_TREES: Record<string, typeof knightTreeJson> = Object.fromEntries(
  allSkillTrees.map((t) => [t.id, t])
)

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

export function getEnemySafe(id: string): EnemyTemplate | null {
  return ENEMIES[id] ?? null
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

export function getRoomTemplate(id: string): RoomTemplate {
  const room = ROOMS[id]
  if (!room) throw new Error(`Unknown room template: "${id}"`)
  return room
}
