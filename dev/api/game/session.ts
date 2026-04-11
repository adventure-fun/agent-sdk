import type { ServerWebSocket } from "bun"
import { CLASSES, REALMS, SKILL_TREES, SeededRng, applyStatGrowth, buildObservationFromState, buildRoomState, checkLevelUp, computeLegalActions, generateRealm, resolveTurn, toSpectatorObservation, type CharacterStats, type EquipSlot, type GameEvent, type GameState, type GeneratedRealm, type InventoryItem, type InventorySlot, type LobbyEvent, type Observation } from "../../engine/index.js"
import { isActionLegal, parseAction } from "./action-validator.js"
import { broadcastLobbyMessage, getActiveSession, getCharacterByAccountId, getRealmById, registerActiveSession, type ActiveSessionHandle, type PlayerSocketData, type SpectatorSocketData, unregisterActiveSession, updateCharacter, updateRealm } from "../store.js"

const TURN_TIMEOUT_MS = Number(process.env["TURN_TIMEOUT_SECONDS"] ?? 30) * 1000

const EQUIP_SLOTS: EquipSlot[] = ["weapon", "armor", "helm", "hands", "accessory"]

function cloneInventoryItem(item: InventoryItem): InventoryItem {
  return {
    ...item,
    modifiers: { ...item.modifiers },
    slot: item.slot ?? null,
  }
}

function cloneEquipment(equipment: Record<EquipSlot, InventoryItem | null>): Record<EquipSlot, InventoryItem | null> {
  return {
    weapon: equipment.weapon ? cloneInventoryItem(equipment.weapon) : null,
    armor: equipment.armor ? cloneInventoryItem(equipment.armor) : null,
    helm: equipment.helm ? cloneInventoryItem(equipment.helm) : null,
    hands: equipment.hands ? cloneInventoryItem(equipment.hands) : null,
    accessory: equipment.accessory ? cloneInventoryItem(equipment.accessory) : null,
  }
}

function applyEquipmentStats(baseStats: CharacterStats, equipment: Record<EquipSlot, InventoryItem | null>): CharacterStats {
  const effectiveStats: CharacterStats = { ...baseStats }
  for (const slot of EQUIP_SLOTS) {
    const item = equipment[slot]
    if (!item) continue
    for (const [stat, value] of Object.entries(item.modifiers)) {
      const statKey = stat as keyof CharacterStats
      if (statKey in effectiveStats && typeof value === "number") {
        effectiveStats[statKey] += value
      }
    }
  }
  return effectiveStats
}

function buildLootSummary(inventory: InventoryItem[], startingItemIds: ReadonlySet<string>): InventorySlot[] {
  return inventory
    .filter((item) => !startingItemIds.has(item.id))
    .map((item) => ({
      item_id: item.id,
      template_id: item.template_id,
      name: item.name,
      quantity: item.quantity,
      modifiers: item.modifiers,
    }))
}

function buildAbilities(characterClass: keyof typeof CLASSES, skillTree: Record<string, boolean>): string[] {
  const classTemplate = CLASSES[characterClass]
  if (!classTemplate) {
    throw new Error(`Unknown class: ${characterClass}`)
  }
  const abilities = [...new Set(classTemplate.starting_abilities ?? [])]
  const tree = SKILL_TREES[`${classTemplate.id}-tree`] ?? classTemplate.skill_tree

  for (const tier of tree?.tiers ?? []) {
    for (const choice of tier.choices) {
      if (!skillTree[choice.id]) continue
      if (choice.effect.type === "grant-ability" && choice.effect.ability_id) {
        if (!abilities.includes(choice.effect.ability_id)) {
          abilities.push(choice.effect.ability_id)
        }
      }
    }
  }

  return abilities
}

export class LocalGameSession implements ActiveSessionHandle {
  readonly characterId: string
  readonly realmId: string

  private readonly generatedRealm: GeneratedRealm
  private readonly rng: SeededRng
  private readonly ws: ServerWebSocket<PlayerSocketData>
  private readonly startingItemIds: Set<string>
  private readonly spectators = new Set<ServerWebSocket<SpectatorSocketData>>()
  private readonly eventBuffer: GameEvent[] = []
  private gameState: GameState
  private ended = false

  private constructor(
    ws: ServerWebSocket<PlayerSocketData>,
    gameState: GameState,
    generatedRealm: GeneratedRealm,
    rng: SeededRng,
    startingItemIds: Set<string>,
  ) {
    this.ws = ws
    this.characterId = ws.data.characterId
    this.realmId = ws.data.realmId
    this.gameState = gameState
    this.generatedRealm = generatedRealm
    this.rng = rng
    this.startingItemIds = startingItemIds
  }

  static async create(ws: ServerWebSocket<PlayerSocketData>): Promise<LocalGameSession | null> {
    const character = getCharacterByAccountId(ws.data.session.account_id)
    const realm = getRealmById(ws.data.realmId)
    if (!character || character.status !== "alive" || !realm || realm.character_id !== ws.data.characterId) {
      return null
    }

    const template = generateRealmTemplate(realm.template_id)
    const generatedRealm = generateRealm(template, realm.seed)
    const currentFloor = generatedRealm.floors[0]
    if (!currentFloor) {
      return null
    }

    const activeFloorRooms = currentFloor.rooms.map((room) =>
      buildRoomState(room, [], realm.template_id, realm.seed),
    )
    const equipment = cloneEquipment(character.equipment)
    const inventory = character.inventory.map(cloneInventoryItem)
    const effectiveStats = applyEquipmentStats(character.stats, equipment)
    const abilities = buildAbilities(character.class, character.skill_tree)
    const entranceTile = { x: 1, y: 1 }

    const gameState: GameState = {
      turn: 0,
      realm: {
        template_id: realm.template_id,
        template_version: realm.template_version,
        seed: realm.seed,
        total_floors: generatedRealm.total_floors,
      },
      character: {
        id: character.id,
        class: character.class,
        level: character.level,
        xp: character.xp,
        gold: character.gold,
        hp: {
          current: Math.min(character.hp_current, effectiveStats.hp),
          max: effectiveStats.hp,
        },
        resource: {
          type: character.resource_type,
          current: character.resource_current,
          max: character.resource_max,
        },
        stats: { ...character.stats },
        effective_stats: effectiveStats,
        buffs: [],
        debuffs: [],
        abilities,
        cooldowns: {},
        skill_tree: { ...character.skill_tree },
      },
      position: {
        floor: currentFloor.floor_number,
        room_id: currentFloor.entrance_room_id,
        tile: entranceTile,
      },
      inventory,
      equipment,
      activeFloor: { rooms: activeFloorRooms },
      discoveredTiles: {},
      roomsVisited: {},
      loreDiscovered: character.lore_discovered ?? [],
      mutatedEntities: [],
      questFlags: [],
      realmStatus: "active",
      portalActive: false,
    }

    const startingItemIds = new Set([
      ...inventory.map((item) => item.id),
      ...Object.values(equipment)
        .filter((item): item is InventoryItem => item != null)
        .map((item) => item.id),
    ])

    return new LocalGameSession(
      ws,
      gameState,
      generatedRealm,
      new SeededRng(realm.seed),
      startingItemIds,
    )
  }

  getInitialObservation(): Observation {
    const observation = buildObservationFromState(
      this.gameState,
      [],
      this.generatedRealm,
      this.startingItemIds,
    )
    observation.turn = this.gameState.turn
    return observation
  }

  getSpectatorObservation() {
    return toSpectatorObservation(this.getInitialObservation())
  }

  addSpectator(ws: ServerWebSocket<SpectatorSocketData>): void {
    this.spectators.add(ws)
  }

  removeSpectator(ws: ServerWebSocket<SpectatorSocketData>): void {
    this.spectators.delete(ws)
  }

  async processAction(rawAction: unknown): Promise<void> {
    if (this.ended) return

    const parsed = parseAction(rawAction)
    if (!parsed.valid) {
      this.ws.send(JSON.stringify({ type: "error", message: `Invalid action: ${parsed.error}` }))
      return
    }

    const currentRoom = this.findCurrentRoom()
    const legalActions = computeLegalActions(this.gameState, currentRoom, this.generatedRealm)
    if (!isActionLegal(parsed.action, legalActions)) {
      this.ws.send(JSON.stringify({ type: "error", message: `Illegal action: ${parsed.action.type}` }))
      return
    }

    const result = resolveTurn(this.gameState, parsed.action, this.generatedRealm, this.rng)
    this.gameState = result.newState

    const observation = buildObservationFromState(
      this.gameState,
      result.observation.recent_events,
      this.generatedRealm,
      this.startingItemIds,
    )
    observation.turn = this.gameState.turn

    for (const event of observation.recent_events) {
      this.eventBuffer.push(event)
    }

    this.broadcastNotableEvents(result.notableEvents)
    this.broadcastSpectators(observation)

    if (this.gameState.character.hp.current <= 0) {
      await this.handleDeath(observation)
      return
    }

    const extracted = observation.recent_events.some((event) =>
      event.type === "use_portal" || event.type === "retreat"
    )
    if (extracted) {
      await this.handleExtraction()
      return
    }

    this.syncCharacterSnapshot(false)
    this.syncRealmSnapshot("active")
    this.ws.send(JSON.stringify({ type: "observation", data: observation }))
  }

  async close(reason: "disconnect" | "death" | "extracted"): Promise<void> {
    if (this.ended) return
    if (reason === "disconnect") {
      this.syncCharacterSnapshot(false)
      this.syncRealmSnapshot("generated")
      unregisterActiveSession(this.characterId)
      this.ended = true
      this.closeSpectators("disconnect")
    }
  }

  private broadcastSpectators(observation: Observation): void {
    const spectatorObservation = toSpectatorObservation(observation)
    const payload = JSON.stringify({ type: "observation", data: spectatorObservation })
    for (const spectator of this.spectators) {
      spectator.send(payload)
    }
  }

  private broadcastNotableEvents(events: LobbyEvent[]): void {
    const character = getCharacterByAccountId(this.ws.data.session.account_id)
    for (const event of events) {
      broadcastLobbyMessage({
        type: "lobby_activity",
        data: {
          ...event,
          characterName: event.characterName || character?.name || "Unknown",
          characterClass: character?.class ?? event.characterClass,
        },
      })
    }
  }

  private async handleDeath(observation: Observation): Promise<void> {
    const character = getCharacterByAccountId(this.ws.data.session.account_id)
    const realm = getRealmById(this.realmId)
    if (character) {
      character.status = "dead"
      character.hp_current = 0
      character.died_at = new Date().toISOString()
      updateCharacter(character)
    }
    if (realm) {
      realm.status = "dead_end"
      realm.floor_reached = this.gameState.position.floor
      updateRealm(realm)
    }

    this.ws.send(JSON.stringify({
      type: "death",
      data: {
        cause: observation.recent_events.at(-1)?.detail ?? "Killed in action",
        floor: this.gameState.position.floor,
        room: this.gameState.position.room_id,
        turn: this.gameState.turn,
      },
    }))
    broadcastLobbyMessage({
      type: "lobby_activity",
      data: {
        type: "death",
        characterName: character?.name ?? "Unknown",
        characterClass: character?.class ?? "rogue",
        detail: "Fell in the local dev stack.",
        timestamp: Date.now(),
      },
    })
    unregisterActiveSession(this.characterId)
    this.ended = true
    this.closeSpectators("death")
  }

  private async handleExtraction(): Promise<void> {
    const character = getCharacterByAccountId(this.ws.data.session.account_id)
    const realm = getRealmById(this.realmId)
    if (!character || !realm) {
      this.ws.send(JSON.stringify({ type: "error", message: "Extraction failed to persist" }))
      return
    }

    const realmTemplate = generateRealmTemplate(realm.template_id)
    const realmCompleted = this.gameState.realmStatus === "boss_cleared" || this.gameState.realmStatus === "realm_cleared"
    const completionBonus = realmCompleted ? realmTemplate.completion_rewards : undefined

    character.inventory = this.gameState.inventory.map(cloneInventoryItem)
    character.equipment = cloneEquipment(this.gameState.equipment)
    character.gold = this.gameState.character.gold + (completionBonus?.gold ?? 0)
    character.xp = this.gameState.character.xp + (completionBonus?.xp ?? 0)
    character.hp_current = this.gameState.character.hp.current
    character.hp_max = this.gameState.character.hp.max
    character.resource_current = this.gameState.character.resource.current
    character.resource_max = this.gameState.character.resource.max
    character.stats = { ...this.gameState.character.stats }
    character.effective_stats = { ...this.gameState.character.effective_stats }
    character.lore_discovered = this.gameState.loreDiscovered ?? []

    const classTemplate = CLASSES[character.class]
    if (!classTemplate) {
      this.ws.send(JSON.stringify({ type: "error", message: `Unknown class: ${character.class}` }))
      return
    }
    const { newLevel, levelsGained } = checkLevelUp(character.level, character.xp)
    if (levelsGained > 0) {
      const growth = applyStatGrowth(character.stats, classTemplate.stat_growth, levelsGained)
      character.level = newLevel
      character.stats = growth.nextStats
      character.effective_stats = applyEquipmentStats(growth.nextStats, character.equipment)
      character.hp_max = character.effective_stats.hp
      character.hp_current = Math.min(character.hp_current + growth.statGains.hp, character.hp_max)
    }

    updateCharacter(character)

    realm.status = realmCompleted ? "completed" : "dead_end"
    realm.floor_reached = this.gameState.position.floor
    realm.completions = realmCompleted ? realm.completions + 1 : realm.completions
    updateRealm(realm)

    this.ws.send(JSON.stringify({
      type: "extracted",
      data: {
        loot_summary: buildLootSummary(this.gameState.inventory, this.startingItemIds),
        xp_gained: completionBonus?.xp ?? 0,
        gold_gained: completionBonus?.gold ?? 0,
        ...(completionBonus ? { completion_bonus: completionBonus } : {}),
        realm_completed: realmCompleted,
      },
    }))

    broadcastLobbyMessage({
      type: "lobby_activity",
      data: {
        type: "extraction",
        characterName: character.name,
        characterClass: character.class,
        detail: realmCompleted
          ? `Cleared ${realmTemplate.name} and extracted safely.`
          : `Extracted early from ${realmTemplate.name}.`,
        timestamp: Date.now(),
      },
    })

    unregisterActiveSession(this.characterId)
    this.ended = true
    this.closeSpectators("extraction")
  }

  private closeSpectators(reason: "death" | "disconnect" | "extraction"): void {
    const payload = JSON.stringify({ type: "session_ended", reason })
    for (const spectator of this.spectators) {
      spectator.send(payload)
      spectator.close()
    }
    this.spectators.clear()
  }

  private syncRealmSnapshot(status: "active" | "generated"): void {
    const realm = getRealmById(this.realmId)
    if (!realm) return
    realm.status = status
    realm.floor_reached = this.gameState.position.floor
    updateRealm(realm)
  }

  private syncCharacterSnapshot(updateVitalsOnly: boolean): void {
    const character = getCharacterByAccountId(this.ws.data.session.account_id)
    if (!character) return
    character.hp_current = this.gameState.character.hp.current
    character.hp_max = this.gameState.character.hp.max
    character.resource_current = this.gameState.character.resource.current
    character.resource_max = this.gameState.character.resource.max
    character.xp = this.gameState.character.xp
    character.gold = this.gameState.character.gold
    character.lore_discovered = this.gameState.loreDiscovered ?? []
    if (!updateVitalsOnly) {
      character.inventory = this.gameState.inventory.map(cloneInventoryItem)
      character.equipment = cloneEquipment(this.gameState.equipment)
      character.stats = { ...this.gameState.character.stats }
      character.effective_stats = { ...this.gameState.character.effective_stats }
    }
    updateCharacter(character)
  }

  private findCurrentRoom() {
    return this.gameState.activeFloor.rooms.find((room) => room.id === this.gameState.position.room_id)
  }
}

function generateRealmTemplate(templateId: string) {
  const template = REALMS[templateId]
  if (!template) {
    throw new Error(`Unknown realm template: ${templateId}`)
  }
  return template
}

export async function handleGameOpen(ws: ServerWebSocket<PlayerSocketData>): Promise<void> {
  const session = await LocalGameSession.create(ws)
  if (!session) {
    ws.send(JSON.stringify({ type: "error", message: "Failed to load realm state" }))
    ws.close()
    return
  }

  registerActiveSession(session)
  ws.send(JSON.stringify({ type: "observation", data: session.getInitialObservation() }))
  startTurnTimer(ws)
}

export async function handleGameMessage(
  ws: ServerWebSocket<PlayerSocketData>,
  message: string | Buffer,
): Promise<void> {
  clearTurnTimer(ws)

  let parsed: { type?: string; data?: unknown }
  try {
    parsed = JSON.parse(message.toString()) as { type?: string; data?: unknown }
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
    startTurnTimer(ws)
    return
  }

  if (parsed.type !== "action") {
    ws.send(JSON.stringify({ type: "error", message: "Expected action message" }))
    startTurnTimer(ws)
    return
  }

  const session = getActiveSession(ws.data.characterId)
  if (!session) {
    ws.send(JSON.stringify({ type: "error", message: "No active session" }))
    return
  }

  await session.processAction(parsed.data)
  if (getActiveSession(ws.data.characterId)) {
    startTurnTimer(ws)
  }
}

export async function handleGameClose(ws: ServerWebSocket<PlayerSocketData>): Promise<void> {
  clearTurnTimer(ws)
  const session = getActiveSession(ws.data.characterId)
  await session?.close("disconnect")
}

function startTurnTimer(ws: ServerWebSocket<PlayerSocketData>): void {
  ws.data.turnTimer = setTimeout(() => {
    void handleGameMessage(ws, JSON.stringify({ type: "action", data: { type: "wait" as const } }))
  }, TURN_TIMEOUT_MS)
}

function clearTurnTimer(ws: ServerWebSocket<PlayerSocketData>): void {
  if (ws.data.turnTimer) {
    clearTimeout(ws.data.turnTimer)
    delete ws.data.turnTimer
  }
}
