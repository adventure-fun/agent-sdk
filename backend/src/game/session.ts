import type { ServerWebSocket } from "bun"
import type {
  Action,
  GameState,
  GameEvent,
  WorldMutation,
  InventoryItem,
  Observation,
  CharacterStats,
  EquipSlot,
  ResourceType,
} from "@adventure-fun/schemas"
import {
  generateRealm,
  REALMS,
  SeededRng,
  resolveTurn,
  buildObservationFromState,
  buildRoomState,
} from "@adventure-fun/engine"
import type { GeneratedRealm } from "@adventure-fun/engine"
import { db } from "../db/client.js"
import type { SessionPayload } from "../auth/jwt.js"

const TURN_TIMEOUT_MS =
  Number(process.env["TURN_TIMEOUT_SECONDS"] ?? 30) * 1000

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GameSessionData {
  realmId: string
  session: SessionPayload
  characterId: string
  turnTimer?: ReturnType<typeof setTimeout>
}

// ── Active sessions ───────────────────────────────────────────────────────────

/** Map of characterId → active GameSession */
const activeSessions = new Map<string, GameSession>()

// ── GameSession class ─────────────────────────────────────────────────────────

class GameSession {
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

    const [realmRes, charRes, mutRes, mapRes, invRes] = await Promise.all([
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
      class_specific: null,
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

    const gameState: GameState = {
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
        effective_stats: { ...stats },
        buffs: [],
        debuffs: [],
        cooldowns: {},
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
      mutatedEntities,
      realmStatus:
        realm.status === "boss_cleared" ? "boss_cleared" : "active",
    }

    const turn = (realm.last_turn as number) ?? 0
    const rng = new SeededRng(realm.seed + turn)

    return new GameSession(ws, gameState, generated, rng, turn)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getInitialObservation(): Observation {
    const obs = buildObservationFromState(
      this.gameState,
      [],
      this.generatedRealm,
    )
    obs.turn = this.turn
    return obs
  }

  async processTurn(action: Action): Promise<void> {
    if (this.ended) return

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

    // Persist world mutations to DB (only when world state actually changed)
    for (const mutation of result.worldMutations) {
      await this.persistMutation(mutation)
    }

    // Update in-memory state
    this.gameState = result.newState
    result.observation.turn = this.turn

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
    if (action.type === "use_portal" || action.type === "retreat") {
      const lootSummary = this.gameState.inventory.map((i) => ({
        item_id: i.id,
        template_id: i.template_id,
        name: i.name,
        quantity: i.quantity,
        modifiers: i.modifiers,
      }))
      this.ws.send(
        JSON.stringify({
          type: "extracted",
          data: {
            loot_summary: lootSummary,
            xp_gained: this.gameState.character.xp,
          },
        }),
      )
      await this.endSession("extraction")
      return
    }

    // Normal turn — send observation
    this.ws.send(
      JSON.stringify({ type: "observation", data: result.observation }),
    )
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

      // 3. Update realm instance
      const realmStatus =
        reason === "death"
          ? "dead_end"
          : this.gameState.realmStatus === "boss_cleared"
            ? "completed"
            : "paused"
      await db
        .from("realm_instances")
        .update({
          status: realmStatus,
          last_turn: this.turn,
          current_room_id: this.gameState.position.room_id,
          tile_x: this.gameState.position.tile.x,
          tile_y: this.gameState.position.tile.y,
          floor_reached: this.gameState.position.floor,
          last_active_at: new Date().toISOString(),
        })
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
    activeSessions.delete(this.characterId)
    clearTurnTimer(this.ws)
  }

  // ── Private persistence helpers ───────────────────────────────────────────

  private async persistMutation(mutation: WorldMutation): Promise<void> {
    // Write the mutation
    await db.from("realm_mutations").insert({
      realm_instance_id: this.realmId,
      entity_id: mutation.entity_id,
      mutation: mutation.mutation,
      turn: this.turn,
      floor: mutation.floor,
      metadata: mutation.metadata,
    })

    // Piggyback position + turn update (no extra round trip needed later)
    await db
      .from("realm_instances")
      .update({
        last_turn: this.turn,
        current_room_id: this.gameState.position.room_id,
        tile_x: this.gameState.position.tile.x,
        tile_y: this.gameState.position.tile.y,
        floor_reached: this.gameState.position.floor,
      })
      .eq("id", this.realmId)
  }

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
    }

    if (reason === "death") {
      updates.status = "dead"
      updates.died_at = new Date().toISOString()
      updates.gold = 0
    }

    await db.from("characters").update(updates).eq("id", this.characterId)
  }

  private async updateLeaderboard(reason: string): Promise<void> {
    const { data: character } = await db
      .from("characters")
      .select(
        "name, class, created_at, accounts(handle, wallet_address, x_handle, github_handle, player_type)",
      )
      .eq("id", this.characterId)
      .single()
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
      realms_completed: 0, // TODO: query + increment
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
    // Delete all current character inventory rows and re-insert from memory
    await db
      .from("inventory_items")
      .delete()
      .eq("owner_type", "character")
      .eq("owner_id", this.characterId)

    const rows: Array<Record<string, unknown>> = []

    for (const item of this.gameState.inventory) {
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

    if (rows.length > 0) {
      await db.from("inventory_items").insert(rows)
    }
  }

  private buildRunSummary(): Record<string, unknown> {
    let enemiesKilled = 0
    let damageDealt = 0
    let damageTaken = 0
    let chestsOpened = 0
    let xpEarned = 0
    let potionsConsumed = 0
    let turnsInCombat = 0
    let turnsExploring = 0
    let causeOfDeath: string | null = null
    const abilitiesUsed: Record<string, number> = {}

    for (const event of this.eventBuffer) {
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
        case "interact":
          chestsOpened++
          break
        case "move":
        case "floor_change":
          turnsExploring++
          break
        case "use_item":
          potionsConsumed++
          break
      }
    }

    return {
      enemies_killed: enemiesKilled,
      damage_dealt: damageDealt,
      damage_taken: damageTaken,
      chests_opened: chestsOpened,
      xp_earned: xpEarned,
      deepest_floor: this.gameState.position.floor,
      abilities_used: abilitiesUsed,
      potions_consumed: potionsConsumed,
      turns_in_combat: turnsInCombat,
      turns_exploring: turnsExploring,
      cause_of_death: causeOfDeath,
    }
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

  activeSessions.set(ws.data.characterId, session)
  const obs = session.getInitialObservation()
  ws.send(JSON.stringify({ type: "observation", data: obs }))
  startTurnTimer(ws)
}

export async function handleGameMessage(
  ws: ServerWebSocket<GameSessionData>,
  message: string | Buffer,
): Promise<void> {
  clearTurnTimer(ws)

  let parsed: { type: string; data: Action }
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

  const session = activeSessions.get(ws.data.characterId)
  if (!session) {
    ws.send(JSON.stringify({ type: "error", message: "No active session" }))
    return
  }

  await session.processTurn(parsed.data)

  // If session ended (death/extraction), don't restart the timer
  if (!activeSessions.has(ws.data.characterId)) return
  startTurnTimer(ws)
}

export async function handleGameClose(
  ws: ServerWebSocket<GameSessionData>,
): Promise<void> {
  clearTurnTimer(ws)
  const session = activeSessions.get(ws.data.characterId)
  if (session) {
    await session.endSession("disconnect")
  }
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
