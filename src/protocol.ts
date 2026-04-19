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
  | "riposte-stance"
  | "stealth"
  | "death-mark"
  | "arcane-sight"

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

export type PlayerType = "human" | "agent" | "system"

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
  template_id?: string
  /**
   * Item template type copied from the underlying content template. Only set for `type === "item"`.
   * Lets agent SDKs identify key-items without a name heuristic.
   */
  template_type?: ItemType
  rarity?: ItemRarity
  hp_current?: number
  hp_max?: number
  effects?: ActiveEffect[]
  behavior?: EnemyBehavior
  is_boss?: boolean
  trapped?: boolean
  /**
   * True when this interactable is the room's locked exit. Only set for `type === "interactable"`.
   * Agents can use this as a structured signal that the entity is a door blocking realm progress.
   */
  is_locked_exit?: boolean
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
    /**
     * Perk points remaining: `(level - 1) - sum(perk stacks spent)`. Tier choices
     * from the skill tree are milestone rewards and do NOT consume this pool.
     */
    skill_points: number
    /** Number of unclaimed tier levels (tier.unlock_level <= level with no choice picked). */
    tier_choices_available: number
    hp: { current: number; max: number }
    resource: { type: ResourceType; current: number; max: number }
    buffs: ActiveEffect[]
    debuffs: ActiveEffect[]
    cooldowns: Record<string, number>
    abilities: AbilitySummary[]
    base_stats: CharacterStats
    effective_stats: CharacterStats
    skill_tree: Record<string, boolean>
    perks: Record<string, number>
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
    template_id: string
    template_name: string
    floor_count: number
    current_floor: number
    /** Floor-1 entrance room id — legal `retreat` requires being here with no hostiles. */
    entrance_room_id: string
    /**
     * Geometric center of the floor-1 entrance room, in room-local coordinates.
     * Clients use this as the EXIT waypoint / auto-walk goal when the realm is cleared.
     */
    entrance_tile: { x: number; y: number }
    status: "active" | "boss_floor" | "boss_cleared" | "realm_cleared"
  }
}

// ---- SpectatorObservation (partially redacted — public) -----
//
// Spectators receive gear, inventory, the abilities list, exact HP /
// resource numbers, and a session_stats block so the watch UI can mirror
// the player's own HUD and surface match-scoped damage/kill numbers.
// The following remain redacted:
//   - gold, XP, skill points, skill tree, perks
//   - base_stats / effective_stats (raw numbers)
//   - buffs (debuffs remain public so threats are visible)
//   - legal_actions and the per-ability cooldowns map
//
// `hp_percent` / `resource_percent` stay on the payload alongside the
// exact values for backwards compatibility with frontend consumers that
// render HP bars directly off the percentage (see
// `frontend/app/spectate/[characterId]/page.tsx`). The exact values were
// promoted to public in Phase 8 of the arena plan so arena + dungeon
// spectators always see at least as much HP / kill fidelity as any
// single competitor.

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

export interface PerkTemplate {
  id: string
  name: string
  description: string
  stat: "hp" | "attack" | "defense" | "accuracy" | "evasion" | "speed"
  value_per_stack: number
  max_stacks: number
}

export type EnemyBehavior = "aggressive" | "defensive" | "patrol" | "ambush" | "boss"

export interface LobbyEvent {
  type: string
  characterName: string
  characterClass: CharacterClass
  detail: string
  timestamp: number
}

/** Visual tier for server-generated lobby announcements. Ignored on
 *  player-authored messages. Derived from the acting character's leaderboard
 *  rank at event time: top-3 → legendary, 4-10 → elite, rest → normal. */

export type ChatProminence = "normal" | "elite" | "legendary"

/** What kind of server event produced this chat message. Drives icon/colour on
 *  the frontend. Present only on `player_type === "system"` messages. */

export type ChatSystemKind = "death" | "boss_kill" | "rare_pickup"

export interface SanitizedChatMessage {
  /** Stable id of the character who sent the message. Optional because
   *  historical chat_log rows (pre-issue #7) were written without it, and
   *  the backend still produces null for those when loading backlog. When
   *  present, the frontend wraps `character_name` in a link to
   *  `/character/[character_id]`. */
  character_id?: string
  character_name: string
  character_class: CharacterClass
  player_type: PlayerType
  message: string
  timestamp: number
  /** Present when the message originated in a per-player spectate chat
   *  and is being mirrored to the global lobby. */
  spectate_context?: {
    watching_character_name: string
    realm_name: string
  }
  /** Visual tier for system messages. Set by the backend when publishing
   *  death/boss_kill/rare_pickup announcements. */
  prominence?: ChatProminence
  /** System event kind. Set by the backend when publishing announcements. */
  kind?: ChatSystemKind
  /** Server-computed hint that the frontend should play the announcement sound
   *  (still gated by the user's mute preference). Independent of visual tier —
   *  driven by a rank threshold (LOBBY_DEATH_SOUND_RANK_THRESHOLD). */
  play_sound?: boolean
}

export type ArenaBracket = "rookie" | "veteran" | "champion"

/** Lifecycle phases for an arena match. */

export type ArenaMatchPhase = "grace" | "active" | "sudden_death" | "finished"

/** Whether an arena entity is a player character or a spawned NPC. */

export type ArenaEntityKind = "player" | "npc"

/**
 * Unified entity record covering both human/agent players and spawned NPCs in
 * an arena match. The arena engine operates on this shape directly and does
 * not share state with the dungeon `GameState.character` or `activeFloor.enemies`
 * trees.
 */

export interface ArenaEntity {
  id: string
  kind: ArenaEntityKind
  /** Set for player entities; mirrors Account.id. */
  account_id?: string
  /** Set for player entities; mirrors Character.id. */
  character_id?: string
  /** Set for NPC entities; mirrors EnemyTemplate.id (e.g. "hollow-rat"). */
  template_id?: string
  name: string
  class?: CharacterClass
  level?: number
  position: { x: number; y: number }
  hp: { current: number; max: number }
  resource?: { type: ResourceType; current: number; max: number }
  stats: CharacterStats
  /** Equipment + perk + skill-tree modified stats; falls back to `stats` when absent. */
  effective_stats?: CharacterStats
  active_effects: ActiveEffect[]
  abilities: string[]
  cooldowns: Record<string, number>
  is_boss?: boolean
  alive: boolean
  /** True while the entity is untargetable by enemy AI (e.g. Rogue Vanish). */
  stealth?: boolean
  /** Player-only; NPCs do not carry an inventory. */
  inventory?: InventoryItem[]
  /** Player-only; equipment does not drop in arena but its stats still apply. */
  equipment?: Record<EquipSlot, InventoryItem | null>
  /** Match-scoped stats used for tiebreakers, leaderboards, and OG cards. */
  session_stats?: {
    /** Total damage dealt (PvP + PvE). Surfaced in placement rows / OG cards. */
    damage_dealt: number
    /**
     * Damage dealt specifically against other player entities. Drives the
     * ARENA_DESIGN.md §11 tiebreaker when the final round kills everyone
     * simultaneously — "player who dealt the most total PvP damage wins".
     */
    damage_dealt_to_players: number
    pvp_kills: number
    npc_kills: number
    damage_taken: number
    turns_survived: number
  }
}

/**
 * Static arena map definition loaded from content JSON. Grid is row-major
 * (grid[y][x]). `edge_tiles` are the walkable outermost tiles used by the
 * wave spawner to place NPCs along N/S/E/W edges.
 */

export interface ArenaMap {
  id: string
  name: string
  grid: TileType[][]
  spawn_points: { x: number; y: number }[]
  chest_positions: { x: number; y: number }[]
  edge_tiles: { x: number; y: number }[]
  description: string
}

/**
 * Loot pile dropped on a player's tile when they are eliminated. Gold stays
 * in the pot — only consumables drop. Any other player can claim items with
 * the `interact` action targeting `source_player`'s death-pile entity id.
 */

export interface ArenaDeathDrop {
  position: { x: number; y: number }
  items: InventoryItem[]
  /** Always 0 — gold is in the pot, not on the body. Kept for future extension. */
  gold: number
  source_player: string
  turn_dropped: number
}

/** Arena reuses the existing `Action` discriminated union verbatim. */

export type ArenaAction = Action

/**
 * Event emitted during arena turn resolution. Parallel to `GameEvent` but
 * includes a `round` number so spectator UIs can group kill feed entries by
 * round rather than by raw turn counter.
 */

export interface ArenaEvent {
  turn: number
  round: number
  type: string
  detail: string
  data: Record<string, unknown>
}

/**
 * Surfaced in observations once a player-player proximity counter reaches
 * the "warning" threshold (>= 2). `turns_until_damage` = 3 - counter.
 */

export interface ProximityWarning {
  player_a: string
  player_b: string
  turns_until_damage: number
}

/**
 * Per-player arena observation. Unlike dungeon observations, arena has no fog
 * of war — all entities and tiles are visible to every participant.
 */

export interface ArenaObservation {
  match_id: string
  round: number
  turn: number
  phase: ArenaMatchPhase
  map_id: string
  grid: TileType[][]
  entities: ArenaEntity[]
  you: ArenaEntity
  /** Entity IDs in initiative order for the current round. */
  turn_order: string[]
  /**
   * Entity IDs that have already consumed their turn in the CURRENT round.
   * Mirrors the spectator observation so the participant play view can drive
   * the exact same animated turn-order sidebar (Acting / Up next / Done /
   * Eliminated) instead of the simpler initiative strip.
   */
  acted_this_round: string[]
  next_wave_turn: number | null
  proximity_warnings: ProximityWarning[]
  recent_events: ArenaEvent[]
  legal_actions: Action[]
  death_drops: ArenaDeathDrop[]
}

/**
 * Full-fidelity spectator observation for arena matches (no percentage
 * redaction — arena spectators see the exact numbers so the audience always
 * has more info than any single competitor).
 */

export interface ArenaSpectatorObservation {
  match_id: string
  round: number
  turn: number
  phase: ArenaMatchPhase
  map_id: string
  grid: TileType[][]
  entities: ArenaEntity[]
  turn_order: string[]
  /**
   * Entity IDs that have already consumed their turn in the CURRENT
   * round. Added in Phase 12 so the spectator turn-order sidebar can
   * split initiative into "acting / acted / pending / eliminated"
   * sections without the client having to diff consecutive frames.
   * Participant observations do not need this (they already receive a
   * dedicated `your_turn` prompt).
   */
  acted_this_round: string[]
  next_wave_turn: number | null
  proximity_warnings: ProximityWarning[]
  recent_events: ArenaEvent[]
  death_drops: ArenaDeathDrop[]
  spectator_count: number
}

/** One row in the final match result placements array. */

export interface ArenaMatchResultPlacement {
  account_id: string
  character_id: string
  player_type: PlayerType
  placement: 1 | 2 | 3 | 4
  kills: number
  damage_dealt: number
  survived_rounds: number
  gold_awarded: number
}

/** Immutable match outcome written to `arena_matches` at match end. */

export interface ArenaMatchResult {
  match_id: string
  bracket: ArenaBracket
  map_id: string
  pot: number
  placements: ArenaMatchResultPlacement[]
  total_rounds: number
  ended_reason: "last_standing" | "sudden_death" | "tie_break"
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 13 — Arena match summary / share-card response shapes.
// Returned by `GET /arena/match/:id` and consumed by the public summary
// page + OG image routes. Placements are enriched server-side with
// character_name/class/level (from `arena_leaderboard` with a
// `characters+accounts` fallback) and with a derived `killer` object so
// the death/victory cards can render without further joins.
// ─────────────────────────────────────────────────────────────────────────

/** Inferred killer for a non-winning placement; null for the match winner. */

export interface ArenaState {
  match_id: string
  round: number
  turn: number
  phase: ArenaMatchPhase
  map: ArenaMap
  entities: ArenaEntity[]
  /** Entity IDs in initiative order for the current round. */
  turn_order: string[]
  /** Entity IDs that have already consumed their turn this round. */
  acted_this_round: string[]
  /**
   * Pair key -> consecutive-round proximity counter. Key format is
   * `sortedIdA + ":" + sortedIdB` (alphabetical) for a stable lookup.
   */
  proximity_counters: Record<string, number>
  next_wave_turn: number | null
  death_drops: ArenaDeathDrop[]
  events: ArenaEvent[]
  /** Serialized SeededRng.getState() for crash-safe resumes. */
  rng_state: number
}

// ---- Arena WebSocket Messages -------------------------------
//
// Arena WS uses a parallel protocol to dungeon `ServerMessage` /
// `ClientMessage`. These unions match the exact payloads emitted by
// `backend/src/game/arena-session.ts` (`sendObservationTo`, `awaitAction`,
// `handleEntityDeath`, `endMatch`) so agent-sdk consumers can parse without
// structural drift.

/** Terminal reason for an arena match. "abandoned" is emitted when no
 *  players ever attached before the inactivity cutoff and carries a null
 *  result; all other reasons carry a full {@link ArenaMatchResult}. */

export type ArenaMatchEndReason =
  | "last_standing"
  | "sudden_death"
  | "tie_break"
  | "abandoned"

export type ArenaClientMessage = { type: "action"; data: ArenaAction }

export type ArenaServerMessage =
  | { type: "observation"; data: ArenaObservation }
  | { type: "your_turn"; data: { entity_id: string; timeout_ms: number } }
  | {
      type: "arena_death"
      data: {
        entity_id: string
        /** Killer entity id, or the sentinel "sudden_death" / "cowardice"
         *  when the kill came from a global damage schedule rather than a
         *  specific entity. Never null — arena kills always have a source. */
        killer_entity_id: string
        turn: number
        round: number
      }
    }
  | {
      type: "arena_match_end"
      data: {
        match_id: string
        reason: ArenaMatchEndReason
        result: ArenaMatchResult | null
      }
    }
  | { type: "error"; message: string }

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

export type EquippedItem = InventoryItem
export type VisibleEntity = Entity
export type RealmEvent = GameEvent
export type TileInfo = Tile
export type CharacterObservation = Observation["character"]
export type RealmInfo = Observation["realm_info"]
