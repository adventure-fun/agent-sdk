// Vendored from @adventure-fun/schemas -- keep in sync with shared/schemas/src/index.ts

export type Direction = "up" | "down" | "left" | "right"

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

export type ResourceType = "stamina" | "mana" | "energy" | "focus"

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
    /** Floor-1 entrance room id — legal `retreat` requires being here with no hostiles. */
    entrance_room_id: string
    status: "active" | "boss_floor" | "boss_cleared" | "realm_cleared"
  }
}

// ---- SpectatorObservation (redacted — public) ---------------

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

export type EnemyBehavior = "aggressive" | "defensive" | "patrol" | "ambush" | "boss"

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

export type EquippedItem = InventoryItem
export type VisibleEntity = Entity
export type RealmEvent = GameEvent
export type TileInfo = Tile
export type CharacterObservation = Observation["character"]
export type RealmInfo = Observation["realm_info"]
