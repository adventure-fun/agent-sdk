import type { ServerWebSocket } from "bun"
import type {
  Action,
  GameState,
  GameEvent,
  WorldMutation,
  InventoryItem,
  InventorySlot,
  Observation,
  CharacterStats,
  EquipSlot,
  ResourceType,
  ServerMessage,
  SpectatorObservation,
} from "@adventure-fun/schemas"
import {
  generateRealm,
  REALMS,
  CLASSES,
  SKILL_TREES,
  SeededRng,
  resolveTurn,
  buildObservationFromState,
  buildRoomState,
  computeLegalActions,
  checkLevelUp,
  toSpectatorObservation,
} from "@adventure-fun/engine"
import type { GeneratedRealm } from "@adventure-fun/engine"
import { db } from "../db/client.js"
import type { SessionPayload } from "../auth/jwt.js"
import {
  batchPersistMutations,
  serializeSessionState,
  applySessionState,
  countCompletedRealms,
  buildRunSummaryFromEvents,
  persistLoreDiscoveries,
  type SessionState,
} from "./session-persistence.js"
import { parseAction, isActionLegal } from "./action-validator.js"
import {
  addSpectator,
  broadcastSpectatorObservation,
  closeSpectators,
  removeSpectator,
  type SpectatorSocketLike,
} from "./spectators.js"
import {
  getActiveSession,
  registerActiveSession,
  unregisterActiveSession,
} from "./active-sessions.js"
import { getPubSub } from "../redis/pubsub.js"
import {
  publishSpectatorUpdate,
  publishLobbyActivity,
  publishLeaderboardDelta,
} from "../redis/publishers.js"

const TURN_TIMEOUT_MS =
  Number(process.env["TURN_TIMEOUT_SECONDS"] ?? 30) * 1000

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GameSessionData {
  role: "player"
  realmId: string
  session: SessionPayload
  characterId: string
  turnTimer?: ReturnType<typeof setTimeout>
}

export interface SpectatorSessionData {
  role: "spectator"
  characterId: string
}

export type SocketSessionData = GameSessionData | SpectatorSessionData

export type ExtractionOutcome = Extract<ServerMessage, { type: "extracted" }>["data"]

function buildLootSummary(inventory: InventoryItem[]): InventorySlot[] {
  return inventory.map((item) => ({
    item_id: item.id,
    template_id: item.template_id,
    name: item.name,
    quantity: item.quantity,
    modifiers: item.modifiers,
  }))
}

function applyCompletionLevelUps(state: GameState): void {
  const { newLevel, levelsGained } = checkLevelUp(
    state.character.level,
    state.character.xp,
  )
  if (levelsGained <= 0) return

  const growth = CLASSES[state.character.class]?.stat_growth
  if (growth) {
    for (let i = 0; i < levelsGained; i++) {
      state.character.stats.hp += growth.hp
      state.character.stats.attack += growth.attack
      state.character.stats.defense += growth.defense
      state.character.stats.accuracy += growth.accuracy
      state.character.stats.evasion += growth.evasion
      state.character.stats.speed += growth.speed
    }
    state.character.hp.max += growth.hp * levelsGained
    state.character.hp.current = Math.min(
      state.character.hp.current + growth.hp * levelsGained,
      state.character.hp.max,
    )
    state.character.effective_stats = { ...state.character.stats }
  }

  state.character.level = newLevel
}

function isRealmCompletedStatus(status: GameState["realmStatus"]): boolean {
  return status === "boss_cleared" || status === "realm_cleared"
}

export function applyExtractionOutcome(state: GameState): ExtractionOutcome {
  const realmCompleted = isRealmCompletedStatus(state.realmStatus)
  const completionRewards = realmCompleted
    ? REALMS[state.realm.template_id]?.completion_rewards
    : undefined

  if (completionRewards) {
    state.character.xp += completionRewards.xp
    state.character.gold += completionRewards.gold
    applyCompletionLevelUps(state)
  }

  return {
    loot_summary: buildLootSummary(state.inventory),
    xp_gained: completionRewards?.xp ?? 0,
    gold_gained: completionRewards?.gold ?? 0,
    ...(completionRewards
      ? {
          completion_bonus: {
            xp: completionRewards.xp,
            gold: completionRewards.gold,
          },
        }
      : {}),
    realm_completed: realmCompleted,
  }
}

// ── GameSession class ─────────────────────────────────────────────────────────

export class GameSession {
  readonly realmId: string
  readonly characterId: string

  private turn: number
  private gameState: GameState
  private generatedRealm: GeneratedRealm
  private rng: SeededRng
  private eventBuffer: GameEvent[]
  private sessionStartedAt: Date
  private ws: ServerWebSocket<GameSessionData>
  private ended = false
  private spectators = new Set<SpectatorSocketLike>()

  private constructor(
    ws: ServerWebSocket<GameSessionData>,
    gameState: GameState,
    realm: GeneratedRealm,
    rng: SeededRng,
    turn: number,
  ) {
    this.ws = ws
    this.realmId = ws.data.realmId
    this.characterId = ws.data.characterId
    this.gameState = gameState
    this.generatedRealm = realm
    this.rng = rng
    this.turn = turn
    this.eventBuffer = []
    this.sessionStartedAt = new Date()
  }

  // ── Factory: cold-rebuild from DB ─────────────────────────────────────────

  static async create(
    ws: ServerWebSocket<GameSessionData>,
  ): Promise<GameSession | null> {
    const { realmId, characterId } = ws.data

    const [realmRes, charRes, mutRes, mapRes, invRes, loreRes] = await Promise.all([
      db.from("realm_instances").select("*").eq("id", realmId).single(),
      db.from("characters").select("*").eq("id", characterId).single(),
      db
        .from("realm_mutations")
        .select("*")
        .eq("realm_instance_id", realmId)
        .order("turn"),
      db
        .from("realm_discovered_map")
        .select("*")
        .eq("realm_instance_id", realmId),
      db
        .from("inventory_items")
        .select("*")
        .eq("owner_type", "character")
        .eq("owner_id", characterId),
      db
        .from("lore_discovered")
        .select("*")
        .eq("character_id", characterId),
    ])

    const realm = realmRes.data
    const character = charRes.data
    if (!realm || !character) return null

    const template = REALMS[realm.template_id]
    if (!template) return null

    const generated = generateRealm(template, realm.seed)

    // Build mutated entity list from existing mutations
    const mutations = mutRes.data ?? []
    const mutatedEntities = mutations.map(
      (m: Record<string, unknown>) => m.entity_id as string,
    )

    // Build discovered tiles from DB
    const discoveredTiles: Record<number, Array<{ x: number; y: number }>> = {}
    for (const row of mapRes.data ?? []) {
      discoveredTiles[row.floor as number] =
        (row.discovered_tiles as Array<{ x: number; y: number }>) ?? []
    }

    // Position: use persisted values if available, else floor 1 entrance
    const floor = realm.floor_reached ?? 1
    const genFloor = generated.floors.find((f) => f.floor_number === floor)
    const entranceRoomId =
      realm.current_room_id ??
      genFloor?.entrance_room_id ??
      generated.floors[0]?.rooms[0]?.id ??
      ""
    const tileX = realm.tile_x ?? 1
    const tileY = realm.tile_y ?? 1

    // Build active floor rooms
    const activeFloorRooms = (genFloor?.rooms ?? []).map((gr) =>
      buildRoomState(gr, mutatedEntities, realm.template_id, realm.seed),
    )

    // Build inventory + equipment
    const inventory: InventoryItem[] = []
    const equipment: Record<EquipSlot, InventoryItem | null> = {
      weapon: null,
      armor: null,
      accessory: null,
      "class-specific": null,
    }
    for (const item of invRes.data ?? []) {
      const inv: InventoryItem = {
        id: item.id,
        template_id: item.template_id,
        name: item.template_id,
        quantity: item.quantity ?? 1,
        modifiers: (item.modifiers as Record<string, number>) ?? {},
        owner_type: item.owner_type,
        owner_id: item.owner_id,
        slot: item.slot,
      }
      if (item.slot && item.slot in equipment) {
        equipment[item.slot as EquipSlot] = inv
      } else {
        inventory.push(inv)
      }
    }

    const resourceType: ResourceType =
      character.class === "knight"
        ? "stamina"
        : character.class === "mage"
          ? "mana"
          : character.class === "rogue"
            ? "energy"
            : "focus"

    const stats = character.stats as CharacterStats
    const classTemplate = CLASSES[character.class]
    const dbSkillTree = (character.skill_tree ?? {}) as Record<string, boolean>

    const abilities = [...new Set(classTemplate?.starting_abilities ?? [])]
    const effectiveStats = { ...stats }

    // Merge skill-tree unlocks into abilities and effective stats
    if (classTemplate) {
      const treeId = (classTemplate as Record<string, unknown>).skill_tree_id as string | undefined
      const tree = treeId ? SKILL_TREES[treeId] : classTemplate.skill_tree
      if (tree) {
        for (const tier of tree.tiers) {
          for (const choice of tier.choices) {
            if (!dbSkillTree[choice.id]) continue
            if (choice.effect.type === "grant-ability" && choice.effect.ability_id) {
              if (!abilities.includes(choice.effect.ability_id)) {
                abilities.push(choice.effect.ability_id)
              }
            } else if (choice.effect.type === "passive-stat" && choice.effect.stat && choice.effect.value) {
              const stat = choice.effect.stat as keyof CharacterStats
              if (stat in effectiveStats) {
                effectiveStats[stat] += choice.effect.value
              }
            }
          }
        }
      }
    }

    const gameState: GameState = {
      turn: (realm.last_turn as number) ?? 0,
      realm: {
        template_id: realm.template_id,
        template_version: realm.template_version,
        seed: realm.seed,
        total_floors: generated.total_floors,
      },
      character: {
        id: character.id,
        class: character.class,
        level: character.level,
        xp: character.xp,
        gold: character.gold,
        hp: { current: character.hp_current, max: character.hp_max },
        resource: {
          type: resourceType,
          current: character.resource_current,
          max: character.resource_max,
        },
        stats,
        effective_stats: effectiveStats,
        buffs: [],
        debuffs: [],
        abilities,
        cooldowns: {},
        skill_tree: dbSkillTree,
      },
      position: {
        floor,
        room_id: entranceRoomId,
        tile: { x: tileX, y: tileY },
      },
      inventory,
      equipment,
      activeFloor: { rooms: activeFloorRooms },
      discoveredTiles,
      roomsVisited: {},
      loreDiscovered: (loreRes.data ?? []).map((row) => ({
        lore_entry_id: row.lore_entry_id as string,
        discovered_at_turn: row.discovered_at_turn as number,
      })),
      mutatedEntities,
      realmStatus:
        realm.status === "boss_cleared" || realm.status === "realm_cleared"
          ? realm.status
          : "active",
    }

    // 8.2: Restore enemy positions from persisted session state on reconnect
    const dbSessionState = realm.session_state as SessionState | null
    if (dbSessionState?.rooms?.length) {
      applySessionState(gameState, dbSessionState)
    }

    // 8.5: Restore RNG state if persisted (exact replay fidelity across disconnects)
    const turn = gameState.turn
    const rng = new SeededRng(realm.seed + turn)
    if (typeof realm.rng_state === "number") {
      rng.setState(realm.rng_state)
    }

    // Clear session_state now that it's been consumed
    if (dbSessionState || realm.rng_state != null) {
      db.from("realm_instances")
        .update({ session_state: null, rng_state: null })
        .eq("id", realmId)
        .then(() => {})
    }

    return new GameSession(ws, gameState, generated, rng, turn)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  private buildCurrentObservation(): Observation {
    const obs = buildObservationFromState(
      this.gameState,
      [],
      this.generatedRealm,
    )
    this.markCurrentRoomVisited()
    obs.turn = this.turn
    return obs
  }

  private markCurrentRoomVisited(): void {
    const floor = this.gameState.position.floor
    const roomId = this.gameState.position.room_id
    if (!this.gameState.roomsVisited) {
      this.gameState.roomsVisited = {}
    }
    const visited = this.gameState.roomsVisited[floor] ?? []
    if (!visited.includes(roomId)) {
      this.gameState.roomsVisited[floor] = [...visited, roomId]
    }
  }

  getInitialObservation(): Observation {
    return this.buildCurrentObservation()
  }

  getSpectatorObservation(): SpectatorObservation {
    return toSpectatorObservation(this.buildCurrentObservation())
  }

  addSpectator(ws: SpectatorSocketLike): void {
    addSpectator(this.spectators, ws)
  }

  removeSpectator(ws: SpectatorSocketLike): void {
    removeSpectator(this.spectators, ws)
  }

  async processTurn(action: Action): Promise<void> {
    if (this.ended) return

    // 9.1: Validate action against computed legal actions before processing
    const currentRoom = this.gameState.activeFloor.rooms.find(
      (r) => r.id === this.gameState.position.room_id,
    )
    const legalActions = computeLegalActions(
      this.gameState,
      currentRoom,
      this.generatedRealm,
    )

    if (!isActionLegal(action, legalActions)) {
      this.ws.send(
        JSON.stringify({
          type: "error",
          message: `Illegal action: ${action.type} is not allowed right now`,
          code: "ILLEGAL_ACTION",
        }),
      )
      return
    }

    this.turn++

    const result = resolveTurn(
      this.gameState,
      action,
      this.generatedRealm,
      this.rng,
    )

    // Buffer events — NO per-turn DB write
    for (const event of result.observation.recent_events) {
      this.eventBuffer.push({ ...event, turn: this.turn })
    }

    // Persist world mutations in a single batch (8.1: was 2 DB writes per mutation)
    if (result.worldMutations.length > 0) {
      await batchPersistMutations(db, this.realmId, this.turn, result.worldMutations, {
        room_id: this.gameState.position.room_id,
        tile: this.gameState.position.tile,
        floor: this.gameState.position.floor,
      })
    }

    // Update in-memory state
    this.gameState = result.newState
    result.observation.turn = this.turn
    const extractionSucceeded =
      (action.type === "use_portal" || action.type === "retreat") &&
      result.observation.recent_events.some((event) => event.type === action.type)

    // Publish notable events for death/extraction/boss kill to lobby feed
    const pubsubEarly = getPubSub()
    if (pubsubEarly && result.notableEvents.length > 0) {
      for (const event of result.notableEvents) {
        publishLobbyActivity(pubsubEarly, event)
      }
    }

    // Check death
    if (this.gameState.character.hp.current <= 0) {
      const cause =
        result.notableEvents.find((e) => e.type === "death")?.detail ??
        "Unknown"
      this.ws.send(
        JSON.stringify({
          type: "death",
          data: {
            cause,
            floor: this.gameState.position.floor,
            room: this.gameState.position.room_id,
            turn: this.turn,
          },
        }),
      )
      await this.endSession("death")
      return
    }

    // Check extraction
    if (extractionSucceeded) {
      const extractionData = applyExtractionOutcome(this.gameState)
      this.ws.send(
        JSON.stringify({
          type: "extracted",
          data: extractionData,
        }),
      )
      await this.endSession("extraction")
      return
    }

    // Normal turn — send observation
    this.ws.send(
      JSON.stringify({ type: "observation", data: result.observation }),
    )
    broadcastSpectatorObservation(this.spectators, result.observation)

    // Cross-instance spectator broadcast via Redis pub/sub
    if (pubsubEarly) {
      publishSpectatorUpdate(pubsubEarly, this.characterId, result.observation)
    }
  }

  async endSession(
    reason: "death" | "extraction" | "disconnect",
  ): Promise<void> {
    if (this.ended) return
    this.ended = true

    try {
      // 1. Write run log (single row for the entire session)
      await db.from("run_logs").insert({
        realm_instance_id: this.realmId,
        character_id: this.characterId,
        started_at: this.sessionStartedAt.toISOString(),
        ended_at: new Date().toISOString(),
        end_reason: reason,
        total_turns: this.turn,
        events: this.eventBuffer,
        summary: this.buildRunSummary(),
      })

      // 2. Save character state
      await this.saveCharacterState(reason)
      await persistLoreDiscoveries(
        db,
        this.characterId,
        this.gameState.loreDiscovered,
      )

      // 3. Update realm instance (8.2: persist enemy state + RNG on disconnect)
      const realmStatus =
        reason === "death"
          ? "dead_end"
          : isRealmCompletedStatus(this.gameState.realmStatus)
            ? "completed"
            : "paused"
      const realmUpdate: Record<string, unknown> = {
        status: realmStatus,
        last_turn: this.turn,
        current_room_id: this.gameState.position.room_id,
        tile_x: this.gameState.position.tile.x,
        tile_y: this.gameState.position.tile.y,
        floor_reached: this.gameState.position.floor,
        last_active_at: new Date().toISOString(),
      }
      if (reason === "disconnect") {
        realmUpdate.session_state = serializeSessionState(this.gameState)
        realmUpdate.rng_state = this.rng.getState()
      } else {
        realmUpdate.session_state = null
        realmUpdate.rng_state = null
      }
      await db
        .from("realm_instances")
        .update(realmUpdate)
        .eq("id", this.realmId)

      // 4. Persist fog-of-war
      for (const [floor, tiles] of Object.entries(
        this.gameState.discoveredTiles,
      )) {
        await db.from("realm_discovered_map").upsert({
          realm_instance_id: this.realmId,
          floor: Number(floor),
          discovered_tiles: tiles,
        })
      }

      // 5. Update leaderboard
      await this.updateLeaderboard(reason)

      // 6. Handle death specifics (corpse + inventory transfer)
      if (reason === "death") {
        await this.handleDeath()
      } else {
        // Sync inventory back to DB
        await this.syncInventory()
      }
    } catch (err) {
      console.error("endSession error:", err)
    }

    // Clean up
    closeSpectators(this.spectators, reason)
    unregisterActiveSession(this.characterId)
    clearTurnTimer(this.ws)
  }

  // ── Private persistence helpers ───────────────────────────────────────────

  // persistMutation removed — replaced by batchPersistMutations (8.1)

  private async saveCharacterState(reason: string): Promise<void> {
    const char = this.gameState.character
    const updates: Record<string, unknown> = {
      hp_current: Math.max(0, char.hp.current),
      hp_max: char.hp.max,
      xp: char.xp,
      gold: char.gold,
      level: char.level,
      resource_current: char.resource.current,
      resource_max: char.resource.max,
      stats: char.stats,
      skill_tree: char.skill_tree ?? {},
    }

    if (reason === "death") {
      updates.status = "dead"
      updates.died_at = new Date().toISOString()
      updates.gold = 0
    }

    await db.from("characters").update(updates).eq("id", this.characterId)
  }

  private async updateLeaderboard(reason: string): Promise<void> {
    const [{ data: character }, realmsCompleted] = await Promise.all([
      db
        .from("characters")
        .select(
          "name, class, created_at, accounts(handle, wallet_address, x_handle, github_handle, player_type)",
        )
        .eq("id", this.characterId)
        .single(),
      countCompletedRealms(db, this.characterId),
    ])
    if (!character) return

    const account = (character as Record<string, unknown>).accounts as
      | Record<string, unknown>
      | null

    await db.from("leaderboard_entries").upsert({
      character_id: this.characterId,
      character_name: character.name,
      class: character.class,
      player_type: (account?.player_type as string) ?? "human",
      level: this.gameState.character.level,
      xp: this.gameState.character.xp,
      deepest_floor: this.gameState.position.floor,
      realms_completed: realmsCompleted,
      status: reason === "death" ? "dead" : "alive",
      cause_of_death:
        reason === "death"
          ? ([...this.eventBuffer].reverse().find((e: GameEvent) => e.type === "enemy_attack")
              ?.detail ?? "Unknown")
          : null,
      owner_handle: (account?.handle as string) ?? "",
      owner_wallet: (account?.wallet_address as string) ?? "",
      x_handle: (account?.x_handle as string) ?? null,
      github_handle: (account?.github_handle as string) ?? null,
      created_at: character.created_at,
      died_at: reason === "death" ? new Date().toISOString() : null,
    })

    // Publish leaderboard delta via Redis for real-time lobby updates
    const pubsub = getPubSub()
    if (pubsub) {
      publishLeaderboardDelta(pubsub, {
        characterId: this.characterId,
        xp: this.gameState.character.xp,
        level: this.gameState.character.level,
        deepestFloor: this.gameState.position.floor,
      })
    }
  }

  private async handleDeath(): Promise<void> {
    // Create corpse container at death location
    const { data: corpse } = await db
      .from("corpse_containers")
      .insert({
        realm_instance_id: this.realmId,
        character_id: this.characterId,
        floor: this.gameState.position.floor,
        room_id: this.gameState.position.room_id,
        tile_x: this.gameState.position.tile.x,
        tile_y: this.gameState.position.tile.y,
        gold_amount: this.gameState.character.gold,
      })
      .select("id")
      .single()

    if (!corpse) return

    // Move all character inventory items to the corpse
    await db
      .from("inventory_items")
      .update({ owner_type: "corpse", owner_id: corpse.id })
      .eq("owner_type", "character")
      .eq("owner_id", this.characterId)
  }

  private async syncInventory(): Promise<void> {
    // Build the full set of rows from in-memory state
    const rows: Array<Record<string, unknown>> = []
    const keepIds: string[] = []

    for (const item of this.gameState.inventory) {
      keepIds.push(item.id)
      rows.push({
        id: item.id,
        character_id: this.characterId,
        owner_type: "character",
        owner_id: this.characterId,
        template_id: item.template_id,
        slot: null,
        quantity: item.quantity,
        modifiers: item.modifiers,
      })
    }

    for (const [slot, item] of Object.entries(this.gameState.equipment)) {
      if (!item) continue
      keepIds.push(item.id)
      rows.push({
        id: item.id,
        character_id: this.characterId,
        owner_type: "character",
        owner_id: this.characterId,
        template_id: item.template_id,
        slot,
        quantity: item.quantity,
        modifiers: item.modifiers,
      })
    }

    // Upsert all current items first (safe — creates or updates)
    if (rows.length > 0) {
      const { error: upsertErr } = await db
        .from("inventory_items")
        .upsert(rows, { onConflict: "id" })
      if (upsertErr) {
        console.error("syncInventory upsert failed:", upsertErr)
        return // abort — don't delete anything if upsert failed
      }
    }

    // Then delete rows that are no longer in memory (consumed/dropped items)
    let deleteQuery = db
      .from("inventory_items")
      .delete()
      .eq("owner_type", "character")
      .eq("owner_id", this.characterId)
    if (keepIds.length > 0) {
      deleteQuery = deleteQuery.not("id", "in", `(${keepIds.join(",")})`)
    }
    await deleteQuery
  }

  private buildRunSummary(): Record<string, unknown> {
    return buildRunSummaryFromEvents(this.eventBuffer, {
      floor: this.gameState.position.floor,
    })
  }
}

// ── WebSocket handlers (thin wrappers around GameSession) ─────────────────────

export async function handleGameOpen(
  ws: ServerWebSocket<GameSessionData>,
): Promise<void> {
  const session = await GameSession.create(ws)
  if (!session) {
    ws.send(
      JSON.stringify({ type: "error", message: "Failed to load realm state" }),
    )
    ws.close()
    return
  }

  registerActiveSession(ws.data.characterId, session)
  const obs = session.getInitialObservation()
  ws.send(JSON.stringify({ type: "observation", data: obs }))
  startTurnTimer(ws)
}

export async function handleGameMessage(
  ws: ServerWebSocket<GameSessionData>,
  message: string | Buffer,
): Promise<void> {
  clearTurnTimer(ws)

  let parsed: { type: string; data: unknown }
  try {
    parsed = JSON.parse(message.toString())
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
    startTurnTimer(ws)
    return
  }

  if (parsed.type !== "action") {
    ws.send(
      JSON.stringify({ type: "error", message: "Expected action message" }),
    )
    startTurnTimer(ws)
    return
  }

  // 9.2: Validate and sanitize the action payload before processing
  const validation = parseAction(parsed.data)
  if (!validation.valid) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: `Invalid action: ${validation.error}`,
      }),
    )
    startTurnTimer(ws)
    return
  }

  const session = getActivePlayerSession(ws.data.characterId)
  if (!session) {
    ws.send(JSON.stringify({ type: "error", message: "No active session" }))
    return
  }

  await session.processTurn(validation.action)

  // If session ended (death/extraction), don't restart the timer
  if (!getActivePlayerSession(ws.data.characterId)) return
  startTurnTimer(ws)
}

export async function handleGameClose(
  ws: ServerWebSocket<GameSessionData>,
): Promise<void> {
  clearTurnTimer(ws)
  const session = getActivePlayerSession(ws.data.characterId)
  if (session) {
    await session.endSession("disconnect")
  }
}

function getActivePlayerSession(characterId: string): GameSession | undefined {
  const session = getActiveSession(characterId)
  return session instanceof GameSession ? session : undefined
}

// ── Turn timer ────────────────────────────────────────────────────────────────

function startTurnTimer(ws: ServerWebSocket<GameSessionData>) {
  ws.data.turnTimer = setTimeout(() => {
    handleGameMessage(ws, JSON.stringify({ type: "action", data: { type: "wait" } }))
  }, TURN_TIMEOUT_MS)
}

function clearTurnTimer(ws: ServerWebSocket<GameSessionData>) {
  if (ws.data.turnTimer) {
    clearTimeout(ws.data.turnTimer)
    delete ws.data.turnTimer
  }
}
