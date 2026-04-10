// ============================================================
// @adventure-fun/schemas — Canonical TypeScript types
// Single source of truth for engine, server, agent-sdk, web
// ============================================================

// ---- Stats --------------------------------------------------

export interface Stats {
  attack: number
  defense: number
  accuracy: number
  evasion: number
  speed: number
}

export interface CharacterStats extends Stats {
  hp: number
}

// ---- Status Effects -----------------------------------------

export type StatusEffectType =
  | "poison"
  | "stun"
  | "slow"
  | "blind"
  | "buff-attack"
  | "buff-defense"

export interface StatusEffect {
  type: StatusEffectType
  duration_turns: number
  magnitude: number
  apply_chance: number // 0-1
}

export interface ActiveEffect {
  type: StatusEffectType
  turns_remaining: number
  magnitude: number
}

export interface AbilitySummary {
  id: string
  name: string
  description: string
  resource_cost: number
  cooldown_turns: number
  current_cooldown: number
  range: "melee" | number
  target: "single" | "aoe" | "self" | "single-or-self" | "single_or_self"
}

// ---- Items --------------------------------------------------

export type ItemType = "consumable" | "equipment" | "loot" | "key-item"
export type ItemRarity = "common" | "uncommon" | "rare" | "epic"
export type EquipSlot = "weapon" | "armor" | "helm" | "hands" | "accessory"
export type OwnerType = "character" | "escrow" | "corpse"

export const BASE_INVENTORY_SLOTS = 12

export function getInventoryCapacity(capacityBonus = 0): number {
  return BASE_INVENTORY_SLOTS + Math.max(0, capacityBonus)
}

export interface ItemEffect {
  type: "heal-hp" | "restore-resource" | "cure-debuffs" | "portal-escape" | "buff" | "reveal-map"
  magnitude?: number
  duration?: number
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

export interface InventoryItem {
  id: string
  template_id: string
  name: string
  quantity: number
  modifiers: Record<string, number>
  owner_type: OwnerType
  owner_id: string
  slot?: EquipSlot | null
}

export interface InventorySlot {
  item_id: string
  template_id: string
  name: string
  quantity: number
  modifiers: Record<string, number>
}

// ---- Character & Account ------------------------------------

export type PlayerType = "human" | "agent"
export type CharacterClass = "knight" | "mage" | "rogue" | "archer"
export type CharacterStatus = "alive" | "dead"
export type ResourceType = "stamina" | "mana" | "energy" | "focus"

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
  created_at: string
}

// ---- Tiles & Map --------------------------------------------

export type TileType = "floor" | "wall" | "door" | "stairs" | "stairs_up" | "entrance"

export interface Tile {
  x: number
  y: number
  type: TileType
  entities: string[] // entity IDs on this tile
}

export interface KnownMapData {
  floors: Record<number, KnownFloor>
}

export interface KnownFloor {
  tiles: Tile[]
  rooms_visited: string[]
}

// ---- Entities -----------------------------------------------

export type EntityType = "enemy" | "item" | "interactable" | "trap_visible"

export interface Entity {
  id: string
  type: EntityType
  name: string
  position: { x: number; y: number }
  rarity?: ItemRarity
  hp_current?: number
  hp_max?: number
  effects?: ActiveEffect[]
  behavior?: EnemyBehavior
  is_boss?: boolean
  trapped?: boolean
}

export interface SpectatorEntity {
  id: string
  type: "enemy" | "item" | "interactable"
  name: string
  position: { x: number; y: number }
  health_indicator?: "full" | "high" | "medium" | "low" | "critical"
  behavior?: EnemyBehavior
  is_boss?: boolean
}

// ---- Game Events --------------------------------------------

export interface GameEvent {
  turn: number
  type: string
  detail: string
  data: Record<string, unknown>
}

// ---- Observation (full — player only) -----------------------

export interface Observation {
  turn: number
  character: {
    id: string
    class: CharacterClass
    level: number
    xp: number
    xp_to_next_level: number
    skill_points: number
    hp: { current: number; max: number }
    resource: { type: ResourceType; current: number; max: number }
    buffs: ActiveEffect[]
    debuffs: ActiveEffect[]
    cooldowns: Record<string, number>
    abilities: AbilitySummary[]
    base_stats: CharacterStats
    effective_stats: CharacterStats
    skill_tree: Record<string, boolean>
  }
  inventory: InventorySlot[]
  new_item_ids?: string[]
  inventory_slots_used: number
  inventory_capacity: number
  equipment: Record<EquipSlot, InventoryItem | null>
  gold: number
  position: {
    floor: number
    room_id: string
    tile: { x: number; y: number }
  }
  visible_tiles: Tile[]
  known_map: KnownMapData
  visible_entities: Entity[]
  room_text: string | null
  recent_events: GameEvent[]
  legal_actions: Action[]
  realm_info: {
    template_name: string
    floor_count: number
    current_floor: number
    status: "active" | "boss_floor" | "boss_cleared" | "realm_cleared"
  }
}

// ---- SpectatorObservation (redacted — public) ---------------

export interface SpectatorObservation {
  turn: number
  character: {
    id: string
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
    template_name: string
    current_floor: number
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

export type Action =
  | { type: "move"; direction: "up" | "down" | "left" | "right" }
  | { type: "attack"; target_id: string; ability_id?: string }
  | { type: "disarm_trap"; item_id: string }
  | { type: "use_item"; item_id: string; target_id?: string }
  | { type: "equip"; item_id: string }
  | { type: "unequip"; slot: EquipSlot }
  | { type: "inspect"; target_id: string }
  | { type: "interact"; target_id: string }
  | { type: "use_portal" }
  | { type: "retreat" }
  | { type: "wait" }
  | { type: "pickup"; item_id: string }
  | { type: "drop"; item_id: string }

// ---- WebSocket Messages -------------------------------------

export type ServerMessage =
  | { type: "observation"; data: Observation }
  | { type: "error"; message: string }
  | { type: "death"; data: { cause: string; floor: number; room: string; turn: number } }
  | {
      type: "extracted"
      data: {
        loot_summary: InventorySlot[]
        xp_gained: number
        gold_gained: number
        completion_bonus?: { xp: number; gold: number }
        realm_completed: boolean
      }
    }

export type ClientMessage =
  | { type: "action"; data: Action }

// ---- Content Templates (from CONTENT.md) --------------------

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

export type EnemyBehavior = "aggressive" | "defensive" | "patrol" | "ambush" | "boss"

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

export interface LeaderboardEntry {
  character_id: string
  character_name: string
  class: CharacterClass
  player_type: PlayerType
  level: number
  xp: number
  deepest_floor: number
  realms_completed: number
  status: CharacterStatus
  cause_of_death: string | null
  owner: {
    handle: string
    wallet: string
    x_handle: string | null
    github_handle: string | null
  }
  created_at: string
  died_at: string | null
}

export interface LegendPage {
  character: {
    id: string
    name: string
    class: CharacterClass
    level: number
    xp: number
    stats: CharacterStats
    skill_tree: Record<string, string>
    equipment_at_death: Record<EquipSlot, InventoryItem | null>
    gold_at_death: number
  }
  owner: {
    handle: string
    player_type: PlayerType
    wallet: string
    x_handle: string | null
    github_handle: string | null
  }
  history: {
    realms_completed: number
    deepest_floor: number
    enemies_killed: number
    turns_survived: number
    cause_of_death: string
    death_floor: number
    death_room: string
    created_at: string
    died_at: string
  }
}

// ---- Marketplace --------------------------------------------

export interface MarketplaceListing {
  id: string
  seller: {
    handle: string
    wallet: string
    character_name: string
    character_class: CharacterClass
    character_status: CharacterStatus
  }
  item: {
    template_id: string
    name: string
    type: ItemType
    rarity: ItemRarity
    stats: Record<string, number>
    modifiers: Record<string, number>
    description: string
  }
  price_usd: string
  listing_fee_gold: number
  status: "active" | "sold" | "cancelled"
  is_orphaned: boolean
  created_at: string
  sold_at: string | null
}

// ---- Real-time (Redis pub/sub payloads) ---------------------

export interface LobbyEvent {
  type: string
  characterName: string
  characterClass: CharacterClass
  detail: string
  timestamp: number
}

export interface SanitizedChatMessage {
  character_name: string
  character_class: CharacterClass
  player_type: PlayerType
  message: string
  timestamp: number
}

export interface LeaderboardDelta {
  characterId: string
  xp: number
  level: number
  deepestFloor: number
}

// ---- x402 Payment -------------------------------------------

export interface PaymentAcceptOption402 {
  scheme: "exact"
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds?: number
  extra?: Record<string, unknown>
}

export interface PaymentRequired402 {
  x402Version: 2
  accepts: PaymentAcceptOption402[]
  description?: string
  mimeType?: string
}
