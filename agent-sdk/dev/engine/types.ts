// Vendored from shared/schemas/src/index.ts for the local dev engine.
// Re-export SDK protocol types first, then append the additional engine-only schema contracts.

import type {
  PlayerType,
  CharacterClass,
  ResourceType,
  CharacterStats,
  Observation,
  LobbyEvent,
  ActiveEffect,
  InventoryItem,
  EquipSlot,
  ItemType,
  ItemRarity,
  Tile,
  StatusEffect,
  EnemyBehavior,
  KnownMapData,
  GameEvent,
} from "../../src/protocol.js"

export * from "../../src/protocol.js"

export const BASE_INVENTORY_SLOTS = 12

export function getInventoryCapacity(capacityBonus = 0): number {
  return BASE_INVENTORY_SLOTS + Math.max(0, capacityBonus)
}

export interface ItemEffect {
  type: "heal-hp" | "restore-resource" | "cure-debuffs" | "portal-escape" | "buff" | "reveal-map"
  magnitude?: number
  duration?: number
}

export interface Account {
  id: string
  wallet_address: string
  player_type: PlayerType
  handle?: string
  x_handle?: string
  github_handle?: string
  free_realm_used: boolean
  created_at: string
}

export type CharacterStatus = "alive" | "dead"

export interface Character {
  id: string
  account_id: string
  name: string
  class: CharacterClass
  level: number
  xp: number
  gold: number
  hp_current: number
  hp_max: number
  resource_current: number
  resource_max: number
  resource_type: ResourceType
  stats: CharacterStats
  effective_stats: CharacterStats // after equipment + buffs
  skill_tree: Record<string, string>
  status: CharacterStatus
  stat_rerolled: boolean
  lore_discovered?: LoreDiscovery[]
  created_at: string
  died_at?: string
}

// ---- Game State (in-memory session model) -------------------

export type MutationType =
  | "killed"
  | "opened"
  | "trap_triggered"
  | "unlocked"
  | "looted"
  | "used"
  | "discovered"

/** A permanent world state change written to realm_mutations */

export interface WorldMutation {
  entity_id: string          // deterministic ID from generateRealm(), e.g. f1_r2_encounter_01_enemy_00
  mutation: MutationType
  floor: number
  metadata: Record<string, unknown>
}

export interface LoreDiscovery {
  lore_entry_id: string
  discovered_at_turn: number
}

/** Result of resolving a single turn via the engine */

export interface TurnResult {
  newState: GameState
  worldMutations: WorldMutation[]   // empty for moves/waits, populated for kills/opens/etc.
  observation: Observation
  summary: string                   // human-readable description for event buffer
  roomChanged: boolean              // true if player entered a new room
  notableEvents: LobbyEvent[]      // deaths, boss kills, completions → lobby feed
}

/** Full in-memory game state held by the server during a session */

export interface GameState {
  turn: number
  realm: {
    template_id: string
    template_version: number
    seed: number
    total_floors: number
  }
  character: {
    id: string
    class: CharacterClass
    level: number
    xp: number
    gold: number
    hp: { current: number; max: number }
    resource: { type: ResourceType; current: number; max: number }
    stats: CharacterStats
    effective_stats: CharacterStats
    buffs: ActiveEffect[]
    debuffs: ActiveEffect[]
    abilities: string[]
    cooldowns: Record<string, number>
    skill_tree: Record<string, boolean>
  }
  position: {
    floor: number
    room_id: string
    tile: { x: number; y: number }
  }
  inventory: InventoryItem[]
  equipment: Record<EquipSlot, InventoryItem | null>
  /** Current floor/room layouts with entities (post-mutation) */
  activeFloor: {
    rooms: Array<{
      id: string
      tiles: Tile[][]
      enemies: Array<{
        id: string
        template_id: string
        hp: number
        hp_max: number
        position: { x: number; y: number }
        effects: ActiveEffect[]
        cooldowns: Record<string, number>
        boss_phase_index?: number
        /** Multiplicative stat modifiers applied at runtime (e.g. brazier weakening) */
        defense_modifier?: number
      }>
      items: Array<{
        id: string
        template_id: string
        quantity?: number
        position: { x: number; y: number }
        trapped?: boolean
        trap_damage?: number
        trap_effect?: StatusEffect | null
        trap_disarmed?: boolean
      }>
    }>
  }
  /** Tiles the player has seen — persisted to realm_discovered_map */
  discoveredTiles: Record<number, Array<{ x: number; y: number }>>
  /** Room IDs the player has already entered on each floor. */
  roomsVisited?: Record<number, string[]>
  /** Lore entries discovered during this life. */
  loreDiscovered?: LoreDiscovery[]
  /** IDs of entities that have been mutated (killed, opened, looted, used, etc.) */
  mutatedEntities: string[]
  /** Quest flags set by grant-quest-flag effects (e.g. brazier-north-lit) */
  questFlags?: string[]
  /** Realm completion state */
  realmStatus: "active" | "boss_floor" | "boss_cleared" | "realm_cleared"
  /** Portal escape is armed for extraction */
  portalActive?: boolean
}

// ---- Realm --------------------------------------------------

export type RealmStatus =
  | "generated"
  | "active"
  | "paused"
  | "boss_cleared"
  | "realm_cleared"
  | "completed"
  | "dead_end"

export interface RealmInstance {
  id: string
  character_id: string
  template_id: string
  template_version: number
  seed: number
  status: RealmStatus
  floor_reached: number
  is_free: boolean
  completions: number
  created_at: string
}

// ---- Tiles & Map --------------------------------------------

export interface SpectatorEntity {
  id: string
  type: "enemy" | "item" | "interactable"
  name: string
  template_id?: string
  position: { x: number; y: number }
  health_indicator?: "full" | "high" | "medium" | "low" | "critical"
  behavior?: EnemyBehavior
  is_boss?: boolean
}

// ---- Game Events --------------------------------------------

/**
 * Generic game event emitted by the engine. `type` is an open string so new events can be added
 * without breaking the schema contract, but certain well-known types have a documented `data`
 * shape that agents / clients can rely on:
 *
 *   - `"interact_blocked"`: emitted when an `interact` action fails a condition. `data` fields:
 *       - `target_id: string` — interactable entity id
 *       - `reason: "missing-item" | "enemy-not-defeated" | "room-not-cleared" | "missing-flag" | "already-used"`
 *       - `required_template_id?: string` — only for `reason === "missing-item"`, the item template
 *         id that satisfies the condition
 *       - `required_entity_id?: string` — only for `reason === "enemy-not-defeated"`
 *       - `required_flag?: string` — only for `reason === "missing-flag"`
 *       - `is_locked_exit?: boolean` — true when the target is the room's locked exit
 *
 *   - `"blocked"`: generic "path/action blocked" — existing, unchanged. `data.direction` for
 *      blocked movement, `data.action` for other blocked action types.
 */

export interface SpectatorObservation {
  turn: number
  character: {
    id: string
    name: string
    class: CharacterClass
    level: number
    hp_percent: number
    resource_percent: number
  }
  position: {
    floor: number
    room_id: string
    tile: { x: number; y: number }
  }
  visible_tiles: Tile[]
  known_map: KnownMapData
  visible_entities: SpectatorEntity[]
  room_text: string | null
  recent_events: GameEvent[]
  realm_info: {
    template_id: string
    template_name: string
    current_floor: number
    entrance_room_id: string
    status: "active" | "boss_floor" | "boss_cleared" | "realm_cleared"
  }
}

/** Public row for GET /spectate/active (redacted fields only; same process in-memory as WS spectate). */

export interface SpectatableSessionSummary {
  character_id: string
  turn: number
  character: SpectatorObservation["character"]
  realm_info: SpectatorObservation["realm_info"]
  position: Pick<SpectatorObservation["position"], "floor" | "room_id">
}

export interface ActiveSpectateListResponse {
  sessions: SpectatableSessionSummary[]
}

// ---- Actions ------------------------------------------------

export interface AbilityTemplate {
  id: string
  name: string
  description: string
  resource_cost: number
  cooldown_turns: number
  range: "melee" | number
  damage_formula: {
    base: number
    stat_scaling: string
    scaling_factor: number
  }
  effects: StatusEffect[]
  target: "single" | "aoe" | "self" | "single-or-self" | "single_or_self"
  aoe_radius?: number
  special?: string             // engine-hardcoded behavior (e.g. "counter_on_hit", "disarm_trap")
}

export interface ItemTemplate {
  id: string
  name: string
  type: ItemType
  rarity: ItemRarity
  equip_slot?: EquipSlot
  stats?: Partial<CharacterStats>
  effects?: ItemEffect[]
  stack_limit: number
  sell_price: number
  buy_price: number
  class_restriction?: string
  description: string
  dungeon_tier?: number
  ammo_type?: string
}

export interface SkillNodeTemplate {
  id: string
  name: string
  description: string
  cost: number
  prerequisites: string[]
  effect: {
    type: "grant-ability" | "passive-stat" | "passive-effect"
    ability_id?: string
    stat?: string
    value?: number
    description?: string
  }
}

export interface SkillTier {
  tier: number
  unlock_level: number
  choices: SkillNodeTemplate[]
}

export interface ClassTemplate {
  id: CharacterClass
  name: string
  base_stats: CharacterStats
  stat_growth: CharacterStats
  stat_roll_ranges: Record<keyof CharacterStats, [number, number]>
  resource_type: ResourceType
  resource_max: number
  resource_regen_rule: {
    type: "passive" | "burst_reset" | "burst-reset" | "accumulate" | "none"
    amount?: number
    interval?: number
    on_defend_bonus?: number
  }
  starting_abilities: string[]
  skill_tree: { tiers: SkillTier[] }
  starting_equipment: string[]
  visibility_radius: number
}

export interface BossPhase {
  hp_threshold: number
  behavior_change: string
  abilities_added: string[]
  abilities_removed: string[]
}

export interface EnemyTemplate {
  id: string
  name: string
  stats: CharacterStats
  abilities: string[]
  behavior: EnemyBehavior
  boss_phases?: BossPhase[]
  loot_table: string
  xp_value: number
  difficulty_tier: number
}

export interface LootEntry {
  item_template_id: string
  weight: number
  quantity: { min: number; max: number }
}

export interface LootTable {
  id: string
  entries: LootEntry[]
}

export interface TrapTemplate {
  id: string
  name: string
  damage: number
  effect?: StatusEffect
  detection_difficulty: number
  visible_after_trigger: boolean
}

// ---- Room Templates -----------------------------------------

export interface InteractableTemplate {
  id: string
  name: string
  text_on_interact: string
  conditions: Condition[]
  effects: Effect[]
  lore_entry_id: string | null
}

export type Condition =
  | { type: "first-visit" }
  | { type: "has-item"; item_id: string }
  | { type: "class-is"; class: string }
  | { type: "enemy-defeated"; entity_id: string }
  | { type: "room-cleared" }
  | { type: "room-visited"; room_id: string }
  | { type: "floor-depth-gte"; depth: number }
  | { type: "hp-below"; percent: number }
  | { type: "has-flag"; flag: string }

export type Effect =
  | { type: "reveal-lore"; lore_id: string }
  | { type: "grant-quest-flag"; flag: string }
  | { type: "unlock-door"; entity_id: string }
  | { type: "spawn-enemy"; enemy_template_id: string; position: { x: number; y: number } }
  | { type: "apply-buff"; buff: StatusEffect }
  | { type: "apply-debuff"; debuff: StatusEffect }
  | { type: "grant-item"; item_template_id: string; quantity?: number }
  | { type: "grant-gold"; amount: number }
  | { type: "show-text"; text: string }
  | { type: "heal-hp"; amount: number }
  | { type: "cure-debuffs" }
  | { type: "modify-enemy-stat"; entity_id: string; stat: string; modifier: number }
  | { type: "consume-item"; item_id: string }

export interface TriggerTemplate {
  conditions: Condition[]
  effects: Effect[]
  fire_once: boolean
  trigger_on?: string      // "interact", "interact_failed", "interact_complete", etc.
  target_id?: string       // entity ID the trigger is attached to
}

export interface EnemySlot {
  enemy_template_id: string  // or "random_from_roster"
  position: { x: number; y: number } | "random"
  count: { min: number; max: number }
}

export interface LootSlot {
  loot_table_id: string
  container: "chest" | "floor-drop" | "hidden"
  position?: { x: number; y: number } | "random"
  trapped?: boolean
  trap_damage?: number
  trap_effect?: StatusEffect | null
}

export type RoomType = "combat" | "treasure" | "rest" | "event" | "boss"

export interface RoomTemplate {
  id: string
  type: RoomType
  size: { width: number; height: number }
  text_first_visit: string
  text_revisit: string | null
  interactables: InteractableTemplate[]
  enemy_slots: EnemySlot[]
  loot_slots: LootSlot[]
  triggers: TriggerTemplate[]
  /** Interactable ID that locks the forward (right) exit. Door is not placed
   *  until this interactable is used (unlock-door effect marks it mutated). */
  locked_exit?: string
}

// ---- Realm Templates ----------------------------------------

export interface RealmTemplate {
  id: string
  orderIndex: number
  name: string
  description: string
  theme: string
  version: number
  is_tutorial?: boolean
  procedural?: boolean                  // false = fully handcrafted layout
  floor_count: { min: number; max: number }
  difficulty_tier: number
  room_distribution: {
    combat: number
    treasure: number
    trap: number
    rest: number
    event: number
    boss: number
  }
  enemy_roster: string[]
  boss_id: string | null                // null for dungeons with no boss
  loot_tables: LootTable[]
  trap_types: TrapTemplate[]
  room_templates: string[]
  narrative: {
    theme_description: string
    room_text_pool: Array<{ text: string; type: string }>
    lore_pool: string[]
    interactable_pool: string[]
  }
  completion_rewards: {
    xp: number
    gold: number
  }
}

// ---- Leaderboard & Legends ----------------------------------
