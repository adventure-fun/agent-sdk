import type {
  Action,
  ArenaEntity,
  ArenaEvent,
  ArenaObservation,
  ArenaMatchPhase,
  ProximityWarning,
  TileType,
} from "../../../../src/index.js"

/**
 * Builds a 15x15 open arena grid with walls on the outermost ring — matches
 * the actual arena map format (`ArenaMapSource` rows with W/.) emitted by
 * `shared/engine/src/content.ts`.
 */
export function buildEmptyArenaGrid(size = 15): TileType[][] {
  const grid: TileType[][] = []
  for (let y = 0; y < size; y++) {
    const row: TileType[] = []
    for (let x = 0; x < size; x++) {
      row.push(x === 0 || y === 0 || x === size - 1 || y === size - 1 ? "wall" : "floor")
    }
    grid.push(row)
  }
  return grid
}

/** Default stats for a generic player entity. */
const DEFAULT_PLAYER_STATS = {
  hp: 100,
  attack: 12,
  defense: 5,
  accuracy: 13,
  evasion: 14,
  speed: 15,
} as const

export interface EntityOverrides {
  id?: string
  kind?: "player" | "npc"
  name?: string
  class?: "rogue" | "knight" | "mage" | "archer"
  level?: number
  position?: { x: number; y: number }
  hp?: { current?: number; max?: number }
  resource?: { type: "mana" | "energy" | "stamina" | "focus"; current: number; max: number }
  abilities?: string[]
  cooldowns?: Record<string, number>
  stats?: Partial<ArenaEntity["stats"]>
  effective_stats?: Partial<ArenaEntity["stats"]>
  alive?: boolean
  stealth?: boolean
  character_id?: string
  account_id?: string
  template_id?: string
  session_stats?: Partial<NonNullable<ArenaEntity["session_stats"]>>
}

/**
 * Builds a plausible `ArenaEntity`. Defaults cover a mid-level rogue player
 * with full HP; overrides win on every field.
 */
export function buildArenaEntity(overrides: EntityOverrides = {}): ArenaEntity {
  const kind = overrides.kind ?? "player"
  const hpMax = overrides.hp?.max ?? DEFAULT_PLAYER_STATS.hp
  const hpCurrent = overrides.hp?.current ?? hpMax
  const stats = { ...DEFAULT_PLAYER_STATS, ...overrides.stats } as ArenaEntity["stats"]
  const effective = { ...stats, ...overrides.effective_stats } as ArenaEntity["stats"]
  const entity: ArenaEntity = {
    id: overrides.id ?? "player-a",
    kind,
    name: overrides.name ?? (kind === "player" ? "Alice" : "Hollow Rat"),
    position: overrides.position ?? { x: 7, y: 7 },
    hp: { current: hpCurrent, max: hpMax },
    stats,
    effective_stats: effective,
    active_effects: [],
    abilities: overrides.abilities ?? [],
    cooldowns: overrides.cooldowns ?? {},
    alive: overrides.alive ?? hpCurrent > 0,
  }
  if (kind === "player") {
    entity.class = overrides.class ?? "rogue"
    entity.level = overrides.level ?? 3
    entity.character_id = overrides.character_id ?? `char-${entity.id}`
    entity.account_id = overrides.account_id ?? `acct-${entity.id}`
    entity.resource = overrides.resource ?? { type: "energy", current: 80, max: 100 }
    entity.session_stats = {
      damage_dealt: 0,
      damage_dealt_to_players: 0,
      pvp_kills: 0,
      npc_kills: 0,
      damage_taken: 0,
      turns_survived: 0,
      ...overrides.session_stats,
    }
  } else {
    entity.template_id = overrides.template_id ?? "hollow-rat"
  }
  if (overrides.stealth !== undefined) entity.stealth = overrides.stealth
  return entity
}

/** Convenience: a directional `move` action. */
export function moveAction(direction: "up" | "down" | "left" | "right"): Action {
  return { type: "move", direction }
}

/** Convenience: a basic-attack action against a target id. */
export function attackAction(targetId: string, abilityId?: string): Action {
  const action: Action = { type: "attack", target_id: targetId }
  if (abilityId) (action as { ability_id?: string }).ability_id = abilityId
  return action
}

export interface ArenaObservationOverrides {
  match_id?: string
  round?: number
  turn?: number
  phase?: ArenaMatchPhase
  map_id?: string
  grid?: TileType[][]
  entities?: ArenaEntity[]
  you?: ArenaEntity
  turn_order?: string[]
  next_wave_turn?: number | null
  proximity_warnings?: ProximityWarning[]
  recent_events?: ArenaEvent[]
  legal_actions?: Action[]
  death_drops?: ArenaObservation["death_drops"]
}

/**
 * Builds an `ArenaObservation` with sensible defaults: a 15x15 empty map,
 * one alive player (`you`), the four cardinal moves legal, grace phase on
 * round 1. Override any field to script a specific scenario.
 */
export function buildArenaObservation(
  overrides: ArenaObservationOverrides = {},
): ArenaObservation {
  const you = overrides.you ?? buildArenaEntity()
  const entities = overrides.entities ?? [you]
  const containsYou = entities.some((e) => e.id === you.id)
  const resolvedEntities = containsYou ? entities : [you, ...entities]

  const defaultLegal: Action[] = [
    moveAction("up"),
    moveAction("down"),
    moveAction("left"),
    moveAction("right"),
    { type: "wait" },
  ]

  return {
    match_id: overrides.match_id ?? "match-test",
    round: overrides.round ?? 1,
    turn: overrides.turn ?? 1,
    phase: overrides.phase ?? "grace",
    map_id: overrides.map_id ?? "arena-pit",
    grid: overrides.grid ?? buildEmptyArenaGrid(),
    entities: resolvedEntities,
    you,
    turn_order: overrides.turn_order ?? resolvedEntities.map((e) => e.id),
    next_wave_turn: overrides.next_wave_turn ?? null,
    proximity_warnings: overrides.proximity_warnings ?? [],
    recent_events: overrides.recent_events ?? [],
    legal_actions: overrides.legal_actions ?? defaultLegal,
    death_drops: overrides.death_drops ?? [],
  }
}

/** Shorthand for wrapping an entity + observation override in one call. */
export function buildArenaObservationWith(
  you: EntityOverrides,
  rest: ArenaObservationOverrides = {},
): ArenaObservation {
  const youEntity = buildArenaEntity(you)
  return buildArenaObservation({ you: youEntity, ...rest })
}

export function proximityWarning(
  playerA: string,
  playerB: string,
  turnsUntilDamage: number,
): ProximityWarning {
  return { player_a: playerA, player_b: playerB, turns_until_damage: turnsUntilDamage }
}

export function arenaEvent(overrides: Partial<ArenaEvent> = {}): ArenaEvent {
  return {
    turn: overrides.turn ?? 1,
    round: overrides.round ?? 1,
    type: overrides.type ?? "attack",
    detail: overrides.detail ?? "Alice hits Bob for 5.",
    data: overrides.data ?? {},
  }
}
