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

import knightJson from "../content/classes/knight.json" assert { type: "json" }
import mageJson from "../content/classes/mage.json" assert { type: "json" }
import rogueJson from "../content/classes/rogue.json" assert { type: "json" }
import archerJson from "../content/classes/archer.json" assert { type: "json" }

import knightAbilitiesJson from "../content/abilities/knight-abilities.json" assert { type: "json" }
import mageAbilitiesJson from "../content/abilities/mage-abilities.json" assert { type: "json" }
import rogueAbilitiesJson from "../content/abilities/rogue-abilities.json" assert { type: "json" }
import archerAbilitiesJson from "../content/abilities/archer-abilities.json" assert { type: "json" }

import undeadJson from "../content/enemies/undead.json" assert { type: "json" }
import hollowJson from "../content/enemies/hollow.json" assert { type: "json" }
import bossesJson from "../content/enemies/bosses.json" assert { type: "json" }

import consumablesJson from "../content/items/consumables.json" assert { type: "json" }
import equipmentCommonJson from "../content/items/equipment-common.json" assert { type: "json" }

// ---- Room template JSON imports -----------------------------

// Tutorial
import tutorialStoreroomJson from "../content/rooms/tutorial/tutorial-storeroom.json" assert { type: "json" }
import tutorialBurrowJson from "../content/rooms/tutorial/tutorial-burrow.json" assert { type: "json" }

// Collapsed Passage
import cpEntranceJson from "../content/rooms/collapsed-passage/cp-entrance.json" assert { type: "json" }
import cpShaftJunctionJson from "../content/rooms/collapsed-passage/cp-shaft-junction.json" assert { type: "json" }
import cpFloodedChamberJson from "../content/rooms/collapsed-passage/cp-flooded-chamber.json" assert { type: "json" }
import cpToolStorageJson from "../content/rooms/collapsed-passage/cp-tool-storage.json" assert { type: "json" }
import cpLockedGateJson from "../content/rooms/collapsed-passage/cp-locked-gate.json" assert { type: "json" }
import cpOverseersdenJson from "../content/rooms/collapsed-passage/cp-overseers-den.json" assert { type: "json" }

// Blighted Hollow
import bhEntranceClearingJson from "../content/rooms/blighted-hollow/bh-entrance-clearing.json" assert { type: "json" }
import bhFungalCorridorJson from "../content/rooms/blighted-hollow/bh-fungal-corridor.json" assert { type: "json" }
import bhSporeDenJson from "../content/rooms/blighted-hollow/bh-spore-den.json" assert { type: "json" }
import bhRootChamberJson from "../content/rooms/blighted-hollow/bh-root-chamber.json" assert { type: "json" }
import bhWolfDenJson from "../content/rooms/blighted-hollow/bh-wolf-den.json" assert { type: "json" }
import bhHollowSpringJson from "../content/rooms/blighted-hollow/bh-hollow-spring.json" assert { type: "json" }
import bhCorruptedHeartJson from "../content/rooms/blighted-hollow/bh-corrupted-heart.json" assert { type: "json" }

// Sunken Crypt
import scEntryHallJson from "../content/rooms/sunken-crypt/sc-entry-hall.json" assert { type: "json" }
import scGalleryJson from "../content/rooms/sunken-crypt/sc-gallery.json" assert { type: "json" }
import scSideVaultJson from "../content/rooms/sunken-crypt/sc-side-vault.json" assert { type: "json" }
import scOfferingRoomJson from "../content/rooms/sunken-crypt/sc-offering-room.json" assert { type: "json" }
import scFloodedPassageJson from "../content/rooms/sunken-crypt/sc-flooded-passage.json" assert { type: "json" }
import scSubmergedHallJson from "../content/rooms/sunken-crypt/sc-submerged-hall.json" assert { type: "json" }
import scTombOfWhispersJson from "../content/rooms/sunken-crypt/sc-tomb-of-whispers.json" assert { type: "json" }
import scDrownedVaultJson from "../content/rooms/sunken-crypt/sc-drowned-vault.json" assert { type: "json" }
import scRestShrineJson from "../content/rooms/sunken-crypt/sc-rest-shrine.json" assert { type: "json" }
import scWardenAntechamberJson from "../content/rooms/sunken-crypt/sc-warden-antechamber.json" assert { type: "json" }
import scWardenChamberJson from "../content/rooms/sunken-crypt/sc-warden-chamber.json" assert { type: "json" }
import scTreasureVaultJson from "../content/rooms/sunken-crypt/sc-treasure-vault.json" assert { type: "json" }

// ---- Realm JSON imports -------------------------------------

import tutorialCellarJson from "../content/realms/tutorial-cellar.json" assert { type: "json" }
import collapsedPassageJson from "../content/realms/collapsed-passage.json" assert { type: "json" }
import blightedHollowJson from "../content/realms/blighted-hollow.json" assert { type: "json" }
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
  ...(hollowJson as unknown as EnemyTemplate[]),
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

export function getRoomTemplate(id: string): RoomTemplate {
  const room = ROOMS[id]
  if (!room) throw new Error(`Unknown room template: "${id}"`)
  return room
}
