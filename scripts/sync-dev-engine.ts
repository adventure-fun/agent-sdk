#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseExportBlocks, ROOT_DIR } from "./sdk-sync-lib.js"

export const ENGINE_SOURCE_DIR = path.join(ROOT_DIR, "shared/engine/src")
export const DEV_ENGINE_DIR = path.join(ROOT_DIR, "agent-sdk/dev/engine")
export const DEV_CONTENT_DIR = path.join(ROOT_DIR, "agent-sdk/dev/content")
export const SCHEMAS_FILE = path.join(ROOT_DIR, "shared/schemas/src/index.ts")

export const EXTRA_SCHEMA_EXPORTS = [
  "BASE_INVENTORY_SLOTS",
  "getInventoryCapacity",
  "ItemEffect",
  "Account",
  "CharacterStatus",
  "Character",
  "MutationType",
  "WorldMutation",
  "LoreDiscovery",
  "TurnResult",
  "GameState",
  "RealmStatus",
  "RealmInstance",
  "SpectatorEntity",
  "SpectatorObservation",
  "SpectatableSessionSummary",
  "ActiveSpectateListResponse",
  "AbilityTemplate",
  "ItemTemplate",
  "SkillNodeTemplate",
  "SkillTier",
  "ClassTemplate",
  "BossPhase",
  "EnemyTemplate",
  "LootEntry",
  "LootTable",
  "TrapTemplate",
  "InteractableTemplate",
  "Condition",
  "Effect",
  "TriggerTemplate",
  "EnemySlot",
  "LootSlot",
  "RoomType",
  "RoomTemplate",
  "RealmTemplate",
] as const

export const ENGINE_FILES = [
  "rng.ts",
  "combat.ts",
  "visibility.ts",
  "realm.ts",
  "turn.ts",
  "leveling.ts",
] as const

function normalizeGeneratedContent(content: string): string {
  return `${content.trimEnd()}\n`
}

export function generateTypesSource(schemaSource: string): string {
  const blocks = parseExportBlocks(schemaSource)
  const extracted = EXTRA_SCHEMA_EXPORTS.map((name) => {
    const block = blocks.get(name)
    if (!block) {
      throw new Error(`Missing schema export "${name}" for dev engine sync`)
    }
    return block.content
  })

  return normalizeGeneratedContent([
    "// Vendored from shared/schemas/src/index.ts for the local dev engine.",
    "// Re-export SDK protocol types first, then append the additional engine-only schema contracts.",
    "",
    'import type {',
    "  PlayerType,",
    "  CharacterClass,",
    "  ResourceType,",
    "  CharacterStats,",
    "  Observation,",
    "  LobbyEvent,",
    "  ActiveEffect,",
    "  InventoryItem,",
    "  EquipSlot,",
    "  ItemType,",
    "  ItemRarity,",
    "  Tile,",
    "  StatusEffect,",
    "  EnemyBehavior,",
    "  KnownMapData,",
    "  GameEvent,",
    '} from "../../src/protocol.js"',
    "",
    'export * from "../../src/protocol.js"',
    "",
    ...extracted.flatMap((block) => [block, ""]),
  ].join("\n"))
}

export function rewriteEngineImports(source: string): string {
  return normalizeGeneratedContent(
    source
      .replaceAll('from "@adventure-fun/schemas"', 'from "./types.js"')
      .replaceAll("from \"@adventure-fun/schemas\"", 'from "./types.js"')
      .replaceAll(
        "import type { GeneratedRealm, GeneratedFloor, GeneratedRoom } from \"./realm.js\"",
        'import type { GeneratedRealm, GeneratedFloor, GeneratedRoom } from "./realm.js"',
      )
      .replace(
        "      if (idx >= 0) {\n        const item = s.inventory[idx]\n        if (item.quantity > 1) {\n          item.quantity -= 1\n        } else {\n          s.inventory.splice(idx, 1)\n        }\n      }",
        "      if (idx >= 0) {\n        const item = s.inventory[idx]\n        if (!item) break\n        if (item.quantity > 1) {\n          item.quantity -= 1\n        } else {\n          s.inventory.splice(idx, 1)\n        }\n      }",
      ),
  )
}

export function generateContentSource(): string {
  return normalizeGeneratedContent(`// Generated local-dev content registry for the Agent SDK dev stack.
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
  id: \`\${classTemplate.id}-tree\`,
  ...classTemplate.skill_tree,
}))

export const SKILL_TREES: Record<string, { id: string; tiers: ClassTemplate["skill_tree"]["tiers"] }> =
  Object.fromEntries(allSkillTrees.map((tree) => [tree.id, tree]))

export function getClass(id: string): ClassTemplate {
  const classTemplate = CLASSES[id]
  if (!classTemplate) {
    throw new Error(\`Unknown class: "\${id}"\`)
  }
  return classTemplate
}

export function getAbility(id: string): AbilityTemplate {
  const ability = ABILITIES[id]
  if (!ability) {
    throw new Error(\`Unknown ability: "\${id}"\`)
  }
  return ability
}

export function getEnemy(id: string): EnemyTemplate {
  const enemy = ENEMIES[id]
  if (!enemy) {
    throw new Error(\`Unknown enemy: "\${id}"\`)
  }
  return enemy
}

export function getEnemySafe(id: string): EnemyTemplate | null {
  return ENEMIES[id] ?? null
}

export function getItem(id: string): ItemTemplate {
  const item = ITEMS[id]
  if (!item) {
    throw new Error(\`Unknown item: "\${id}"\`)
  }
  return item
}

export function getRealm(id: string): RealmTemplate {
  const realm = REALMS[id]
  if (!realm) {
    throw new Error(\`Unknown realm: "\${id}"\`)
  }
  return realm
}

export function getRoomTemplate(id: string): RoomTemplate {
  const room = ROOMS[id]
  if (!room) {
    throw new Error(\`Unknown room template: "\${id}"\`)
  }
  return room
}
`)
}

export function generateIndexSource(): string {
  return normalizeGeneratedContent(`export * from "./rng.js"
export * from "./combat.js"
export * from "./visibility.js"
export * from "./realm.js"
export * from "./content.js"
export * from "./turn.js"
export * from "./leveling.js"
export * from "./types.js"
`)
}

type JsonObject = Record<string, unknown>

function prettyJson(value: JsonObject | JsonObject[]): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function createCharacterStats(
  hp: number,
  attack: number,
  defense: number,
  accuracy: number,
  evasion: number,
  speed: number,
): Record<string, number> {
  return { hp, attack, defense, accuracy, evasion, speed }
}

export function buildDevContent(): Array<{ file: string; value: JsonObject | JsonObject[] }> {
  const basicAttack = {
    id: "basic-attack",
    name: "Basic Attack",
    description: "A simple weapon attack. Always available, costs no resources.",
    resource_cost: 0,
    cooldown_turns: 0,
    range: "melee",
    damage_formula: { base: 5, stat_scaling: "attack", scaling_factor: 1.0 },
    effects: [],
    target: "single",
  }

  const classAbilities = [
    {
      id: "knight-shield-bash",
      name: "Shield Bash",
      description: "A heavy strike that staggers the target.",
      resource_cost: 2,
      cooldown_turns: 2,
      range: "melee",
      damage_formula: { base: 7, stat_scaling: "defense", scaling_factor: 0.7 },
      effects: [{ type: "stun", magnitude: 1, duration: 1 }],
      target: "single",
    },
    {
      id: "mage-arcane-bolt",
      name: "Arcane Bolt",
      description: "A focused bolt of force.",
      resource_cost: 2,
      cooldown_turns: 1,
      range: 3,
      damage_formula: { base: 8, stat_scaling: "attack", scaling_factor: 0.9 },
      effects: [],
      target: "single",
    },
    {
      id: "rogue-disarm-trap",
      name: "Disarm Trap",
      description: "Safely disables a nearby trap.",
      resource_cost: 1,
      cooldown_turns: 0,
      range: "melee",
      damage_formula: { base: 0, stat_scaling: "speed", scaling_factor: 0 },
      effects: [],
      target: "self",
      special: "disarm_trap",
    },
    {
      id: "archer-quick-shot",
      name: "Quick Shot",
      description: "A fast ranged shot.",
      resource_cost: 2,
      cooldown_turns: 1,
      range: 4,
      damage_formula: { base: 6, stat_scaling: "accuracy", scaling_factor: 0.9 },
      effects: [],
      target: "single",
    },
  ]

  const enemyAbilities = [
    {
      id: "rat-bite",
      name: "Rat Bite",
      description: "A diseased bite.",
      resource_cost: 0,
      cooldown_turns: 0,
      range: "melee",
      damage_formula: { base: 4, stat_scaling: "attack", scaling_factor: 0.6 },
      effects: [],
      target: "single",
    },
    {
      id: "boss-smash",
      name: "Boss Smash",
      description: "A brutal overhead smash.",
      resource_cost: 0,
      cooldown_turns: 1,
      range: "melee",
      damage_formula: { base: 12, stat_scaling: "attack", scaling_factor: 0.8 },
      effects: [],
      target: "single",
    },
  ]

  const classes = [
    {
      id: "knight",
      name: "Knight",
      description: "Reliable front-line fighter for dev stack testing.",
      base_stats: createCharacterStats(32, 11, 12, 11, 4, 4),
      stat_growth: createCharacterStats(0.03, 0.02, 0.03, 0.02, 0.01, 0.01),
      stat_roll_ranges: {
        hp: [25, 40],
        attack: [8, 14],
        defense: [8, 14],
        accuracy: [8, 14],
        evasion: [2, 6],
        speed: [2, 6],
      },
      resource_type: "stamina",
      resource_max: 6,
      resource_regen_rule: { type: "passive", amount: 2, interval: 1 },
      starting_abilities: ["knight-shield-bash"],
      skill_tree: { tiers: [] },
      starting_equipment: ["iron-sword", "leather-armor"],
      visibility_radius: 4,
    },
    {
      id: "mage",
      name: "Mage",
      description: "Glass cannon for spell and resource tests.",
      base_stats: createCharacterStats(18, 15, 3, 13, 6, 9),
      stat_growth: createCharacterStats(0.02, 0.04, 0.01, 0.03, 0.02, 0.03),
      stat_roll_ranges: {
        hp: [12, 22],
        attack: [12, 18],
        defense: [2, 5],
        accuracy: [10, 16],
        evasion: [4, 8],
        speed: [6, 12],
      },
      resource_type: "mana",
      resource_max: 8,
      resource_regen_rule: { type: "passive", amount: 2, interval: 1 },
      starting_abilities: ["mage-arcane-bolt"],
      skill_tree: { tiers: [] },
      starting_equipment: ["health-potion"],
      visibility_radius: 5,
    },
    {
      id: "rogue",
      name: "Rogue",
      description: "Fast utility class for trap and movement tests.",
      base_stats: createCharacterStats(22, 10, 5, 13, 14, 16),
      stat_growth: createCharacterStats(0.03, 0.03, 0.01, 0.03, 0.05, 0.05),
      stat_roll_ranges: {
        hp: [16, 28],
        attack: [7, 13],
        defense: [3, 7],
        accuracy: [10, 16],
        evasion: [10, 18],
        speed: [12, 20],
      },
      resource_type: "energy",
      resource_max: 6,
      resource_regen_rule: { type: "burst-reset", amount: 6, interval: 3 },
      starting_abilities: ["rogue-disarm-trap"],
      skill_tree: { tiers: [] },
      starting_equipment: ["trap-kit", "health-potion"],
      visibility_radius: 4,
    },
    {
      id: "archer",
      name: "Archer",
      description: "Ranged accuracy test class.",
      base_stats: createCharacterStats(24, 11, 5, 17, 9, 11),
      stat_growth: createCharacterStats(0.03, 0.02, 0.01, 0.04, 0.03, 0.03),
      stat_roll_ranges: {
        hp: [18, 30],
        attack: [8, 14],
        defense: [3, 8],
        accuracy: [14, 20],
        evasion: [6, 12],
        speed: [8, 14],
      },
      resource_type: "focus",
      resource_max: 6,
      resource_regen_rule: { type: "passive", amount: 2, interval: 1 },
      starting_abilities: ["archer-quick-shot"],
      skill_tree: { tiers: [] },
      starting_equipment: ["iron-sword", "health-potion"],
      visibility_radius: 5,
    },
  ]

  const enemies = [
    {
      id: "weak-rat",
      name: "Weak Rat",
      stats: createCharacterStats(12, 5, 1, 45, 4, 5),
      abilities: ["rat-bite"],
      behavior: "aggressive",
      loot_table: "tutorial-loot",
      xp_value: 6,
      difficulty_tier: 0,
    },
    {
      id: "goblin",
      name: "Goblin",
      stats: createCharacterStats(18, 7, 2, 52, 8, 10),
      abilities: ["basic-attack"],
      behavior: "aggressive",
      loot_table: "arena-loot",
      xp_value: 12,
      difficulty_tier: 1,
    },
    {
      id: "skeleton",
      name: "Skeleton",
      stats: createCharacterStats(24, 9, 4, 58, 6, 7),
      abilities: ["basic-attack"],
      behavior: "aggressive",
      loot_table: "arena-loot",
      xp_value: 16,
      difficulty_tier: 1,
    },
    {
      id: "boss-troll",
      name: "Boss Troll",
      stats: createCharacterStats(65, 14, 7, 60, 4, 6),
      abilities: ["boss-smash"],
      behavior: "boss",
      loot_table: "boss-loot",
      xp_value: 45,
      difficulty_tier: 2,
      boss_phases: [
        { hp_threshold: 0.5, behavior_change: "enraged", abilities_added: [], abilities_removed: [] },
      ],
    },
  ]

  const items = [
    {
      id: "health-potion",
      name: "Health Potion",
      description: "Restores 20 HP.",
      type: "consumable",
      rarity: "common",
      stats: {},
      effects: [{ type: "heal-hp", magnitude: 20 }],
      stack_limit: 10,
      sell_price: 4,
      buy_price: 10,
      dungeon_tier: 0,
    },
    {
      id: "portal-scroll",
      name: "Portal Scroll",
      description: "Allows immediate extraction when no enemies remain in the room.",
      type: "consumable",
      rarity: "uncommon",
      stats: {},
      effects: [{ type: "portal-escape" }],
      stack_limit: 1,
      sell_price: 12,
      buy_price: 30,
      dungeon_tier: 0,
    },
    {
      id: "iron-sword",
      name: "Iron Sword",
      description: "Reliable starter blade.",
      type: "equipment",
      rarity: "common",
      equip_slot: "weapon",
      stats: { attack: 5, accuracy: 3 },
      stack_limit: 1,
      sell_price: 8,
      buy_price: 22,
      dungeon_tier: 1,
    },
    {
      id: "leather-armor",
      name: "Leather Armor",
      description: "Simple armor for testing equip flow.",
      type: "equipment",
      rarity: "common",
      equip_slot: "armor",
      stats: { defense: 4, evasion: 1 },
      stack_limit: 1,
      sell_price: 7,
      buy_price: 20,
      dungeon_tier: 1,
    },
    {
      id: "trap-kit",
      name: "Trap Kit",
      description: "Rogue utility kit used for trap interactions.",
      type: "key-item",
      rarity: "common",
      stats: {},
      effects: [],
      stack_limit: 1,
      sell_price: 0,
      buy_price: 0,
      dungeon_tier: 0,
    },
    {
      id: "rusty-key",
      name: "Rusty Key",
      description: "Opens the locked gate in the test dungeon.",
      type: "key-item",
      rarity: "common",
      stats: {},
      effects: [],
      stack_limit: 1,
      sell_price: 0,
      buy_price: 0,
      dungeon_tier: 0,
    },
    {
      id: "gold-coins",
      name: "Gold Coins",
      description: "Currency for loot summary tests.",
      type: "loot",
      rarity: "common",
      stats: {},
      effects: [],
      stack_limit: 99,
      sell_price: 1,
      buy_price: 0,
      dungeon_tier: 0,
    },
  ]

  const tutorialRoomLoot = {
    id: "tutorial-loot",
    entries: [
      { item_template_id: "health-potion", weight: 60, quantity: { min: 1, max: 1 } },
      { item_template_id: "gold-coins", weight: 40, quantity: { min: 10, max: 12 } },
    ],
  }

  const arenaLoot = {
    id: "arena-loot",
    entries: [
      { item_template_id: "iron-sword", weight: 30, quantity: { min: 1, max: 1 } },
      { item_template_id: "leather-armor", weight: 30, quantity: { min: 1, max: 1 } },
      { item_template_id: "health-potion", weight: 40, quantity: { min: 1, max: 2 } },
    ],
  }

  const bossLoot = {
    id: "boss-loot",
    entries: [
      { item_template_id: "portal-scroll", weight: 50, quantity: { min: 1, max: 1 } },
      { item_template_id: "gold-coins", weight: 50, quantity: { min: 30, max: 35 } },
    ],
  }

  const tutorialRealm = {
    id: "test-tutorial",
    orderIndex: 0,
    name: "Test Tutorial",
    description: "Three-room realm for movement, combat, loot, and extraction.",
    theme: "training-cellar",
    version: 1,
    procedural: false,
    floor_count: { min: 1, max: 1 },
    difficulty_tier: 0,
    room_distribution: { combat: 0.34, treasure: 0.33, trap: 0, rest: 0, event: 0.33, boss: 0 },
    enemy_roster: ["weak-rat"],
    boss_id: null,
    loot_tables: [tutorialRoomLoot],
    trap_types: [],
    room_templates: [
      "test-tutorial-entry",
      "test-tutorial-combat",
      "test-tutorial-exit",
    ],
    narrative: {
      theme_description: "A compact training realm for SDK smoke tests.",
      room_text_pool: [
        { text: "The tutorial chamber is quiet.", type: "event" },
        { text: "A weak rat hisses near the exit.", type: "combat" },
      ],
      lore_pool: ["tutorial-note"],
      interactable_pool: ["tutorial-cache"],
    },
    completion_rewards: { xp: 18, gold: 12 },
  }

  const arenaRealm = {
    id: "test-arena",
    orderIndex: 1,
    name: "Test Arena",
    description: "Single-room combat sandbox with scattered loot.",
    theme: "arena",
    version: 1,
    procedural: false,
    floor_count: { min: 1, max: 1 },
    difficulty_tier: 1,
    room_distribution: { combat: 1, treasure: 0, trap: 0, rest: 0, event: 0, boss: 0 },
    enemy_roster: ["goblin", "skeleton"],
    boss_id: null,
    loot_tables: [arenaLoot],
    trap_types: [],
    room_templates: ["test-arena-gauntlet"],
    narrative: {
      theme_description: "An isolated arena used to validate combat and inventory behavior.",
      room_text_pool: [{ text: "The arena floor is littered with weapons and broken shields.", type: "combat" }],
      lore_pool: [],
      interactable_pool: [],
    },
    completion_rewards: { xp: 24, gold: 18 },
  }

  const trapTemplate = {
    id: "spike-trap",
    name: "Spike Trap",
    damage: 8,
    effect: { type: "bleed", magnitude: 2, duration: 3 },
    detection_difficulty: 8,
    visible_after_trigger: true,
  }

  const dungeonRealm = {
    id: "test-dungeon",
    orderIndex: 2,
    name: "Test Dungeon",
    description: "Two-floor validation dungeon covering all supported action types.",
    theme: "ruined-keep",
    version: 1,
    procedural: false,
    floor_count: { min: 2, max: 2 },
    difficulty_tier: 2,
    room_distribution: { combat: 0.4, treasure: 0.2, trap: 0.2, rest: 0, event: 0.2, boss: 0 },
    enemy_roster: ["goblin", "skeleton", "boss-troll"],
    boss_id: "boss-troll",
    loot_tables: [arenaLoot, bossLoot],
    trap_types: [trapTemplate],
    room_templates: [
      "test-dungeon-entry",
      "test-dungeon-trap-hall",
      "test-dungeon-stairs",
      "test-dungeon-antechamber",
      "test-dungeon-boss",
    ],
    narrative: {
      theme_description: "A compact two-floor dungeon assembled for integration coverage.",
      room_text_pool: [
        { text: "The dungeon corridor narrows toward a suspicious chest.", type: "trap" },
        { text: "A locked gate bars the way to the inner sanctum.", type: "event" },
      ],
      lore_pool: ["dungeon-warning"],
      interactable_pool: ["test-dungeon-gate"],
    },
    completion_rewards: { xp: 45, gold: 30 },
  }

  const tutorialEntryRoom = {
    id: "test-tutorial-entry",
    type: "event",
    size: { width: 5, height: 5 },
    text_first_visit: "You arrive in a compact entry chamber. A satchel hangs beside the exit.",
    text_revisit: "The training chamber remains quiet.",
    interactables: [
      {
        id: "tutorial-cache",
        name: "Travel Satchel",
        text_on_interact: "Inside are a portal scroll and a note about surviving the trial.",
        conditions: [],
        effects: [
          { type: "grant-item", item_template_id: "portal-scroll" },
          { type: "show-text", text: "Remember: clear the room, then use the portal." },
        ],
        lore_entry_id: "tutorial-note",
      },
    ],
    enemy_slots: [],
    loot_slots: [],
    triggers: [],
  }

  const tutorialCombatRoom = {
    id: "test-tutorial-combat",
    type: "combat",
    size: { width: 7, height: 7 },
    text_first_visit: "A weak rat blocks the path forward.",
    text_revisit: "The room smells faintly of damp straw.",
    interactables: [],
    enemy_slots: [
      {
        enemy_template_id: "weak-rat",
        position: { x: 4, y: 2 },
        count: { min: 1, max: 1 },
      },
    ],
    loot_slots: [],
    triggers: [],
  }

  const tutorialExitRoom = {
    id: "test-tutorial-exit",
    type: "treasure",
    size: { width: 5, height: 5 },
    text_first_visit: "A supply crate sits by the exit arch.",
    text_revisit: "The crate lies open beside the archway.",
    interactables: [
      {
        id: "tutorial-exit-crate",
        name: "Supply Crate",
        text_on_interact: "The crate contains a healing potion and a few coins.",
        conditions: [],
        effects: [
          { type: "grant-item", item_template_id: "health-potion" },
          { type: "grant-gold", amount: 8 },
        ],
        lore_entry_id: null,
      },
    ],
    enemy_slots: [],
    loot_slots: [],
    triggers: [],
  }

  const arenaRoom = {
    id: "test-arena-gauntlet",
    type: "combat",
    size: { width: 9, height: 9 },
    text_first_visit: "Three foes circle the arena floor around scattered supplies.",
    text_revisit: "The arena floor is scarred from recent fighting.",
    interactables: [
      {
        id: "arena-exit-cache",
        name: "Arena Exit Cache",
        text_on_interact: "A hidden cache slides open, revealing a portal scroll for the victor.",
        conditions: [{ type: "room-cleared" }],
        effects: [{ type: "grant-item", item_template_id: "portal-scroll" }],
        lore_entry_id: null,
      },
    ],
    enemy_slots: [
      { enemy_template_id: "goblin", position: { x: 5, y: 2 }, count: { min: 1, max: 1 } },
      { enemy_template_id: "goblin", position: { x: 2, y: 5 }, count: { min: 1, max: 1 } },
      { enemy_template_id: "skeleton", position: { x: 6, y: 6 }, count: { min: 1, max: 1 } },
    ],
    loot_slots: [
      { loot_table_id: "arena-loot", container: "floor-drop", position: { x: 4, y: 4 } },
      { loot_table_id: "arena-loot", container: "hidden", position: { x: 1, y: 7 } },
    ],
    triggers: [],
  }

  const dungeonEntryRoom = {
    id: "test-dungeon-entry",
    type: "event",
    size: { width: 7, height: 7 },
    text_first_visit: "An iron gate and a dusty key pedestal greet you.",
    text_revisit: "The entry chamber is still.",
    interactables: [
      {
        id: "dungeon-key-pedestal",
        name: "Key Pedestal",
        text_on_interact: "A rusty key rests on the pedestal.",
        conditions: [],
        effects: [{ type: "grant-item", item_template_id: "rusty-key" }],
        lore_entry_id: null,
      },
    ],
    enemy_slots: [],
    loot_slots: [],
    triggers: [],
  }

  const dungeonTrapRoom = {
    id: "test-dungeon-trap-hall",
    type: "treasure",
    size: { width: 7, height: 7 },
    text_first_visit: "A suspicious chest waits in the center of the hall.",
    text_revisit: "The trap hall has already sprung its surprises.",
    interactables: [],
    enemy_slots: [
      { enemy_template_id: "goblin", position: { x: 5, y: 4 }, count: { min: 1, max: 1 } },
    ],
    loot_slots: [
      {
        loot_table_id: "arena-loot",
        container: "chest",
        position: { x: 3, y: 3 },
        trapped: true,
        trap_damage: 8,
        trap_effect: { type: "poison", magnitude: 2, duration: 3 },
      },
    ],
    triggers: [],
  }

  const dungeonStairsRoom = {
    id: "test-dungeon-stairs",
    type: "event",
    size: { width: 7, height: 7 },
    text_first_visit: "The corridor bends toward a stairwell descending deeper.",
    text_revisit: "The stairwell waits in silence.",
    interactables: [
      {
        id: "test-dungeon-gate",
        name: "Locked Gate Lever",
        text_on_interact: "The rusty key turns and the gate unlocks with a groan.",
        conditions: [{ type: "has-item", item_id: "rusty-key" }],
        effects: [
          { type: "unlock-door", entity_id: "test-dungeon-gate" },
          { type: "consume-item", item_id: "rusty-key" },
        ],
        lore_entry_id: "dungeon-warning",
      },
    ],
    enemy_slots: [],
    loot_slots: [],
    triggers: [],
    locked_exit: "test-dungeon-gate",
  }

  const dungeonAntechamber = {
    id: "test-dungeon-antechamber",
    type: "combat",
    size: { width: 7, height: 7 },
    text_first_visit: "An antechamber stands between you and the boss.",
    text_revisit: "The antechamber bears fresh battle marks.",
    interactables: [],
    enemy_slots: [
      { enemy_template_id: "skeleton", position: { x: 4, y: 4 }, count: { min: 1, max: 1 } },
    ],
    loot_slots: [
      { loot_table_id: "arena-loot", container: "floor-drop", position: { x: 2, y: 5 } },
    ],
    triggers: [],
  }

  const dungeonBossRoom = {
    id: "test-dungeon-boss",
    type: "boss",
    size: { width: 9, height: 9 },
    text_first_visit: "The boss troll roars from the far side of the chamber.",
    text_revisit: "The boss chamber trembles with lingering force.",
    interactables: [
      {
        id: "boss-cache",
        name: "Boss Cache",
        text_on_interact: "A portal scroll and coin pouch are tucked away behind the throne.",
        conditions: [{ type: "room-cleared" }],
        effects: [
          { type: "grant-item", item_template_id: "portal-scroll" },
          { type: "grant-gold", amount: 20 },
        ],
        lore_entry_id: null,
      },
    ],
    enemy_slots: [
      { enemy_template_id: "boss-troll", position: { x: 6, y: 4 }, count: { min: 1, max: 1 } },
    ],
    loot_slots: [
      { loot_table_id: "boss-loot", container: "chest", position: { x: 4, y: 5 } },
    ],
    triggers: [],
  }

  return [
    { file: "abilities/shared.json", value: [basicAttack] },
    { file: "abilities/class-abilities.json", value: classAbilities },
    { file: "abilities/enemy-abilities.json", value: enemyAbilities },
    { file: "classes/knight.json", value: classes[0] as JsonObject },
    { file: "classes/mage.json", value: classes[1] as JsonObject },
    { file: "classes/rogue.json", value: classes[2] as JsonObject },
    { file: "classes/archer.json", value: classes[3] as JsonObject },
    { file: "enemies/core.json", value: enemies },
    { file: "items/core.json", value: items },
    { file: "realms/test-tutorial.json", value: tutorialRealm },
    { file: "realms/test-arena.json", value: arenaRealm },
    { file: "realms/test-dungeon.json", value: dungeonRealm },
    { file: "rooms/test-tutorial/test-tutorial-entry.json", value: tutorialEntryRoom },
    { file: "rooms/test-tutorial/test-tutorial-combat.json", value: tutorialCombatRoom },
    { file: "rooms/test-tutorial/test-tutorial-exit.json", value: tutorialExitRoom },
    { file: "rooms/test-arena/test-arena-gauntlet.json", value: arenaRoom },
    { file: "rooms/test-dungeon/test-dungeon-entry.json", value: dungeonEntryRoom },
    { file: "rooms/test-dungeon/test-dungeon-trap-hall.json", value: dungeonTrapRoom },
    { file: "rooms/test-dungeon/test-dungeon-stairs.json", value: dungeonStairsRoom },
    { file: "rooms/test-dungeon/test-dungeon-antechamber.json", value: dungeonAntechamber },
    { file: "rooms/test-dungeon/test-dungeon-boss.json", value: dungeonBossRoom },
  ]
}

async function ensureParent(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
}

export async function syncDevEngine(): Promise<void> {
  const schemaSource = await readFile(SCHEMAS_FILE, "utf8")
  await mkdir(DEV_ENGINE_DIR, { recursive: true })
  await mkdir(DEV_CONTENT_DIR, { recursive: true })

  await writeFile(path.join(DEV_ENGINE_DIR, "types.ts"), generateTypesSource(schemaSource), "utf8")

  for (const fileName of ENGINE_FILES) {
    const sourcePath = path.join(ENGINE_SOURCE_DIR, fileName)
    const destinationPath = path.join(DEV_ENGINE_DIR, fileName)
    const source = await readFile(sourcePath, "utf8")
    await writeFile(destinationPath, rewriteEngineImports(source), "utf8")
  }

  await writeFile(path.join(DEV_ENGINE_DIR, "content.ts"), generateContentSource(), "utf8")
  await writeFile(path.join(DEV_ENGINE_DIR, "index.ts"), generateIndexSource(), "utf8")

  for (const entry of buildDevContent()) {
    const destinationPath = path.join(DEV_CONTENT_DIR, entry.file)
    await ensureParent(destinationPath)
    await writeFile(destinationPath, prettyJson(entry.value), "utf8")
  }

  console.log("Synced Agent SDK dev engine and generated local dev content.")
}

if (import.meta.main) {
  syncDevEngine().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
