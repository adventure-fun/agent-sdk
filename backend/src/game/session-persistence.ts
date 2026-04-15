import type {
  GameState,
  GameEvent,
  WorldMutation,
  ActiveEffect,
} from "@adventure-fun/schemas"

// ── 8.1 — Batch mutation persistence ────────────────────────────────────────

interface PositionInfo {
  room_id: string
  tile: { x: number; y: number }
  floor: number
}

export async function batchPersistMutations(
  db: { from: (t: string) => any },
  realmId: string,
  turn: number,
  mutations: WorldMutation[],
  position?: PositionInfo,
): Promise<void> {
  if (mutations.length > 0) {
    await db.from("realm_mutations").insert(
      mutations.map((m) => ({
        realm_instance_id: realmId,
        entity_id: m.entity_id,
        mutation: m.mutation,
        turn,
        floor: m.floor,
        metadata: m.metadata,
      })),
    )
  }

  if (position) {
    await persistRealmProgress(db, realmId, turn, position)
  }
}

/**
 * Writes the live `last_turn` / position cursor on `realm_instances`. Called every turn so that
 * a silent disconnect (e.g. agent SIGKILL) never regresses the resume point by more than one
 * turn — regardless of whether the turn produced any world mutations.
 */
export async function persistRealmProgress(
  db: { from: (t: string) => any },
  realmId: string,
  turn: number,
  position: PositionInfo,
): Promise<void> {
  await db
    .from("realm_instances")
    .update({
      last_turn: turn,
      current_room_id: position.room_id,
      tile_x: position.tile.x,
      tile_y: position.tile.y,
      floor_reached: position.floor,
    })
    .eq("id", realmId)
}

// ── 8.2 — Disconnect recovery (session state serialization) ─────────────────

interface SerializedEnemy {
  id: string
  hp: number
  position: { x: number; y: number }
  effects: ActiveEffect[]
  cooldowns: Record<string, number>
  boss_phase_index?: number
  defense_modifier?: number
}

interface SerializedRoomState {
  room_id: string
  enemies: SerializedEnemy[]
}

export interface SessionState {
  rooms: SerializedRoomState[]
  roomsVisited?: Record<number, string[]>
  questFlags?: string[]
}

export function serializeSessionState(state: GameState): SessionState {
  return {
    rooms: state.activeFloor.rooms.map((room) => ({
      room_id: room.id,
      enemies: room.enemies
        .filter((e) => e.hp > 0)
        .map((e) => ({
          id: e.id,
          hp: e.hp,
          position: { ...e.position },
          effects: e.effects.map((eff) => ({ ...eff })),
          cooldowns: { ...e.cooldowns },
          ...(e.boss_phase_index !== undefined ? { boss_phase_index: e.boss_phase_index } : {}),
          ...(e.defense_modifier !== undefined ? { defense_modifier: e.defense_modifier } : {}),
        })),
    })),
    roomsVisited: state.roomsVisited ? { ...state.roomsVisited } : undefined,
    questFlags: state.questFlags ? [...state.questFlags] : undefined,
  }
}

export function applySessionState(
  state: GameState,
  sessionState: SessionState,
): void {
  if (sessionState.roomsVisited) {
    state.roomsVisited = Object.fromEntries(
      Object.entries(sessionState.roomsVisited).map(([floor, rooms]) => [
        Number(floor),
        [...rooms],
      ]),
    )
  }

  for (const savedRoom of sessionState.rooms) {
    const room = state.activeFloor.rooms.find((r) => r.id === savedRoom.room_id)
    if (!room) continue

    for (const savedEnemy of savedRoom.enemies) {
      const enemy = room.enemies.find((e) => e.id === savedEnemy.id)
      if (!enemy) continue

      enemy.hp = savedEnemy.hp
      enemy.position = { ...savedEnemy.position }
      enemy.effects = savedEnemy.effects.map((eff) => ({ ...eff }))
      enemy.cooldowns = { ...savedEnemy.cooldowns }
      if (savedEnemy.boss_phase_index !== undefined) {
        enemy.boss_phase_index = savedEnemy.boss_phase_index
      }
      if (savedEnemy.defense_modifier !== undefined) {
        enemy.defense_modifier = savedEnemy.defense_modifier
      }
    }
  }

  if (sessionState.questFlags) {
    state.questFlags = [...sessionState.questFlags]
  }
}

export async function persistLoreDiscoveries(
  db: { from: (t: string) => any },
  characterId: string,
  loreDiscovered: GameState["loreDiscovered"],
): Promise<void> {
  if (!loreDiscovered || loreDiscovered.length === 0) return

  await db.from("lore_discovered").upsert(
    loreDiscovered.map((entry) => ({
      character_id: characterId,
      lore_entry_id: entry.lore_entry_id,
      discovered_at_turn: entry.discovered_at_turn,
    })),
  )
}

// ── 8.3 — Count completed realms ────────────────────────────────────────────

export async function countCompletedRealms(
  db: { from: (t: string) => any },
  characterId: string,
): Promise<number> {
  const { data, error } = await db
    .from("realm_instances")
    .select("id")
    .eq("character_id", characterId)
    .eq("status", "completed")

  if (error || !data) return 0
  return (data as unknown[]).length
}

// ── 8.4 — Run summary with categorized interact events ──────────────────────

export interface RunSummary {
  enemies_killed: number
  damage_dealt: number
  damage_taken: number
  chests_opened: number
  xp_earned: number
  deepest_floor: number
  abilities_used: Record<string, number>
  potions_consumed: number
  turns_in_combat: number
  turns_exploring: number
  cause_of_death: string | null
  traps_disarmed: number
}

export function buildRunSummaryFromEvents(
  events: GameEvent[],
  context: { floor: number },
  deathCause?: string | null,
): RunSummary {
  let enemiesKilled = 0
  let damageDealt = 0
  let damageTaken = 0
  let chestsOpened = 0
  let xpEarned = 0
  let potionsConsumed = 0
  let turnsInCombat = 0
  let turnsExploring = 0
  let trapsDisarmed = 0
  let causeOfDeath: string | null = null
  const abilitiesUsed: Record<string, number> = {}

  for (const event of events) {
    switch (event.type) {
      case "enemy_killed":
        enemiesKilled++
        xpEarned += (event.data.xp as number) ?? 0
        break
      case "attack_hit":
        damageDealt += (event.data.damage as number) ?? 0
        turnsInCombat++
        break
      case "enemy_attack":
        damageTaken += (event.data.damage as number) ?? 0
        if ((event.data.player_hp as number) <= 0) {
          causeOfDeath = event.detail
        }
        break
      case "trap_triggered":
        damageTaken += (event.data.damage as number) ?? 0
        break
      case "interact":
        if (event.data.category === "chest") {
          chestsOpened++
        }
        break
      case "move":
      case "floor_change":
        turnsExploring++
        break
      case "use_item":
        potionsConsumed++
        break
      case "trap_disarmed":
        trapsDisarmed++
        break
    }
  }

  return {
    enemies_killed: enemiesKilled,
    damage_dealt: damageDealt,
    damage_taken: damageTaken,
    chests_opened: chestsOpened,
    xp_earned: xpEarned,
    deepest_floor: context.floor,
    abilities_used: abilitiesUsed,
    potions_consumed: potionsConsumed,
    turns_in_combat: turnsInCombat,
    turns_exploring: turnsExploring,
    cause_of_death: deathCause ?? causeOfDeath,
    traps_disarmed: trapsDisarmed,
  }
}
