/**
 * Turn resolution engine for Adventure.fun
 *
 * Pure function: no side effects, no DB calls. All state changes are
 * returned as a TurnResult for the session layer to persist.
 *
 * The session layer (GameSession class) calls resolveTurn() each turn,
 * then persists worldMutations to DB, updates Redis, and sends the
 * observation to the player.
 */

import { getInventoryCapacity } from "@adventure-fun/schemas"
import type {
  GameState,
  Action,
  TurnResult,
  WorldMutation,
  MutationType,
  Observation,
  SpectatorObservation,
  Tile,
  Entity,
  GameEvent,
  LobbyEvent,
  InventoryItem,
  ActiveEffect,
  CharacterStats,
  EquipSlot,
  InventorySlot,
  KnownMapData,
  SpectatorEntity,
  ItemTemplate,
  RoomTemplate,
  AbilitySummary,
  AbilityTemplate,
} from "@adventure-fun/schemas"
import type { GeneratedRealm, GeneratedFloor, GeneratedRoom } from "./realm.js"
import {
  resolveAttack,
  resolveStatusEffectTick,
  type Combatant,
} from "./combat.js"
import {
  computeVisibleTiles,
  hasLineOfSight,
  tileKey,
  parseTileKey,
  mergeDiscoveredTiles,
  type Position,
} from "./visibility.js"
import { getAbility, getEnemy, getEnemySafe, getItem, CLASSES, ROOMS, REALMS } from "./content.js"
import { SeededRng, deriveSeed } from "./rng.js"
import { applyStatGrowth, checkLevelUp, xpToNextLevel } from "./leveling.js"

// ── Internal types ────────────────────────────────────────────────────────────

type RoomState = GameState["activeFloor"]["rooms"][number]

type Direction = "up" | "down" | "left" | "right"

const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

const RESOURCE_COLOR_HINTS: Record<GameState["character"]["resource"]["type"], string> = {
  stamina: "amber",
  mana: "blue",
  energy: "emerald",
  focus: "violet",
}

const EMPTY_ITEM_ID_SET = new Set<string>()

const PATROL_DETECTION_RANGE = 4
const AMBUSH_TRIGGER_RANGE = 2
const DEFENSIVE_RETREAT_HP_THRESHOLD = 0.4
const ROGUE_DISARM_TRAP_ABILITY_ID = "rogue-disarm-trap"
const CHARACTER_STAT_KEYS: Array<keyof CharacterStats> = [
  "hp",
  "attack",
  "defense",
  "accuracy",
  "evasion",
  "speed",
]

function isCharacterStatKey(key: string): key is keyof CharacterStats {
  return CHARACTER_STAT_KEYS.includes(key as keyof CharacterStats)
}

function hasEffect(
  effects: ActiveEffect[],
  type: ActiveEffect["type"],
): boolean {
  return effects.some((effect) => effect.type === type)
}

function getCombinedEffects(
  ...effectLists: Array<ActiveEffect[] | undefined>
): ActiveEffect[] {
  return effectLists.flatMap((effects) => effects ?? [])
}

function applyEffects(
  target: ActiveEffect[],
  effects: AbilityTemplate["effects"] | undefined,
) {
  for (const effect of effects ?? []) {
    if (Math.random() < 0) {
      // never reached; keeps TS from narrowing runtime-authored JSON effects too aggressively
      continue
    }
    target.push({
      type: effect.type,
      turns_remaining: effect.duration_turns,
      magnitude: effect.magnitude,
    })
  }
}

function normalizeAbilityTarget(
  target: AbilityTemplate["target"],
): "single" | "aoe" | "self" | "single-or-self" {
  return target === "single_or_self" ? "single-or-self" : target
}

function getPlayerAbilityIds(state: GameState): string[] {
  return [...new Set(["basic-attack", ...state.character.abilities])]
}

function buildAbilitySummaries(state: GameState): AbilitySummary[] {
  return getPlayerAbilityIds(state).flatMap((abilityId) => {
    try {
      const ability = getAbility(abilityId)
      return [{
        id: ability.id,
        name: ability.name,
        description: ability.description,
        resource_cost: ability.resource_cost,
        cooldown_turns: ability.cooldown_turns,
        current_cooldown: state.character.cooldowns[ability.id] ?? 0,
        range: ability.range,
        target: normalizeAbilityTarget(ability.target),
      }]
    } catch {
      return []
    }
  })
}

function getAbilityRangeDistance(
  from: Position,
  to: Position,
): number {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
}

function roomToVisibilityRoom(room: RoomState) {
  return {
    id: room.id,
    width: room.tiles[0]?.length ?? 0,
    height: room.tiles.length,
    tiles: room.tiles,
  }
}

function isAbilityTargetInRange(
  room: RoomState,
  from: Position,
  to: Position,
  ability: AbilityTemplate,
): boolean {
  const dist = getAbilityRangeDistance(from, to)
  if (ability.range === "melee") {
    return dist <= 1
  }

  return dist <= ability.range && hasLineOfSight(roomToVisibilityRoom(room), from, to)
}

function canUseAbility(
  state: GameState,
  ability: AbilityTemplate,
): boolean {
  return (
    (state.character.cooldowns[ability.id] ?? 0) <= 0 &&
    state.character.resource.current >= ability.resource_cost
  )
}

function hasTrapDisarmAbility(state: GameState): boolean {
  return (
    state.character.class === "rogue" &&
    state.character.abilities.includes(ROGUE_DISARM_TRAP_ABILITY_ID)
  )
}

function getTrapMarkerId(itemId: string): string {
  return `${itemId}_trap`
}

function roomHasLiveEnemies(room: RoomState): boolean {
  return room.enemies.some((enemy) => enemy.hp > 0)
}

function hasPortalScroll(state: GameState): boolean {
  return state.inventory.some((item) => item.template_id === "portal-scroll")
}

const DEFAULT_ARCHER_AMMO = "ammo-arrows-10"

function getRequiredAmmoType(state: GameState): string {
  const weapon = state.equipment.weapon
  if (!weapon) return DEFAULT_ARCHER_AMMO
  try {
    const template = getItem(weapon.template_id)
    return template.ammo_type ?? DEFAULT_ARCHER_AMMO
  } catch {
    return DEFAULT_ARCHER_AMMO
  }
}

function getAmmoCount(state: GameState): number {
  const ammoType = getRequiredAmmoType(state)
  return state.inventory
    .filter((item) => item.template_id === ammoType)
    .reduce((sum, item) => sum + item.quantity, 0)
}

function consumeAmmo(state: GameState): boolean {
  const ammoType = getRequiredAmmoType(state)
  const ammoItem = state.inventory.find(
    (item) => item.template_id === ammoType && item.quantity > 0,
  )
  if (!ammoItem) return false
  if (ammoItem.quantity > 1) {
    ammoItem.quantity -= 1
  } else {
    state.inventory.splice(state.inventory.indexOf(ammoItem), 1)
  }
  return true
}

function abilityRequiresAmmo(state: GameState, ability: AbilityTemplate): boolean {
  return state.character.class === "archer" && ability.range !== "melee"
}

function getEffectiveInventoryCapacity(_state: GameState): number {
  return getInventoryCapacity()
}

function getInventoryStackTarget(
  inventory: GameState["inventory"],
  templateId: string,
  stackLimit: number,
): InventoryItem | undefined {
  return inventory.find(
    (item) => item.template_id === templateId && item.quantity < stackLimit,
  )
}

function canAddInventoryItem(
  state: GameState,
  templateId: string,
  stackLimit: number,
): { stackTarget: InventoryItem | undefined; hasSpace: boolean; slotsUsed: number; capacity: number } {
  const stackTarget = getInventoryStackTarget(state.inventory, templateId, stackLimit)
  const slotsUsed = state.inventory.length
  const capacity = getEffectiveInventoryCapacity(state)
  return {
    stackTarget,
    hasSpace: Boolean(stackTarget) || slotsUsed < capacity,
    slotsUsed,
    capacity,
  }
}

function getVisitedRooms(
  state: GameState,
  floor: number,
): string[] {
  return state.roomsVisited?.[floor] ?? []
}

function hasVisitedRoom(
  state: GameState,
  floor: number,
  roomId: string,
): boolean {
  return getVisitedRooms(state, floor).includes(roomId)
}

function markRoomVisited(
  state: GameState,
  floor: number,
  roomId: string,
): void {
  if (!state.roomsVisited) {
    state.roomsVisited = {}
  }
  const visited = state.roomsVisited[floor] ?? []
  if (!visited.includes(roomId)) {
    state.roomsVisited[floor] = [...visited, roomId]
  }
}

function rememberLoreDiscovery(
  state: GameState,
  loreEntryId: string | null | undefined,
): void {
  if (!loreEntryId) return
  if (!state.loreDiscovered) {
    state.loreDiscovered = []
  }
  if (
    state.loreDiscovered.some(
      (entry) => entry.lore_entry_id === loreEntryId,
    )
  ) {
    return
  }
  state.loreDiscovered.push({
    lore_entry_id: loreEntryId,
    discovered_at_turn: state.turn,
  })
}

function formatLoreLabel(loreId: string): string {
  return loreId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getPlacementTiles(tiles: Tile[][]): Position[] {
  const floorTiles: Position[] = []
  const fallbackTiles: Position[] = []
  for (const row of tiles) {
    for (const tile of row) {
      if (tile.type !== "wall") {
        fallbackTiles.push({ x: tile.x, y: tile.y })
      }
      if (tile.type === "floor") {
        floorTiles.push({ x: tile.x, y: tile.y })
      }
    }
  }
  return floorTiles.length > 0
    ? floorTiles
    : fallbackTiles.length > 0
      ? fallbackTiles
      : [{ x: 1, y: 1 }]
}

function claimPlacementPosition(
  availableTiles: Position[],
  occupied: Set<string>,
  rng: SeededRng,
  preferred?: Position,
): Position {
  const candidates = availableTiles.filter((tile) => !occupied.has(tileKey(tile)))
  if (candidates.length === 0) {
    return preferred ? { ...preferred } : { x: 1, y: 1 }
  }

  let chosen: Position | undefined
  if (preferred) {
    chosen = candidates.find(
      (tile) => tile.x === preferred.x && tile.y === preferred.y,
    )
    if (!chosen) {
      chosen = [...candidates].sort((left, right) => {
        const leftDistance = getAbilityRangeDistance(left, preferred)
        const rightDistance = getAbilityRangeDistance(right, preferred)
        if (leftDistance !== rightDistance) return leftDistance - rightDistance
        if (left.y !== right.y) return left.y - right.y
        return left.x - right.x
      })[0]
    }
  } else {
    chosen = candidates[Math.floor(rng.next() * candidates.length)]
  }

  const resolved = chosen ?? candidates[0] ?? { x: 1, y: 1 }
  occupied.add(tileKey(resolved))
  return { ...resolved }
}

function getInteractableMapPosition(room: RoomState): Position {
  return {
    x: Math.max(1, Math.floor((room.tiles[0]?.length ?? 1) / 2)),
    y: Math.max(1, Math.floor(room.tiles.length / 2)),
  }
}

function revealCurrentFloorMap(
  state: GameState,
  realm: GeneratedRealm,
): number {
  const floor = state.position.floor
  const generatedFloor = realm.floors.find((entry) => entry.floor_number === floor)
  if (!generatedFloor) return 0

  const existing = new Set(
    (state.discoveredTiles[floor] ?? []).map((tile) => tileKey(tile)),
  )
  let revealed = 0
  for (const room of generatedFloor.rooms) {
    markRoomVisited(state, floor, room.id)
    for (const row of room.tiles) {
      for (const tile of row) {
        const key = tileKey(tile)
        if (existing.has(key)) continue
        existing.add(key)
        revealed++
      }
    }
  }
  state.discoveredTiles[floor] = [...existing].map(parseTileKey)
  return revealed
}

function canUsePortal(state: GameState, room: RoomState): boolean {
  return !roomHasLiveEnemies(room) && (state.portalActive === true || hasPortalScroll(state))
}

function isAtRealmEntrance(state: GameState, realm: GeneratedRealm): boolean {
  return (
    state.position.floor === 1 &&
    state.position.room_id === (realm.floors[0]?.entrance_room_id ?? "")
  )
}

function canRetreat(state: GameState, room: RoomState, realm: GeneratedRealm): boolean {
  return !roomHasLiveEnemies(room) && isAtRealmEntrance(state, realm)
}

function isLastRoomOnLastFloor(state: GameState, room: RoomState, realm: GeneratedRealm): boolean {
  if (state.position.floor !== realm.total_floors) {
    return false
  }

  const currentFloor = realm.floors.find((floor) => floor.floor_number === state.position.floor)
  const finalRoomId = currentFloor?.rooms.at(-1)?.id
  return finalRoomId != null && room.id === finalRoomId
}

function isBosslessRealmCleared(state: GameState, room: RoomState, realm: GeneratedRealm): boolean {
  const realmTemplate = REALMS[state.realm.template_id]
  if (!realmTemplate || realmTemplate.boss_id != null) {
    return false
  }

  return isLastRoomOnLastFloor(state, room, realm) && !roomHasLiveEnemies(room)
}

function consumePortalScroll(state: GameState): boolean {
  const itemIdx = state.inventory.findIndex((item) => item.template_id === "portal-scroll")
  if (itemIdx < 0) return false

  const item = state.inventory[itemIdx]
  if (!item) return false

  if (item.quantity > 1) {
    item.quantity -= 1
  } else {
    state.inventory.splice(itemIdx, 1)
  }

  return true
}

function applyHeal(
  current: number,
  max: number,
  amount: number,
): number {
  return Math.min(max, current + Math.max(0, amount))
}

function getAbilityDamageFormula(
  ability: AbilityTemplate,
): {
  base: number
  stat_scaling: keyof CharacterStats
  scaling_factor: number
} {
  const statScaling = ability.damage_formula.stat_scaling
  const validStat = (
    ["hp", "attack", "defense", "accuracy", "evasion", "speed"] as const
  ).includes(statScaling as keyof CharacterStats)
    ? (statScaling as keyof CharacterStats)
    : "attack"

  return {
    base: ability.damage_formula.base,
    stat_scaling: validStat,
    scaling_factor: ability.damage_formula.scaling_factor,
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function resolveTurn(
  state: GameState,
  action: Action,
  realm: GeneratedRealm,
  rng: SeededRng,
): TurnResult {
  const s = structuredClone(state)
  s.turn += 1
  const mutations: WorldMutation[] = []
  const events: GameEvent[] = []
  const notableEvents: LobbyEvent[] = []
  let summary = ""
  let roomChanged = false

  const room = getCurrentRoom(s)
  if (!room) {
    return result(s, mutations, events, "Error: invalid room", false, notableEvents, realm)
  }

  const preTurnDebuffs = [...s.character.debuffs]
  let regenBonusEligible = false
  let didExtract = false

  // 1. Status effect ticks (poison, etc.)
  const statusDmg = processStatusEffects(s, events)
  if (s.character.hp.current <= 0) {
    notableEvents.push(deathEvent(s, "Succumbed to status effects"))
    return result(s, mutations, events, "You succumbed to your wounds.", false, notableEvents, realm)
  }

  tickCooldowns(s, room)

  // 2. Resolve player action
  if (hasEffect(preTurnDebuffs, "stun")) {
    summary = "You are stunned and cannot act."
    events.push({ turn: 0, type: "status_stun", detail: summary, data: {} })
  } else {
    switch (action.type) {
      case "move": {
        if (hasEffect(preTurnDebuffs, "slow")) {
          summary = "You are slowed and fail to reposition in time."
          events.push({ turn: 0, type: "status_slow", detail: summary, data: {} })
          break
        }
        const r = resolveMove(s, room, action.direction, realm, events)
        summary = r.summary
        roomChanged = r.roomChanged
        break
      }
      case "attack": {
        const r = resolvePlayerAttack(s, room, action, realm, rng, events, mutations, preTurnDebuffs)
        summary = r.summary
        regenBonusEligible = r.regenBonusEligible
        if (r.notableEvent) notableEvents.push(r.notableEvent)
        break
      }
      case "use_item": {
        summary = resolveUseItem(s, action, events, realm)
        break
      }
      case "pickup": {
        summary = resolvePickup(s, room, action, rng, events, mutations)
        break
      }
      case "disarm_trap": {
        summary = resolveDisarmTrap(s, room, action, events, mutations)
        break
      }
      case "interact": {
        summary = resolveInteract(s, room, action, realm, events, mutations)
        break
      }
      case "inspect": {
        summary = resolveInspect(room, action, events)
        break
      }
      case "equip": {
        summary = resolveEquip(s, action, events)
        break
      }
      case "unequip": {
        summary = resolveUnequip(s, action, events)
        break
      }
      case "drop": {
        summary = resolveDrop(s, room, action, events)
        break
      }
      case "wait": {
        summary = "You wait and watch."
        events.push({ turn: 0, type: "wait", detail: "Waited", data: {} })
        break
      }
      case "use_portal":
      case "retreat": {
        if (action.type === "use_portal") {
          if (!canUsePortal(s, room)) {
            summary = "You need an active portal or a portal scroll to escape."
            events.push({ turn: 0, type: "blocked", detail: summary, data: { action: action.type } })
            break
          }

          if (!s.portalActive && !consumePortalScroll(s)) {
            summary = "You reach for a portal scroll, but none is available."
            events.push({ turn: 0, type: "blocked", detail: summary, data: { action: action.type } })
            break
          }

          didExtract = true
          summary = "You step through the portal and return to safety."
          events.push({ turn: 0, type: action.type, detail: summary, data: {} })
          break
        }

        if (!canRetreat(s, room, realm)) {
          summary = "You can only retreat from the entrance to the first floor."
          events.push({ turn: 0, type: "blocked", detail: summary, data: { action: action.type } })
          break
        }

        didExtract = true
        summary = "You retreat from the realm."
        events.push({ turn: 0, type: action.type, detail: summary, data: {} })
        break
      }
    }
  }

  const currentRoom = getCurrentRoom(s) ?? room

  if (s.character.hp.current <= 0) {
    notableEvents.push(deathEvent(s, events.at(-1)?.detail ?? "You were slain."))
    updateVisibility(s, currentRoom, realm)
    return result(s, mutations, events, summary.trim(), roomChanged, notableEvents, realm)
  }

  // 3. Enemy turns (skip if extracting)
  if (!didExtract) {
    const er = resolveEnemyTurns(s, currentRoom, realm, rng, events, mutations)
    if (er.summary) summary += " " + er.summary
    if (er.playerDied) {
      notableEvents.push(deathEvent(s, er.killedBy ?? "Killed by an enemy"))
    }
  }

  applyResourceRegen(s, regenBonusEligible)

  // 4. Visibility
  updateVisibility(s, currentRoom, realm)

  return result(s, mutations, events, summary.trim(), roomChanged, notableEvents, realm)
}

// ── Action resolvers ──────────────────────────────────────────────────────────

function resolveMove(
  s: GameState,
  room: RoomState,
  direction: Direction,
  realm: GeneratedRealm,
  events: GameEvent[],
): { summary: string; roomChanged: boolean } {
  const delta = DIRECTION_DELTA[direction]
  const nx = s.position.tile.x + delta.dx
  const ny = s.position.tile.y + delta.dy
  const height = room.tiles.length
  const width = room.tiles[0]?.length ?? 0

  // Out of bounds → blocked
  if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
    events.push({ turn: 0, type: "blocked", detail: "Path blocked", data: { direction } })
    return { summary: "The way is blocked.", roomChanged: false }
  }

  const targetTile = room.tiles[ny]?.[nx]
  if (!targetTile || targetTile.type === "wall") {
    return { summary: "The way is blocked.", roomChanged: false }
  }

  // Check if an enemy occupies the target tile
  const blocking = room.enemies.find(
    (e) => e.hp > 0 && e.position.x === nx && e.position.y === ny,
  )
  if (blocking) {
    return { summary: "An enemy blocks the way.", roomChanged: false }
  }

  // Move the player onto the tile
  s.position.tile = { x: nx, y: ny }
  events.push({ turn: 0, type: "move", detail: `Moved ${direction}`, data: { direction, x: nx, y: ny } })

  // Door tile → room transition
  if (targetTile.type === "door") {
    const transition = tryRoomTransition(s, room, direction, realm)
    if (transition) {
      events.push({ turn: 0, type: "room_change", detail: `Entered ${transition.roomId}`, data: { direction } })
      return { summary: transition.summary, roomChanged: true }
    }
  }

  // Stairs tile → floor transition
  if (targetTile.type === "stairs") {
    const ft = tryFloorTransition(s, realm, events)
    if (ft) return { summary: ft.summary, roomChanged: true }
  }

  // Up-stairs tile → floor ascent
  if (targetTile.type === "stairs_up") {
    const ft = tryFloorAscent(s, realm, events)
    if (ft) return { summary: ft.summary, roomChanged: true }
  }

  return { summary: `You move ${direction}.`, roomChanged: false }
}

function tryRoomTransition(
  s: GameState,
  room: RoomState,
  direction: Direction,
  realm: GeneratedRealm,
): { roomId: string; summary: string } | null {
  const genFloor = realm.floors.find((f) => f.floor_number === s.position.floor)
  if (!genFloor) return null

  const roomIdx = genFloor.rooms.findIndex((r) => r.id === room.id)
  if (roomIdx < 0) return null

  // Linear room chain: right/down → next room, left/up → previous room
  let targetIdx: number
  if (direction === "right" || direction === "down") {
    targetIdx = roomIdx + 1
  } else {
    targetIdx = roomIdx - 1
  }

  const targetGenRoom = genFloor.rooms[targetIdx]
  if (!targetGenRoom) return null

  // Find or create the room state in activeFloor
  let targetRoom = s.activeFloor.rooms.find((r) => r.id === targetGenRoom.id)
  if (!targetRoom) {
    // Room not yet loaded — build it from generated data
    targetRoom = buildRoomState(targetGenRoom, s.mutatedEntities, s.realm.template_id, s.realm.seed)
    s.activeFloor.rooms.push(targetRoom)
  }

  const th = targetRoom.tiles.length
  const tw = targetRoom.tiles[0]?.length ?? 0

  // Place player at the opposite edge of the target room
  if (direction === "right" || direction === "down") {
    s.position.tile = { x: 1, y: Math.floor(th / 2) }
  } else {
    s.position.tile = { x: tw - 2, y: Math.floor(th / 2) }
  }

  s.position.room_id = targetGenRoom.id
  return { roomId: targetGenRoom.id, summary: `You enter a new area.` }
}

function tryFloorTransition(
  s: GameState,
  realm: GeneratedRealm,
  events: GameEvent[],
): { summary: string } | null {
  const nextFloorNum = s.position.floor + 1
  const nextGenFloor = realm.floors.find((f) => f.floor_number === nextFloorNum)
  if (!nextGenFloor) return null

  const nextRooms = nextGenFloor.rooms.map((gr) =>
    buildRoomState(gr, s.mutatedEntities, s.realm.template_id, s.realm.seed),
  )
  const entranceRoom =
    nextRooms.find((room) => room.id === nextGenFloor.entrance_room_id) ?? nextRooms[0]
  if (!entranceRoom) return null

  s.activeFloor.rooms = nextRooms
  s.position.floor = nextFloorNum
  s.position.room_id = nextGenFloor.entrance_room_id
  s.position.tile = getFloorTransitionEntryTile(entranceRoom, "stairs_up")

  events.push({
    turn: 0,
    type: "floor_change",
    detail: `Descended to floor ${nextFloorNum}`,
    data: { floor: nextFloorNum, direction: "down" },
  })

  return { summary: `You descend to floor ${nextFloorNum}.` }
}

function tryFloorAscent(
  s: GameState,
  realm: GeneratedRealm,
  events: GameEvent[],
): { summary: string } | null {
  const prevFloorNum = s.position.floor - 1
  if (prevFloorNum < 1) return null

  const prevGenFloor = realm.floors.find((f) => f.floor_number === prevFloorNum)
  if (!prevGenFloor) return null

  const targetRoomId = prevGenFloor.exit_room_id ?? prevGenFloor.rooms.at(-1)?.id
  if (!targetRoomId) return null

  const prevRooms = prevGenFloor.rooms.map((gr) =>
    buildRoomState(gr, s.mutatedEntities, s.realm.template_id, s.realm.seed),
  )
  const targetRoom = prevRooms.find((room) => room.id === targetRoomId)
  if (!targetRoom) return null

  s.activeFloor.rooms = prevRooms
  s.position.floor = prevFloorNum
  s.position.room_id = targetRoomId
  s.position.tile = getFloorTransitionEntryTile(targetRoom, "stairs")

  events.push({
    turn: 0,
    type: "floor_change",
    detail: `Ascended to floor ${prevFloorNum}`,
    data: { floor: prevFloorNum, direction: "up" },
  })

  return { summary: `You ascend to floor ${prevFloorNum}.` }
}

function getFloorTransitionEntryTile(
  room: RoomState,
  stairType: "stairs" | "stairs_up",
): { x: number; y: number } {
  for (const row of room.tiles) {
    for (const tile of row) {
      if (tile.type !== stairType) continue
      if (stairType === "stairs_up") {
        return {
          x: Math.min(tile.x + 1, Math.max(1, row.length - 2)),
          y: tile.y,
        }
      }
      return {
        x: Math.max(1, tile.x - 1),
        y: tile.y,
      }
    }
  }

  const height = room.tiles.length
  const width = room.tiles[0]?.length ?? 0
  const fallbackX = stairType === "stairs_up" ? 1 : Math.max(1, width - 2)
  return { x: fallbackX, y: Math.max(1, Math.floor(height / 2)) }
}

function resolvePlayerAttack(
  s: GameState,
  room: RoomState,
  action: { type: "attack"; target_id: string; ability_id?: string },
  realm: GeneratedRealm,
  rng: SeededRng,
  events: GameEvent[],
  mutations: WorldMutation[],
  preTurnDebuffs: ActiveEffect[],
): { summary: string; notableEvent: LobbyEvent | null; regenBonusEligible: boolean } {
  const abilityId = action.ability_id ?? "basic-attack"
  let ability: AbilityTemplate

  try {
    ability = getAbility(abilityId)
  } catch {
    return {
      summary: "Unknown ability.",
      notableEvent: null,
      regenBonusEligible: false,
    }
  }

  if (
    ability.id !== "basic-attack" &&
    !s.character.abilities.includes(ability.id)
  ) {
    return {
      summary: "You have not learned that ability.",
      notableEvent: null,
      regenBonusEligible: false,
    }
  }

  if ((s.character.cooldowns[ability.id] ?? 0) > 0) {
    return {
      summary: `${ability.name} is still on cooldown.`,
      notableEvent: null,
      regenBonusEligible: false,
    }
  }

  if (s.character.resource.current < ability.resource_cost) {
    return {
      summary: `Not enough ${s.character.resource.type} for ${ability.name}.`,
      notableEvent: null,
      regenBonusEligible: false,
    }
  }

  if (abilityRequiresAmmo(s, ability) && getAmmoCount(s) <= 0) {
    return {
      summary: `No ammo remaining for ${ability.name}.`,
      notableEvent: null,
      regenBonusEligible: false,
    }
  }

  const normalizedTarget = normalizeAbilityTarget(ability.target)
  const isSelfTarget = action.target_id === "self" || normalizedTarget === "self"
  const regenBonusEligible =
    isSelfTarget &&
    ability.effects.some((effect) => effect.type === "buff-defense")

  if (isSelfTarget) {
    s.character.resource.current -= ability.resource_cost
    if (abilityRequiresAmmo(s, ability)) consumeAmmo(s)
    if (ability.cooldown_turns > 0) {
      s.character.cooldowns[ability.id] = ability.cooldown_turns
    }

    const summary = applyAbilityToPlayerSelf(s, ability, events)
    recalcStats(s)
    return { summary, notableEvent: null, regenBonusEligible }
  }

  const enemy = room.enemies.find((candidate) => candidate.id === action.target_id && candidate.hp > 0)
  if (!enemy) {
    events.push({ turn: 0, type: "attack_miss", detail: "No valid target", data: {} })
    return { summary: "No valid target.", notableEvent: null, regenBonusEligible: false }
  }

  if (!isAbilityTargetInRange(room, s.position.tile, enemy.position, ability)) {
    return {
      summary: "Target is out of range.",
      notableEvent: null,
      regenBonusEligible: false,
    }
  }

  s.character.resource.current -= ability.resource_cost
  if (abilityRequiresAmmo(s, ability)) consumeAmmo(s)
  if (ability.cooldown_turns > 0) {
    s.character.cooldowns[ability.id] = ability.cooldown_turns
  }

  if (ability.special === "self-damage-20pct") {
    s.character.hp.current = Math.max(
      1,
      s.character.hp.current - Math.max(1, Math.floor(s.character.hp.max * 0.2)),
    )
  }

  const targets =
    normalizedTarget === "aoe"
      ? room.enemies.filter(
          (candidate) =>
            candidate.hp > 0 &&
            getAbilityRangeDistance(candidate.position, enemy.position) <=
              (ability.aoe_radius ?? 1),
        )
      : [enemy]

  const parts: string[] = []
  let notableEvent: LobbyEvent | null = null
  let anyHit = false

  for (const target of targets) {
    const enemyTemplate = getEnemySafe(target.template_id)
    if (!enemyTemplate) {
      console.warn(`[resolveAbility] Skipping target with unknown template "${target.template_id}" (id=${target.id})`)
      target.hp = 0
      continue
    }
    const baseDefense = enemyTemplate.stats.defense
    const effectiveDefense =
      ability.special === "piercing-shot"
        ? 0
        : target.defense_modifier !== undefined
          ? Math.max(0, Math.floor(baseDefense * (1 + target.defense_modifier)))
          : baseDefense
    const defenderStats = { ...enemyTemplate.stats, defense: effectiveDefense }
    const combatResult = resolveAttack(
      {
        id: s.character.id,
        stats: s.character.effective_stats,
        hp: s.character.hp.current,
        active_effects: getCombinedEffects(s.character.buffs, preTurnDebuffs),
      },
      {
        id: target.id,
        stats: defenderStats,
        hp: target.hp,
        active_effects: target.effects,
      },
      rng,
      getAbilityDamageFormula(ability),
      ability.effects,
    )

    target.hp = combatResult.defender_hp_after

    if (!combatResult.hit) {
      parts.push(`${ability.name} misses ${enemyTemplate.name}.`)
      events.push({
        turn: 0,
        type: "attack_miss",
        detail: `${ability.name} misses ${enemyTemplate.name}.`,
        data: { target: target.id, ability_id: ability.id },
      })
      continue
    }

    anyHit = true
    target.effects.push(...combatResult.effects_applied)
    if (ability.special === "restore-resource-on-hit") {
      s.character.resource.current = applyHeal(
        s.character.resource.current,
        s.character.resource.max,
        8,
      )
    }

    const critText = combatResult.critical ? " Critical hit!" : ""
    parts.push(
      `${ability.name} deals ${combatResult.damage} damage to ${enemyTemplate.name}.${critText}`,
    )
    events.push({
      turn: 0,
      type: "attack_hit",
      detail: `${ability.name} hit ${enemyTemplate.name} for ${combatResult.damage}.${critText}`.trim(),
      data: {
        target: target.id,
        ability_id: ability.id,
        damage: combatResult.damage,
        critical: combatResult.critical,
        defender_hp: target.hp,
      },
    })

    if (target.hp <= 0) {
      const killResult = handleEnemyDefeat(
        s,
        room,
        realm,
        target,
        enemyTemplate,
        mutations,
        events,
      )
      notableEvent = killResult.notableEvent ?? notableEvent
      parts.push(`The ${enemyTemplate.name} is defeated!`)
    }
  }

  if (!anyHit && parts.length === 0) {
    parts.push(`${ability.name} fails to connect.`)
  }

  recalcStats(s)
  return {
    summary: parts.join(" ").trim(),
    notableEvent,
    regenBonusEligible,
  }
}

function applyAbilityToPlayerSelf(
  s: GameState,
  ability: AbilityTemplate,
  events: GameEvent[],
): string {
  const parts = [`You use ${ability.name}.`]

  for (const effect of ability.effects) {
    const effectType = effect.type as string
    if (effectType === "buff-attack" || effectType === "buff-defense") {
      s.character.buffs.push({
        type: effect.type,
        turns_remaining: effect.duration_turns,
        magnitude: effect.magnitude,
      })
      parts.push(`${ability.name} empowers you for ${effect.duration_turns} turns.`)
      continue
    }

    if (effectType === "heal-hp") {
      s.character.hp.current = applyHeal(
        s.character.hp.current,
        s.character.hp.max,
        effect.magnitude,
      )
      parts.push(`You recover ${effect.magnitude} HP.`)
      continue
    }

    s.character.debuffs.push({
      type: effect.type,
      turns_remaining: effect.duration_turns,
      magnitude: effect.magnitude,
    })
  }

  switch (ability.special) {
    case "self-damage-20pct":
      s.character.hp.current = Math.max(
        1,
        s.character.hp.current - Math.max(1, Math.floor(s.character.hp.max * 0.2)),
      )
      parts.push("The power comes at the cost of your own blood.")
      break
    case "cure-debuffs":
      s.character.debuffs = []
      parts.push("Your debuffs are cleansed.")
      break
    case "portal-escape":
      s.portalActive = true
      parts.push("A stable portal briefly opens nearby.")
      break
    case "reveal-room-enemies":
      parts.push("Arcane sight sharpens your awareness.")
      break
    case "stealth":
      parts.push("You vanish into the shadows.")
      break
    case "heal-self":
      s.character.hp.current = applyHeal(
        s.character.hp.current,
        s.character.hp.max,
        Math.max(8, Math.floor(s.character.hp.max * 0.15)),
      )
      parts.push("You recover some health.")
      break
  }

  const summary = parts.join(" ").trim()
  events.push({
    turn: 0,
    type: "attack_hit",
    detail: summary,
    data: { ability_id: ability.id, target: "self" },
  })
  return summary
}

function handleEnemyDefeat(
  s: GameState,
  room: RoomState,
  realm: GeneratedRealm,
  enemy: RoomState["enemies"][number],
  enemyTemplate: ReturnType<typeof getEnemy>,
  mutations: WorldMutation[],
  events: GameEvent[],
): { notableEvent: LobbyEvent | null } {
  events.push({
    turn: 0,
    type: "enemy_killed",
    detail: `${enemyTemplate.name} defeated`,
    data: { enemy_id: enemy.id, xp: enemyTemplate.xp_value },
  })

  s.character.xp += enemyTemplate.xp_value
  mutations.push({
    entity_id: enemy.id,
    mutation: "killed",
    floor: s.position.floor,
    metadata: {
      xp_awarded: enemyTemplate.xp_value,
      template_id: enemy.template_id,
    },
  })
  s.mutatedEntities.push(enemy.id)

  // Level-up check after XP award
  const { newLevel, levelsGained } = checkLevelUp(s.character.level, s.character.xp)
  if (levelsGained > 0) {
    const classTemplate = CLASSES[s.character.class]
    const growth = classTemplate?.stat_growth
    let statGains: CharacterStats | null = null
    if (growth) {
      const appliedGrowth = applyStatGrowth(s.character.stats, growth, levelsGained)
      s.character.stats = appliedGrowth.nextStats
      statGains = appliedGrowth.statGains
      s.character.hp.max += appliedGrowth.statGains.hp
      s.character.hp.current = Math.min(
        s.character.hp.current + appliedGrowth.statGains.hp,
        s.character.hp.max,
      )
      s.character.effective_stats = { ...s.character.stats }
    }
    s.character.level = newLevel
    events.push({
      turn: 0,
      type: "level_up",
      detail: `Level up! You are now level ${newLevel}.`,
      data: {
        old_level: newLevel - levelsGained,
        new_level: newLevel,
        stat_gains: statGains,
        levels_gained: levelsGained,
      },
    })
  }

  if (enemyTemplate.behavior !== "boss") {
    if (!isBosslessRealmCleared(s, room, realm)) {
      return { notableEvent: null }
    }

    s.realmStatus = "realm_cleared"
    const detail = "The final room falls silent. The realm is cleared."
    events.push({
      turn: 0,
      type: "realm_clear",
      detail,
      data: {
        floor: s.position.floor,
        room_id: room.id,
      },
    })
    return {
      notableEvent: {
        type: "realm_clear",
        characterName: "",
        characterClass: s.character.class,
        detail,
        timestamp: Date.now(),
      },
    }
  }

  s.realmStatus = "boss_cleared"
  return {
    notableEvent: {
      type: "boss_kill",
      characterName: "",
      characterClass: s.character.class,
      detail: `Defeated ${enemyTemplate.name}`,
      timestamp: Date.now(),
    },
  }
}

function resolveEnemyTurns(
  s: GameState,
  room: RoomState,
  realm: GeneratedRealm,
  rng: SeededRng,
  events: GameEvent[],
  mutations: WorldMutation[],
): { summary: string; playerDied: boolean; killedBy: string | null } {
  const aliveEnemies = room.enemies.filter((e) => e.hp > 0)
  if (aliveEnemies.length === 0) return { summary: "", playerDied: false, killedBy: null }

  const parts: string[] = []
  let killedBy: string | null = null

  for (const enemy of aliveEnemies) {
    const template = getEnemySafe(enemy.template_id)
    if (!template) {
      console.warn(`[resolveEnemyTurns] Skipping enemy with unknown template "${enemy.template_id}" (id=${enemy.id})`)
      enemy.hp = 0
      continue
    }
    const preTurnEffects = [...enemy.effects]
    const distanceToPlayer = getAbilityRangeDistance(enemy.position, s.position.tile)
    const { damage, updated_effects } = resolveStatusEffectTick({
      id: enemy.id,
      stats: template.stats,
      hp: enemy.hp,
      active_effects: enemy.effects,
    })
    enemy.effects = updated_effects
    enemy.hp -= damage

    if (damage > 0) {
      parts.push(`${template.name} suffers ${damage} poison damage.`)
      events.push({
        turn: 0,
        type: "status_tick",
        detail: `${template.name} takes ${damage} damage from status effects.`,
        data: { enemy_id: enemy.id, damage },
      })
    }

    if (enemy.hp <= 0) {
      handleEnemyDefeat(s, room, realm, enemy, template, mutations, events)
      parts.push(`${template.name} collapses from lingering effects.`)
      continue
    }

    if (hasEffect(preTurnEffects, "stun")) {
      parts.push(`${template.name} is stunned and cannot act.`)
      events.push({
        turn: 0,
        type: "status_stun",
        detail: `${template.name} is stunned.`,
        data: { enemy_id: enemy.id },
      })
      continue
    }

    let effectiveAbilityIds = template.abilities
    let preferSelf = enemy.hp <= enemy.hp_max / 2

    switch (template.behavior) {
      case "defensive": {
        const shouldRetreat = enemy.hp_max > 0 && enemy.hp / enemy.hp_max <= DEFENSIVE_RETREAT_HP_THRESHOLD
        preferSelf = shouldRetreat

        if (shouldRetreat && distanceToPlayer <= 1) {
          if (hasEffect(preTurnEffects, "slow")) {
            parts.push(`${template.name} tries to retreat but is slowed.`)
            continue
          }

          if (moveEnemyAway(enemy, s.position.tile, room)) {
            parts.push(`${template.name} retreats to regain control of the fight.`)
            continue
          }
        }
        break
      }
      case "patrol":
        if (distanceToPlayer > PATROL_DETECTION_RANGE) {
          continue
        }
        break
      case "ambush":
        if (distanceToPlayer > AMBUSH_TRIGGER_RANGE) {
          continue
        }
        break
      case "boss":
        effectiveAbilityIds = resolveBossPhase(enemy, template, events)
        break
    }

    const ability = chooseEnemyAbility(
      enemy,
      template,
      room,
      s.position.tile,
      effectiveAbilityIds,
      preferSelf,
    )
    const inRange = ability
      ? normalizeAbilityTarget(ability.target) === "self" ||
        isAbilityTargetInRange(room, enemy.position, s.position.tile, ability)
      : false

    if (!ability || !inRange) {
      if (hasEffect(preTurnEffects, "slow")) {
        parts.push(`${template.name} struggles to move while slowed.`)
        continue
      }
      moveEnemyToward(enemy, s.position.tile, room)
      continue
    }

    if (ability.cooldown_turns > 0) {
      enemy.cooldowns[ability.id] = ability.cooldown_turns
    }

    if (normalizeAbilityTarget(ability.target) === "self") {
      applyEnemySelfAbility(enemy, ability)
      parts.push(`${template.name} uses ${ability.name}.`)
      events.push({
        turn: 0,
        type: "enemy_attack",
        detail: `${template.name} uses ${ability.name}.`,
        data: { enemy_id: enemy.id, ability_id: ability.id },
      })
      continue
    }

    const combatResult = resolveAttack(
      {
        id: enemy.id,
        stats: template.stats,
        hp: enemy.hp,
        active_effects: preTurnEffects,
      },
      {
        id: s.character.id,
        stats: s.character.effective_stats,
        hp: s.character.hp.current,
        active_effects: getCombinedEffects(s.character.buffs, s.character.debuffs),
      },
      rng,
      getAbilityDamageFormula(ability),
      ability.effects,
    )
    s.character.hp.current = combatResult.defender_hp_after

    if (!combatResult.hit) {
      parts.push(`${template.name}'s ${ability.name} misses.`)
      events.push({
        turn: 0,
        type: "enemy_miss",
        detail: `${template.name}'s ${ability.name} missed.`,
        data: { enemy_id: enemy.id, ability_id: ability.id },
      })
      continue
    }

    s.character.debuffs.push(...combatResult.effects_applied)

    if (ability.special === "drain-life") {
      enemy.hp = applyHeal(enemy.hp, enemy.hp_max, combatResult.damage)
    }

    const critText = combatResult.critical ? " Critical hit!" : ""
    parts.push(
      `${template.name} hits you with ${ability.name} for ${combatResult.damage} damage.${critText}`,
    )
    events.push({
      turn: 0,
      type: "enemy_attack",
      detail: `${template.name} hit for ${combatResult.damage} with ${ability.name}.${critText}`.trim(),
      data: {
        enemy_id: enemy.id,
        ability_id: ability.id,
        damage: combatResult.damage,
        critical: combatResult.critical,
        player_hp: s.character.hp.current,
      },
    })

    if (s.character.hp.current <= 0) {
      killedBy = template.name
      break
    }
  }

  return {
    summary: parts.join(" "),
    playerDied: s.character.hp.current <= 0,
    killedBy,
  }
}

function chooseEnemyAbility(
  enemy: RoomState["enemies"][number],
  template: ReturnType<typeof getEnemy>,
  room: RoomState,
  playerPosition: Position,
  abilityIds = template.abilities,
  preferSelf = enemy.hp <= enemy.hp_max / 2,
): AbilityTemplate | null {
  const abilities = abilityIds.flatMap((abilityId) => {
    try {
      return [getAbility(abilityId)]
    } catch {
      return []
    }
  })

  const usable = abilities.filter((ability) => {
    if ((enemy.cooldowns[ability.id] ?? 0) > 0) return false
    const target = normalizeAbilityTarget(ability.target)
    if (target === "self") return true
    return isAbilityTargetInRange(room, enemy.position, playerPosition, ability)
  })

  if (usable.length === 0) {
    return null
  }

  usable.sort((left, right) => {
    const leftSelf = normalizeAbilityTarget(left.target) === "self" ? 1 : 0
    const rightSelf = normalizeAbilityTarget(right.target) === "self" ? 1 : 0
    if (preferSelf && leftSelf !== rightSelf) {
      return rightSelf - leftSelf
    }
    if (!preferSelf && leftSelf !== rightSelf) {
      return leftSelf - rightSelf
    }
    return right.resource_cost - left.resource_cost
  })

  return usable[0] ?? null
}

function applyEnemySelfAbility(
  enemy: RoomState["enemies"][number],
  ability: AbilityTemplate,
) {
  for (const effect of ability.effects) {
    enemy.effects.push({
      type: effect.type,
      turns_remaining: effect.duration_turns,
      magnitude: effect.magnitude,
    })
  }

  if (ability.special === "heal-self") {
    enemy.hp = applyHeal(
      enemy.hp,
      enemy.hp_max,
      Math.max(10, Math.floor(enemy.hp_max * 0.15)),
    )
  }
}

function moveEnemyToward(
  enemy: RoomState["enemies"][number],
  target: { x: number; y: number },
  room: RoomState,
) {
  const currentDistance = getAbilityRangeDistance(enemy.position, target)
  const candidates = getEnemyMoveCandidates(enemy, room).sort(
    (left, right) =>
      getAbilityRangeDistance(left, target) - getAbilityRangeDistance(right, target),
  )

  const next = candidates[0]
  if (!next || getAbilityRangeDistance(next, target) >= currentDistance) {
    return false
  }

  enemy.position = next
  return true
}

function moveEnemyAway(
  enemy: RoomState["enemies"][number],
  target: { x: number; y: number },
  room: RoomState,
) {
  const currentDistance = getAbilityRangeDistance(enemy.position, target)
  const candidates = getEnemyMoveCandidates(enemy, room).sort(
    (left, right) =>
      getAbilityRangeDistance(right, target) - getAbilityRangeDistance(left, target),
  )

  const next = candidates[0]
  if (!next || getAbilityRangeDistance(next, target) <= currentDistance) {
    return false
  }

  enemy.position = next
  return true
}

function getEnemyMoveCandidates(
  enemy: RoomState["enemies"][number],
  room: RoomState,
) {
  const height = room.tiles.length
  const width = room.tiles[0]?.length ?? 0

  const candidates = [
    { x: enemy.position.x + 1, y: enemy.position.y },
    { x: enemy.position.x - 1, y: enemy.position.y },
    { x: enemy.position.x, y: enemy.position.y + 1 },
    { x: enemy.position.x, y: enemy.position.y - 1 },
  ].filter(({ x, y }) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const tile = room.tiles[y]?.[x]
    if (!tile || tile.type === "wall") return false
    // Don't walk onto other enemies
    if (room.enemies.some((e) => e.hp > 0 && e.id !== enemy.id && e.position.x === x && e.position.y === y))
      return false
    return true
  })

  return candidates
}

function buildEffectiveBossAbilityIds(
  template: ReturnType<typeof getEnemy>,
  phaseIndex: number,
) {
  const phases = template.boss_phases ?? []
  const abilityIds = new Set(template.abilities)

  for (let i = 0; i <= phaseIndex; i += 1) {
    const phase = phases[i]
    if (!phase) continue

    for (const abilityId of phase.abilities_added) {
      abilityIds.add(abilityId)
    }
    for (const abilityId of phase.abilities_removed) {
      abilityIds.delete(abilityId)
    }
  }

  return [...abilityIds]
}

function resolveBossPhase(
  enemy: RoomState["enemies"][number],
  template: ReturnType<typeof getEnemy>,
  events: GameEvent[],
) {
  const phases = template.boss_phases ?? []
  const previousPhaseIndex = enemy.boss_phase_index ?? -1
  let deepestReachedPhase = previousPhaseIndex

  if (enemy.hp_max > 0) {
    const hpRatio = enemy.hp / enemy.hp_max
    for (let i = 0; i < phases.length; i += 1) {
      const phase = phases[i]
      if (phase && hpRatio <= phase.hp_threshold) {
        deepestReachedPhase = Math.max(deepestReachedPhase, i)
      }
    }
  }

  if (deepestReachedPhase > previousPhaseIndex) {
    const phase = phases[deepestReachedPhase]
    enemy.boss_phase_index = deepestReachedPhase
    if (phase) {
      events.push({
        turn: 0,
        type: "boss_phase",
        detail: phase.behavior_change,
        data: {
          enemy_id: enemy.id,
          enemy_name: template.name,
          phase_index: deepestReachedPhase,
        },
      })
    }
  } else if (previousPhaseIndex >= 0) {
    enemy.boss_phase_index = previousPhaseIndex
  }

  return buildEffectiveBossAbilityIds(template, deepestReachedPhase)
}

function resolveUseItem(
  s: GameState,
  action: { type: "use_item"; item_id: string; target_id?: string },
  events: GameEvent[],
  realm: GeneratedRealm,
): string {
  const itemIdx = s.inventory.findIndex((i) => i.id === action.item_id)
  if (itemIdx < 0) return "Item not found in inventory."

  const item = s.inventory[itemIdx]!
  let template: ItemTemplate
  try {
    template = getItem(item.template_id)
  } catch {
    return "Unknown item."
  }

  if (template.type !== "consumable") return "That item cannot be used."

  const parts: string[] = []

  for (const effect of template.effects ?? []) {
    switch (effect.type) {
      case "heal-hp": {
        const amount = Math.min(effect.magnitude ?? 0, s.character.hp.max - s.character.hp.current)
        s.character.hp.current += amount
        parts.push(`Restored ${amount} HP.`)
        break
      }
      case "restore-resource": {
        const amount = Math.min(
          effect.magnitude ?? 0,
          s.character.resource.max - s.character.resource.current,
        )
        s.character.resource.current += amount
        parts.push(`Restored ${amount} ${s.character.resource.type}.`)
        break
      }
      case "cure-debuffs": {
        s.character.debuffs = []
        parts.push("Debuffs cleared.")
        break
      }
      case "buff": {
        s.character.buffs.push({
          type: "buff-attack",
          turns_remaining: effect.duration ?? 5,
          magnitude: effect.magnitude ?? 5,
        })
        parts.push(`Attack boosted by ${effect.magnitude ?? 5} for ${effect.duration ?? 5} turns.`)
        break
      }
      case "portal-escape": {
        s.portalActive = true
        parts.push("A portal opens before you.")
        break
      }
      case "reveal-map": {
        const revealedCount = revealCurrentFloorMap(s, realm)
        parts.push(
          revealedCount > 0
            ? "The map reveals itself. You now know the layout of this entire floor."
            : "The map reveals itself, but there is nothing new to uncover here.",
        )
        break
      }
    }
  }

  // Consume the item
  if (item.quantity > 1) {
    item.quantity -= 1
  } else {
    s.inventory.splice(itemIdx, 1)
  }

  const summary = `Used ${template.name}. ${parts.join(" ")}`
  events.push({ turn: 0, type: "use_item", detail: summary, data: { item_id: item.id, template_id: item.template_id } })
  return summary
}

function resolvePickup(
  s: GameState,
  room: RoomState,
  action: { type: "pickup"; item_id: string },
  rng: SeededRng,
  events: GameEvent[],
  mutations: WorldMutation[],
): string {
  const itemIdx = room.items.findIndex((i) => i.id === action.item_id)
  if (itemIdx < 0) return "Nothing to pick up."

  const floorItem = room.items[itemIdx]!
  const dist =
    Math.abs(s.position.tile.x - floorItem.position.x) +
    Math.abs(s.position.tile.y - floorItem.position.y)
  if (dist > 1) return "Too far away."

  let template: ItemTemplate
  try {
    template = getItem(floorItem.template_id)
  } catch {
    return "Unknown item."
  }

  const qty = floorItem.quantity ?? 1
  const summaryParts: string[] = []

  if (floorItem.trapped && !floorItem.trap_disarmed) {
    const trapDamage = Math.max(0, floorItem.trap_damage ?? 0)
    if (trapDamage > 0) {
      s.character.hp.current = Math.max(0, s.character.hp.current - trapDamage)
    }

    const effect = floorItem.trap_effect
    const effectApplied = effect != null && rng.next() <= effect.apply_chance
    if (effect && effectApplied) {
      s.character.debuffs.push({
        type: effect.type,
        turns_remaining: effect.duration_turns,
        magnitude: effect.magnitude,
      })
    }

    const trapMarkerId = getTrapMarkerId(floorItem.id)
    mutations.push({
      entity_id: trapMarkerId,
      mutation: "trap_triggered",
      floor: s.position.floor,
      metadata: {
        item_id: floorItem.id,
        disarmed: false,
        position: floorItem.position,
        trap_damage: trapDamage,
        trap_effect: effect?.type ?? null,
      },
    })
    if (!s.mutatedEntities.includes(trapMarkerId)) {
      s.mutatedEntities.push(trapMarkerId)
    }

    const trapDetailParts = [`A hidden trap springs for ${trapDamage} damage.`]
    if (effect && effectApplied) {
      trapDetailParts.push(`You suffer ${effect.type}.`)
    } else if (effect) {
      trapDetailParts.push(`You resist ${effect.type}.`)
    }
    const trapSummary = trapDetailParts.join(" ")
    summaryParts.push(trapSummary)
    events.push({
      turn: 0,
      type: "trap_triggered",
      detail: trapSummary,
      data: {
        item_id: floorItem.id,
        damage: trapDamage,
        effect: effect?.type ?? null,
        applied: effectApplied,
      },
    })
  }

  // Gold coins go straight to gold total, not inventory
  if (floorItem.template_id === "gold-coins") {
    s.character.gold += qty

    room.items.splice(itemIdx, 1)
    mutations.push({
      entity_id: floorItem.id,
      mutation: "looted",
      floor: s.position.floor,
      metadata: { template_id: floorItem.template_id, quantity: qty },
    })
    s.mutatedEntities.push(floorItem.id)

    const pickupSummary = `Found ${qty} gold.`
    summaryParts.push(pickupSummary)
    events.push({ turn: 0, type: "pickup", detail: pickupSummary, data: { item_id: floorItem.id, gold: qty } })
    return summaryParts.join(" ")
  }

  // Add to inventory
  const inventoryCheck = canAddInventoryItem(
    s,
    floorItem.template_id,
    template.stack_limit,
  )
  if (inventoryCheck.stackTarget) {
    inventoryCheck.stackTarget.quantity += qty
  } else if (!inventoryCheck.hasSpace) {
    const fullSummary = `Inventory full (${inventoryCheck.slotsUsed}/${inventoryCheck.capacity}).`
    summaryParts.push(fullSummary)
    events.push({
      turn: 0,
      type: "pickup_blocked",
      detail: fullSummary,
      data: {
        item_id: floorItem.id,
        template_id: floorItem.template_id,
        slots_used: inventoryCheck.slotsUsed,
        capacity: inventoryCheck.capacity,
      },
    })
    return summaryParts.join(" ")
  } else {
    s.inventory.push({
      id: crypto.randomUUID(),
      template_id: floorItem.template_id,
      name: template.name,
      quantity: qty,
      modifiers: {},
      owner_type: "character",
      owner_id: s.character.id,
    })
  }

  // Remove from floor
  room.items.splice(itemIdx, 1)

  // World mutation
  mutations.push({
    entity_id: floorItem.id,
    mutation: "looted",
    floor: s.position.floor,
    metadata: { template_id: floorItem.template_id },
  })
  s.mutatedEntities.push(floorItem.id)

  const pickupSummary = qty > 1 ? `Picked up ${template.name} x${qty}.` : `Picked up ${template.name}.`
  summaryParts.push(pickupSummary)
  events.push({ turn: 0, type: "pickup", detail: pickupSummary, data: { item_id: floorItem.id } })
  return summaryParts.join(" ")
}

function resolveDisarmTrap(
  s: GameState,
  room: RoomState,
  action: { type: "disarm_trap"; item_id: string },
  events: GameEvent[],
  mutations: WorldMutation[],
): string {
  if (!hasTrapDisarmAbility(s)) {
    return "You cannot disarm traps."
  }

  const itemIdx = room.items.findIndex((item) => item.id === action.item_id)
  if (itemIdx < 0) return "Nothing to disarm."

  const floorItem = room.items[itemIdx]
  if (!floorItem) return "Nothing to disarm."

  const dist =
    Math.abs(s.position.tile.x - floorItem.position.x) +
    Math.abs(s.position.tile.y - floorItem.position.y)
  if (dist > 1) return "Too far away."

  if (!floorItem.trapped || floorItem.trap_disarmed) {
    return "No active trap to disarm."
  }

  let ability: AbilityTemplate
  try {
    ability = getAbility(ROGUE_DISARM_TRAP_ABILITY_ID)
  } catch {
    return "You cannot disarm traps."
  }

  if (!canUseAbility(s, ability)) {
    return `You need ${ability.resource_cost} ${s.character.resource.type} to disarm this trap.`
  }

  s.character.resource.current -= ability.resource_cost
  floorItem.trap_disarmed = true

  if (ability.cooldown_turns > 0) {
    s.character.cooldowns[ability.id] = ability.cooldown_turns
  }

  const trapMarkerId = getTrapMarkerId(floorItem.id)
  mutations.push({
    entity_id: trapMarkerId,
    mutation: "trap_triggered",
    floor: s.position.floor,
    metadata: {
      item_id: floorItem.id,
      disarmed: true,
      position: floorItem.position,
    },
  })
  if (!s.mutatedEntities.includes(trapMarkerId)) {
    s.mutatedEntities.push(trapMarkerId)
  }

  let itemName = floorItem.template_id
  try {
    itemName = getItem(floorItem.template_id).name
  } catch {
    // keep template_id fallback
  }

  const summary = `You carefully disarm the trap guarding ${itemName}.`
  events.push({
    turn: 0,
    type: "trap_disarmed",
    detail: summary,
    data: { item_id: floorItem.id },
  })
  return summary
}

function resolveInteract(
  s: GameState,
  room: RoomState,
  action: { type: "interact"; target_id: string },
  realm: GeneratedRealm,
  events: GameEvent[],
  mutations: WorldMutation[],
): string {
  // Look up the room template to find interactable definition
  const roomTemplate = findRoomTemplate(room.id)
  if (!roomTemplate) return "Nothing to interact with."

  const interactable = roomTemplate.interactables.find((i) => i.id === action.target_id)
  if (!interactable) return "Nothing to interact with."

  // Check if already used
  if (s.mutatedEntities.includes(action.target_id)) {
    return "Already used."
  }

  // Check conditions
  for (const cond of interactable.conditions) {
    switch (cond.type) {
      case "enemy-defeated":
        if (!s.mutatedEntities.includes(cond.entity_id)) {
          return "Something must be dealt with first."
        }
        break
      case "room-cleared": {
        const livingEnemies = room.enemies.filter(e => e.hp > 0)
        if (livingEnemies.length > 0) {
          return "You must deal with the enemies first."
        }
        break
      }
      case "has-flag":
        if (!s.questFlags?.includes(cond.flag)) {
          return "The conditions aren't right yet."
        }
        break
      case "has-item":
        if (!s.inventory.some((i) => i.template_id === cond.item_id)) {
          return "You're missing something."
        }
        break
      case "class-is":
        if (s.character.class !== cond.class) continue // condition doesn't apply
        break
    }
  }

  // Apply interactable effects
  const parts: string[] = [interactable.text_on_interact]
  for (const effect of interactable.effects) {
    applyEffect(s, effect, parts, room, realm)
  }
  rememberLoreDiscovery(s, interactable.lore_entry_id)

  // Check triggers for this interactable
  for (const trigger of roomTemplate.triggers) {
    if (trigger.target_id !== action.target_id) continue
    if (trigger.trigger_on !== "interact") continue

    // Check trigger conditions
    let conditionsMet = true
    for (const cond of trigger.conditions) {
      if (cond.type === "class-is" && s.character.class !== cond.class) {
        conditionsMet = false
        break
      }
      if (cond.type === "enemy-defeated" && !s.mutatedEntities.includes(cond.entity_id)) {
        conditionsMet = false
        break
      }
      if (cond.type === "has-flag" && !s.questFlags?.includes(cond.flag)) {
        conditionsMet = false
        break
      }
      if (cond.type === "room-cleared" && room.enemies.some(e => e.hp > 0)) {
        conditionsMet = false
        break
      }
    }

    if (conditionsMet) {
      for (const effect of trigger.effects) {
        applyEffect(s, effect, parts, room, realm)
      }
    }
  }

  // Mark as used
  const mutationType: MutationType = interactable.lore_entry_id ? "discovered" : "used"
  mutations.push({
    entity_id: action.target_id,
    mutation: mutationType,
    floor: s.position.floor,
    metadata: {
      name: interactable.name,
      ...(interactable.lore_entry_id
        ? { lore_entry_id: interactable.lore_entry_id }
        : {}),
    },
  })
  s.mutatedEntities.push(action.target_id)

  const hasLoot = interactable.effects.some(
    (e) => e.type === "grant-item" || e.type === "grant-gold",
  )
  const category: string = interactable.lore_entry_id
    ? "lore"
    : hasLoot
      ? "chest"
      : interactable.effects.some((e) => e.type === "unlock-door" || e.type === "spawn-enemy")
        ? "mechanism"
        : "other"

  const summary = parts.join(" ")
  events.push({
    turn: 0,
    type: "interact",
    detail: summary,
    data: { target: action.target_id, category, name: interactable.name },
  })
  return summary
}

function applyEffect(
  s: GameState,
  effect: { type: string; [key: string]: unknown },
  parts: string[],
  room?: RoomState,
  realm?: GeneratedRealm,
) {
  switch (effect.type) {
    case "grant-item": {
      const templateId = effect.item_template_id as string
      const qty = (effect.quantity as number) ?? 1
      try {
        const template = getItem(templateId)
        const inventoryCheck = canAddInventoryItem(
          s,
          templateId,
          template.stack_limit,
        )
        if (inventoryCheck.stackTarget) {
          inventoryCheck.stackTarget.quantity += qty
        } else if (!inventoryCheck.hasSpace) {
          parts.push(
            `Inventory full (${inventoryCheck.slotsUsed}/${inventoryCheck.capacity}) — could not receive ${template.name}.`,
          )
        } else {
          s.inventory.push({
            id: crypto.randomUUID(),
            template_id: templateId,
            name: template.name,
            quantity: qty,
            modifiers: {},
            owner_type: "character",
            owner_id: s.character.id,
          })
        }
        parts.push(`Received ${template.name}${qty > 1 ? ` x${qty}` : ""}.`)
      } catch {
        // Unknown item template — skip
      }
      break
    }
    case "grant-gold": {
      const amount = effect.amount as number
      s.character.gold += amount
      parts.push(`Received ${amount} gold.`)
      break
    }
    case "heal-hp": {
      const amount = Math.min(effect.amount as number, s.character.hp.max - s.character.hp.current)
      s.character.hp.current += amount
      parts.push(`Restored ${amount} HP.`)
      break
    }
    case "reveal-lore": {
      const loreId =
        typeof effect.lore_entry_id === "string"
          ? effect.lore_entry_id
          : typeof effect.lore_id === "string"
            ? effect.lore_id
            : null
      rememberLoreDiscovery(s, loreId)
      parts.push(
        loreId
          ? `You discover a piece of lore: ${formatLoreLabel(loreId)}.`
          : "You discover a piece of lore.",
      )
      break
    }
    case "show-text": {
      parts.push(effect.text as string)
      break
    }
    case "apply-buff": {
      const buff = effect.buff as ActiveEffect
      if (buff) s.character.buffs.push({ ...buff })
      break
    }
    case "apply-debuff": {
      const debuff = effect.debuff as ActiveEffect
      if (debuff) s.character.debuffs.push({ ...debuff })
      break
    }
    case "cure-debuffs": {
      s.character.debuffs = []
      parts.push("Debuffs cleared.")
      break
    }
    case "grant-quest-flag": {
      const flag = effect.flag as string
      if (!flag) break
      if (!s.questFlags) s.questFlags = []
      if (!s.questFlags.includes(flag)) {
        s.questFlags.push(flag)
        parts.push(`${flag} — noted.`)
      }
      break
    }
    case "modify-enemy-stat": {
      if (!room) break
      const entityId = effect.entity_id as string
      const stat = effect.stat as string
      const modifier = effect.modifier as number
      if (typeof modifier !== "number" || !stat) break

      // Try to find by exact entity_id first; fall back to all living enemies
      // (entity_id in content may use a legacy format that doesn't match generated IDs)
      const targets = room.enemies.filter(
        (e) => e.hp > 0 && (e.id === entityId || !entityId),
      )
      const actualTargets = targets.length > 0 ? targets : room.enemies.filter((e) => e.hp > 0)

      for (const enemy of actualTargets) {
        if (stat === "defense") {
          enemy.defense_modifier = (enemy.defense_modifier ?? 0) + modifier
        }
      }
      if (actualTargets.length > 0) {
        parts.push("The enemy is weakened.")
      }
      break
    }
    case "unlock-door": {
      const entityId = effect.entity_id as string
      s.mutatedEntities.push(entityId)
      if (room && realm) {
        // Find this room in the generated realm and connect it to the next room
        const genFloor = realm.floors.find((f) => f.floor_number === s.position.floor)
        if (genFloor) {
          const roomIdx = genFloor.rooms.findIndex((r) => r.id === room.id)
          const genRoom = genFloor.rooms[roomIdx]
          const nextRoom = genFloor.rooms[roomIdx + 1]
          if (genRoom && nextRoom && !genRoom.connections.includes(nextRoom.id)) {
            // Create the forward connection in the generated realm
            genRoom.connections.push(nextRoom.id)
            // Place the door tile at right-wall center
            const h = room.tiles.length
            const w = room.tiles[0]?.length ?? 0
            const midY = Math.floor(h / 2)
            const row = room.tiles[midY]
            if (row) {
              row[w - 1] = { x: w - 1, y: midY, type: "door", entities: [] }
            }
          }
        }
      }
      parts.push("The way ahead is now open.")
      break
    }
  }
}

function resolveInspect(
  room: RoomState,
  action: { type: "inspect"; target_id: string },
  events: GameEvent[],
): string {
  const enemy = room.enemies.find((e) => e.id === action.target_id && e.hp > 0)
  if (enemy) {
    const template = getEnemySafe(enemy.template_id)
    if (!template) {
      console.warn(`[inspect] Unknown enemy template "${enemy.template_id}" (id=${enemy.id})`)
      return "Unknown creature"
    }
    const summary = `${template.name} — HP: ${enemy.hp}/${enemy.hp_max}`
    events.push({ turn: 0, type: "inspect", detail: summary, data: { target: enemy.id } })
    return summary
  }

  const item = room.items.find((i) => i.id === action.target_id)
  if (item) {
    try {
      const template = getItem(item.template_id)
      const summary = `${template.name} — ${template.description}`
      events.push({ turn: 0, type: "inspect", detail: summary, data: { target: item.id } })
      return summary
    } catch {
      return "You see something on the ground."
    }
  }

  return "Nothing to inspect."
}

function resolveEquip(
  s: GameState,
  action: { type: "equip"; item_id: string },
  events: GameEvent[],
): string {
  const itemIdx = s.inventory.findIndex((i) => i.id === action.item_id)
  if (itemIdx < 0) return "Item not found."

  const item = s.inventory[itemIdx]!
  let template: ItemTemplate
  try {
    template = getItem(item.template_id)
  } catch {
    return "Unknown item."
  }

  if (template.type !== "equipment" || !template.equip_slot) return "Cannot equip that."
  if (template.class_restriction && template.class_restriction !== s.character.class) {
    return `Your class cannot equip ${template.name}.`
  }

  const slot = template.equip_slot as EquipSlot

  // Unequip current item in that slot
  const current = s.equipment[slot]
  if (current) {
    s.inventory.push(current)
  }

  // Equip the new item
  s.equipment[slot] = { ...item, slot }
  s.inventory.splice(itemIdx, 1)

  // Recalculate effective stats
  recalcStats(s)

  const summary = `Equipped ${template.name}.`
  events.push({ turn: 0, type: "equip", detail: summary, data: { item_id: item.id, slot } })
  return summary
}

function resolveUnequip(
  s: GameState,
  action: { type: "unequip"; slot: EquipSlot },
  events: GameEvent[],
): string {
  const item = s.equipment[action.slot]
  if (!item) return "Nothing equipped in that slot."

  s.inventory.push({ ...item, slot: null })
  s.equipment[action.slot] = null

  recalcStats(s)

  const summary = `Unequipped from ${action.slot}.`
  events.push({ turn: 0, type: "unequip", detail: summary, data: { slot: action.slot } })
  return summary
}

function resolveDrop(
  s: GameState,
  room: RoomState,
  action: { type: "drop"; item_id: string },
  events: GameEvent[],
): string {
  const itemIdx = s.inventory.findIndex((i) => i.id === action.item_id)
  if (itemIdx < 0) return "Item not found."

  const item = s.inventory[itemIdx]!
  room.items.push({
    id: item.id,
    template_id: item.template_id,
    position: { ...s.position.tile },
  })
  s.inventory.splice(itemIdx, 1)

  const summary = `Dropped ${item.name}.`
  events.push({ turn: 0, type: "drop", detail: summary, data: { item_id: item.id } })
  return summary
}

// ── State helpers ─────────────────────────────────────────────────────────────

function getCurrentRoom(s: GameState): RoomState | undefined {
  return s.activeFloor.rooms.find((r) => r.id === s.position.room_id)
}

function findRoomTemplate(generatedRoomId: string): RoomTemplate | null {
  // Generated room IDs look like: f1_r0_tutorial-storeroom
  // Extract template ID: everything after the second underscore
  const parts = generatedRoomId.split("_")
  if (parts.length < 3) return null
  const templateId = parts.slice(2).join("_")
  return ROOMS[templateId] ?? null
}

/** Build a RoomState from a GeneratedRoom, filtering out already-mutated entities.
 *  When realmTemplateId + seed are provided, resolves loot items from loot tables deterministically. */
export function buildRoomState(
  genRoom: GeneratedRoom,
  mutatedEntities: string[],
  realmTemplateId?: string,
  seed?: number,
): RoomState {
  const roomTemplate = findRoomTemplateFromId(genRoom.id)
  const placementTiles = getPlacementTiles(genRoom.tiles)
  const occupied = new Set<string>()
  const placementSeed = seed ?? 1

  // Map enemy index → template_id using room template's enemy_slots order
  const enemyTemplateMap: Array<{ templateId: string; preferredPos?: Position }> = []
  if (roomTemplate) {
    for (const slot of roomTemplate.enemy_slots) {
      const count = slot.count.max
      const preferredPos =
        typeof slot.position === "object"
          ? { x: slot.position.x, y: slot.position.y }
          : undefined
      for (let e = 0; e < count; e++) {
        enemyTemplateMap.push({
          templateId: slot.enemy_template_id,
          ...(preferredPos ? { preferredPos } : {}),
        })
      }
    }
  } else if (realmTemplateId && genRoom.enemy_ids.length > 0) {
    // Procedural fallback: resolve enemy templates from the realm's enemy_roster
    const realmTemplate = REALMS[realmTemplateId]
    if (realmTemplate) {
      const roster = realmTemplate.enemy_roster ?? []
      const isBossRoom = genRoom.type === "boss"
      for (let e = 0; e < genRoom.enemy_ids.length; e++) {
        let templateId: string
        if (isBossRoom && realmTemplate.boss_id) {
          templateId = realmTemplate.boss_id
        } else if (roster.length > 0) {
          // Deterministic pick from roster using a seed derived from the enemy ID
          const enemyRng = new SeededRng(deriveSeed(placementSeed, `${genRoom.id}:${genRoom.enemy_ids[e]!}:template`))
          templateId = roster[enemyRng.nextInt(0, roster.length - 1)]!
        } else {
          continue
        }
        enemyTemplateMap.push({ templateId })
      }
    }
  }

  const enemyPositions = genRoom.enemy_ids.map((enemyId, index) => {
    const mapped = enemyTemplateMap[index]
    return claimPlacementPosition(
      placementTiles,
      occupied,
      new SeededRng(deriveSeed(placementSeed, `${genRoom.id}:${enemyId}:enemy`)),
      mapped?.preferredPos,
    )
  })

  const enemies: RoomState["enemies"] = []
  for (let i = 0; i < genRoom.enemy_ids.length; i++) {
    const enemyId = genRoom.enemy_ids[i]!
    if (mutatedEntities.includes(enemyId)) continue

    const mapped = enemyTemplateMap[i]
    if (!mapped) {
      console.warn(`[buildRoomState] No template mapping for enemy index ${i} (id=${enemyId}) in room ${genRoom.id}`)
      continue
    }
    const templateId = mapped.templateId
    let hp = 20
    try {
      hp = getEnemy(templateId).stats.hp
    } catch {
      console.warn(`[buildRoomState] Unknown enemy template "${templateId}" for enemy ${enemyId} in room ${genRoom.id}`)
      continue
    }

    enemies.push({
      id: enemyId,
      template_id: templateId,
      hp,
      hp_max: hp,
      position: enemyPositions[i] ?? { x: 1, y: 1 },
      effects: [],
      cooldowns: {},
    })
  }

  // Resolve loot items from room template's loot_slots + realm loot tables
  const items: RoomState["items"] = []
  const realmTemplate = realmTemplateId ? REALMS[realmTemplateId] : undefined
  const lootTables = realmTemplate?.loot_tables
  const itemPositions = genRoom.item_ids.map((itemId, index) => {
    const lootSlot = roomTemplate?.loot_slots[index]
    const preferredPos =
      lootSlot?.position && typeof lootSlot.position === "object"
        ? { x: lootSlot.position.x, y: lootSlot.position.y }
        : undefined
    return claimPlacementPosition(
      placementTiles,
      occupied,
      new SeededRng(deriveSeed(placementSeed, `${genRoom.id}:${itemId}:item`)),
      preferredPos,
    )
  })

  for (let i = 0; i < genRoom.item_ids.length; i++) {
    const itemId = genRoom.item_ids[i]!
    if (mutatedEntities.includes(itemId)) continue

    let templateId = "health-potion" // fallback
    let quantity = 1
    const lootSlot = roomTemplate?.loot_slots[i]
    const trapDisarmed = mutatedEntities.includes(getTrapMarkerId(itemId))
    if (lootSlot && lootTables && seed != null) {
      const table = lootTables.find((t) => t.id === lootSlot.loot_table_id)
      if (table && table.entries.length > 0) {
        // Deterministic per-item RNG so same seed always gives same loot
        const itemRng = new SeededRng(deriveSeed(seed, itemId))
        const totalWeight = table.entries.reduce((sum, e) => sum + e.weight, 0)
        let roll = itemRng.next() * totalWeight
        for (const entry of table.entries) {
          roll -= entry.weight
          if (roll <= 0) {
            templateId = entry.item_template_id
            // Resolve quantity from loot table range
            const range = entry.quantity.max - entry.quantity.min
            quantity = entry.quantity.min + (range > 0 ? Math.floor(itemRng.next() * (range + 1)) : 0)
            break
          }
        }
      }
    }

    items.push({
      id: itemId,
      template_id: templateId,
      quantity,
      position: itemPositions[i] ?? { x: 1, y: 1 },
      ...(lootSlot?.trapped !== undefined ? { trapped: lootSlot.trapped } : {}),
      ...(lootSlot?.trap_damage !== undefined ? { trap_damage: lootSlot.trap_damage } : {}),
      ...(lootSlot ? { trap_effect: lootSlot.trap_effect ?? null } : {}),
      ...(trapDisarmed ? { trap_disarmed: true } : {}),
    })
  }

  return {
    id: genRoom.id,
    tiles: genRoom.tiles,
    enemies,
    items,
  }
}

function findRoomTemplateFromId(generatedRoomId: string): RoomTemplate | null {
  const parts = generatedRoomId.split("_")
  if (parts.length < 3) return null
  const templateId = parts.slice(2).join("_")
  return ROOMS[templateId] ?? null
}

function processStatusEffects(s: GameState, events: GameEvent[]): number {
  if (s.character.debuffs.length === 0) {
    s.character.buffs = s.character.buffs
      .map((b) => ({ ...b, turns_remaining: b.turns_remaining - 1 }))
      .filter((b) => b.turns_remaining > 0)
    recalcStats(s)
    return 0
  }

  const combatant: Combatant = {
    id: s.character.id,
    stats: s.character.effective_stats,
    hp: s.character.hp.current,
    active_effects: s.character.debuffs,
  }

  const { damage, updated_effects } = resolveStatusEffectTick(combatant)
  s.character.debuffs = updated_effects
  s.character.hp.current -= damage

  if (damage > 0) {
    events.push({
      turn: 0,
      type: "status_tick",
      detail: `Took ${damage} damage from status effects`,
      data: { damage },
    })
  }

  // Tick buffs
  s.character.buffs = s.character.buffs
    .map((b) => ({ ...b, turns_remaining: b.turns_remaining - 1 }))
    .filter((b) => b.turns_remaining > 0)

  recalcStats(s)

  return damage
}

function tickCooldowns(s: GameState, room: RoomState) {
  for (const key of Object.keys(s.character.cooldowns)) {
    const val = s.character.cooldowns[key]
    if (val !== undefined && val > 0) {
      s.character.cooldowns[key] = val - 1
    }
    if (s.character.cooldowns[key] === 0) {
      delete s.character.cooldowns[key]
    }
  }

  for (const enemy of room.enemies) {
    for (const key of Object.keys(enemy.cooldowns)) {
      const val = enemy.cooldowns[key]
      if (val !== undefined && val > 0) {
        enemy.cooldowns[key] = val - 1
      }
      if (enemy.cooldowns[key] === 0) {
        delete enemy.cooldowns[key]
      }
    }
  }
}

function applyResourceRegen(
  s: GameState,
  defendBonusTriggered: boolean,
) {
  const rule = CLASSES[s.character.class]?.resource_regen_rule
  if (!rule || rule.type === "none") return
  const ruleType =
    rule.type === "burst-reset" ? "burst_reset" : rule.type

  const currentTurn = Math.max(1, s.turn)
  if (
    ruleType === "burst_reset" &&
    rule.interval &&
    currentTurn % rule.interval === 0
  ) {
    s.character.resource.current = s.character.resource.max
    return
  }

  if (
    (ruleType === "passive" || ruleType === "accumulate") &&
    rule.interval &&
    rule.amount &&
    currentTurn % rule.interval === 0
  ) {
    s.character.resource.current = Math.min(
      s.character.resource.max,
      s.character.resource.current + rule.amount,
    )
  }

  if (ruleType === "passive" && defendBonusTriggered && rule.on_defend_bonus) {
    s.character.resource.current = Math.min(
      s.character.resource.max,
      s.character.resource.current + rule.on_defend_bonus,
    )
  }
}

function recalcStats(s: GameState) {
  // Start from base stats
  const base = { ...s.character.stats }
  const effective: CharacterStats = { ...base }

  // Add equipment bonuses
  for (const slot of Object.values(s.equipment)) {
    if (!slot) continue
    try {
      const template = getItem(slot.template_id)
      if (template.stats) {
        for (const [key, val] of Object.entries(template.stats)) {
          if (isCharacterStatKey(key) && typeof val === "number") {
            effective[key] += val
          }
        }
      }
    } catch {
      // Unknown item template — skip
    }
  }

  // Add buff bonuses
  for (const buff of s.character.buffs) {
    if (buff.type === "buff-attack") effective.attack += buff.magnitude
    if (buff.type === "buff-defense") effective.defense += buff.magnitude
  }

  s.character.effective_stats = effective
}

function updateVisibility(s: GameState, room: RoomState, realm: GeneratedRealm) {
  // Get visibility radius from class template
  const cls = CLASSES[s.character.class]
  const radius = cls?.visibility_radius ?? 4

  const visible = computeVisibleTiles(
    {
      id: room.id,
      width: room.tiles[0]?.length ?? 0,
      height: room.tiles.length,
      tiles: room.tiles,
    },
    s.position.tile,
    radius,
  )

  // Merge into discovered tiles for current floor
  const floorKey = s.position.floor
  const existing = new Set(
    (s.discoveredTiles[floorKey] ?? []).map((t) => tileKey(t)),
  )
  const merged = mergeDiscoveredTiles(existing, visible)
  s.discoveredTiles[floorKey] = [...merged].map(parseTileKey)
}

// ── Observation builders ──────────────────────────────────────────────────────

export function buildObservationFromState(
  state: GameState,
  events: GameEvent[],
  realm: GeneratedRealm,
  startingItemIds: ReadonlySet<string> = EMPTY_ITEM_ID_SET,
): Observation {
  const room = getCurrentRoom(state)
  const genFloor = realm.floors.find((f) => f.floor_number === state.position.floor)
  const genRoom = genFloor?.rooms.find((r) => r.id === state.position.room_id)
  const canSenseTraps = hasTrapDisarmAbility(state)

  // Visible tiles
  const cls = CLASSES[state.character.class]
  const radius = cls?.visibility_radius ?? 4
  const visibleSet = room
    ? computeVisibleTiles(
        {
          id: room.id,
          width: room.tiles[0]?.length ?? 0,
          height: room.tiles.length,
          tiles: room.tiles,
        },
        state.position.tile,
        radius,
      )
    : new Set<string>()

  const visibleTiles: Tile[] = []
  if (room) {
    for (const key of visibleSet) {
      const pos = parseTileKey(key)
      const tile = room.tiles[pos.y]?.[pos.x]
      if (tile) visibleTiles.push(tile)
    }
  }

  // Visible entities
  const visibleEntities: Entity[] = []
  if (room) {
    for (const enemy of room.enemies) {
      if (enemy.hp <= 0) continue
      if (!visibleSet.has(tileKey(enemy.position))) continue
      const template = tryGetEnemy(enemy.template_id)
      visibleEntities.push({
        id: enemy.id,
        type: "enemy",
        name: template?.name ?? enemy.template_id,
        position: enemy.position,
        hp_current: enemy.hp,
        hp_max: enemy.hp_max,
        effects: [...enemy.effects],
        ...(template?.behavior ? { behavior: template.behavior } : {}),
        ...(template?.behavior === "boss" ? { is_boss: true } : {}),
      })
    }
    for (const item of room.items) {
      if (!visibleSet.has(tileKey(item.position))) continue
      const template = tryGetItem(item.template_id)
      visibleEntities.push({
        id: item.id,
        type: "item",
        name: template?.name ?? item.template_id,
        position: item.position,
        ...(template?.rarity ? { rarity: template.rarity } : {}),
        trapped: canSenseTraps && item.trapped === true && item.trap_disarmed !== true,
      })

      if (canSenseTraps && item.trapped && !item.trap_disarmed) {
        visibleEntities.push({
          id: getTrapMarkerId(item.id),
          type: "trap_visible",
          name: "Hidden Trap",
          position: item.position,
        })
      }
    }

    // Interactables from room template
    const obsRoomTemplate = findRoomTemplate(room.id)
    if (obsRoomTemplate) {
      for (let i = 0; i < obsRoomTemplate.loot_slots.length; i++) {
        const lootSlot = obsRoomTemplate.loot_slots[i]
        if (!lootSlot?.trapped) continue

        const itemId = `${room.id}_loot_${String(i).padStart(2, "0")}`
        const trapMarkerId = getTrapMarkerId(itemId)
        if (!state.mutatedEntities.includes(trapMarkerId)) continue
        if (!lootSlot.position || typeof lootSlot.position !== "object") continue
        if (!visibleSet.has(tileKey(lootSlot.position))) continue
        if (visibleEntities.some((entity) => entity.id === trapMarkerId)) continue

        visibleEntities.push({
          id: trapMarkerId,
          type: "trap_visible",
          name: "Triggered Trap",
          position: { x: lootSlot.position.x, y: lootSlot.position.y },
        })
      }

      for (const inter of obsRoomTemplate.interactables) {
        if (state.mutatedEntities.includes(inter.id)) continue
        // Interactables are room-wide by design; templates do not define positions.
        visibleEntities.push({
          id: inter.id,
          type: "interactable",
          name: inter.name,
          position: getInteractableMapPosition(room),
        })
      }
    }
  }

  // Known map
  const knownMap: KnownMapData = { floors: {} }
  for (const [floor, tiles] of Object.entries(state.discoveredTiles)) {
    knownMap.floors[Number(floor)] = {
      tiles: tiles.map((t) => ({
        x: t.x,
        y: t.y,
        type: "floor" as const,
        entities: [],
      })),
      rooms_visited: [...getVisitedRooms(state, Number(floor))],
    }
  }

  // Room text
  const roomTemplate = room ? findRoomTemplate(room.id) : null
  const isFirstVisit = genRoom
    ? !hasVisitedRoom(state, state.position.floor, state.position.room_id)
    : true
  const baseRoomText =
    isFirstVisit
      ? (roomTemplate?.text_first_visit ?? genRoom?.description_first_visit ?? null)
      : (roomTemplate?.text_revisit
          ?? genRoom?.description_revisit
          ?? roomTemplate?.text_first_visit
          ?? genRoom?.description_first_visit
          ?? null)
  const behaviorHints = visibleEntities.flatMap((entity) => {
    if (entity.type !== "enemy" || !entity.behavior) return []
    const distance = getAbilityRangeDistance(entity.position, state.position.tile)

    if (entity.behavior === "ambush" && distance > AMBUSH_TRIGGER_RANGE) {
      return [`${entity.name} lurks motionless in the shadows.`]
    }
    if (entity.behavior === "patrol" && distance > PATROL_DETECTION_RANGE) {
      return [`${entity.name} patrols the room without noticing you.`]
    }

    return []
  })
  const roomText = [baseRoomText, ...behaviorHints].filter(Boolean).join(" ").trim() || null

  // Inventory slots
  const inventorySlots: InventorySlot[] = state.inventory.map((item) => ({
    item_id: item.id,
    template_id: item.template_id,
    name: item.name,
    quantity: item.quantity,
    modifiers: item.modifiers,
  }))
  const newItemIds = inventorySlots
    .map((item) => item.item_id)
    .filter((itemId) => !startingItemIds.has(itemId))
  const inventoryCapacity = getEffectiveInventoryCapacity(state)

  // Legal actions
  const legalActions = computeLegalActions(state, room, realm)
  const abilities = buildAbilitySummaries(state)

  return {
    turn: 0, // filled by session layer
    character: {
      id: state.character.id,
      class: state.character.class,
      level: state.character.level,
      xp: state.character.xp,
      xp_to_next_level: xpToNextLevel(state.character.xp, state.character.level),
      skill_points: Math.max(0, (state.character.level - 1) - Object.keys(state.character.skill_tree ?? {}).length),
      hp: { ...state.character.hp },
      resource: { ...state.character.resource },
      buffs: [...state.character.buffs],
      debuffs: [...state.character.debuffs],
      cooldowns: { ...state.character.cooldowns },
      abilities,
      base_stats: state.character.stats,
      effective_stats: state.character.effective_stats,
      skill_tree: { ...(state.character.skill_tree ?? {}) },
    },
    inventory: inventorySlots,
    new_item_ids: newItemIds,
    inventory_slots_used: state.inventory.length,
    inventory_capacity: inventoryCapacity,
    equipment: { ...state.equipment },
    gold: state.character.gold,
    position: { ...state.position },
    visible_tiles: visibleTiles,
    known_map: knownMap,
    visible_entities: visibleEntities,
    room_text: roomText,
    recent_events: events,
    legal_actions: legalActions,
    realm_info: {
      template_name: state.realm.template_id,
      floor_count: state.realm.total_floors,
      current_floor: state.position.floor,
      status: state.realmStatus,
    },
  }
}

export function toSpectatorObservation(obs: Observation): SpectatorObservation {
  return {
    turn: obs.turn,
    character: {
      id: obs.character.id,
      class: obs.character.class,
      level: obs.character.level,
      hp_percent: obs.character.hp.max > 0
        ? Math.round((obs.character.hp.current / obs.character.hp.max) * 100)
        : 0,
      resource_percent: obs.character.resource.max > 0
        ? Math.round((obs.character.resource.current / obs.character.resource.max) * 100)
        : 0,
    },
    position: obs.position,
    visible_tiles: obs.visible_tiles,
    known_map: obs.known_map,
    visible_entities: obs.visible_entities.map(entityToSpectator),
    room_text: obs.room_text,
    recent_events: obs.recent_events,
    realm_info: obs.realm_info,
  }
}

function entityToSpectator(entity: Entity): SpectatorEntity {
  let health_indicator: SpectatorEntity["health_indicator"]
  if (entity.hp_current != null && entity.hp_max != null && entity.hp_max > 0) {
    const pct = entity.hp_current / entity.hp_max
    if (pct >= 1) health_indicator = "full"
    else if (pct >= 0.7) health_indicator = "high"
    else if (pct >= 0.4) health_indicator = "medium"
    else if (pct >= 0.15) health_indicator = "low"
    else health_indicator = "critical"
  }

  return {
    id: entity.id,
    type: entity.type === "trap_visible" ? "interactable" : entity.type,
    name: entity.name,
    position: entity.position,
    ...(health_indicator ? { health_indicator } : {}),
    ...(entity.behavior ? { behavior: entity.behavior } : {}),
    ...(entity.is_boss ? { is_boss: entity.is_boss } : {}),
  }
}

export function computeLegalActions(
  state: GameState,
  room: RoomState | undefined,
  realm: GeneratedRealm,
): Action[] {
  const actions: Action[] = []

  // Movement — always available in 4 directions
  for (const dir of ["up", "down", "left", "right"] as const) {
    actions.push({ type: "move", direction: dir })
  }

  // Wait
  actions.push({ type: "wait" })

  if (!room) return actions

  // Attack / abilities
  for (const abilityId of getPlayerAbilityIds(state)) {
    let ability: AbilityTemplate
    try {
      ability = getAbility(abilityId)
    } catch {
      continue
    }

    if (!canUseAbility(state, ability)) {
      continue
    }

    if (abilityRequiresAmmo(state, ability) && getAmmoCount(state) <= 0) {
      continue
    }

    const targetType = normalizeAbilityTarget(ability.target)
    if (targetType === "self" || targetType === "single-or-self") {
      actions.push({
        type: "attack",
        target_id: "self",
        ability_id: ability.id,
      })
    }

    if (targetType === "self") continue

    for (const enemy of room.enemies) {
      if (enemy.hp <= 0) continue
      if (!isAbilityTargetInRange(room, state.position.tile, enemy.position, ability)) {
        continue
      }
      actions.push({
        type: "attack",
        target_id: enemy.id,
        ability_id: ability.id,
      })
    }
  }

  // Pickup adjacent items
  for (const item of room.items) {
    const dist =
      Math.abs(state.position.tile.x - item.position.x) +
      Math.abs(state.position.tile.y - item.position.y)
    let canPickUp = dist <= 1
    if (canPickUp) {
      try {
        const template = getItem(item.template_id)
        canPickUp = canAddInventoryItem(
          state,
          item.template_id,
          template.stack_limit,
        ).hasSpace || item.template_id === "gold-coins"
      } catch {
        canPickUp = false
      }
    }
    if (canPickUp) {
      actions.push({ type: "pickup", item_id: item.id })
    }
  }

  if (hasTrapDisarmAbility(state)) {
    let ability: AbilityTemplate | null = null
    try {
      ability = getAbility(ROGUE_DISARM_TRAP_ABILITY_ID)
    } catch {
      ability = null
    }

    if (ability && canUseAbility(state, ability)) {
      for (const item of room.items) {
        const dist =
          Math.abs(state.position.tile.x - item.position.x) +
          Math.abs(state.position.tile.y - item.position.y)
        if (dist > 1) continue
        if (!item.trapped || item.trap_disarmed) continue
        actions.push({ type: "disarm_trap", item_id: item.id })
      }
    }
  }

  // Interact with available interactables
  const roomTemplate = findRoomTemplate(room.id)
  if (roomTemplate && room.id === state.position.room_id) {
    // Interactables are room-wide within the current room because templates do not store positions.
    for (const inter of roomTemplate.interactables) {
      if (!state.mutatedEntities.includes(inter.id)) {
        actions.push({ type: "interact", target_id: inter.id })
      }
    }
  }

  // Use items from inventory (skip ammo — consumed automatically by abilities)
  for (const item of state.inventory) {
    try {
      const template = getItem(item.template_id)
      if (template.type === "consumable" && template.effects && template.effects.length > 0) {
        actions.push({ type: "use_item", item_id: item.id })
      }
    } catch {
      // skip
    }
  }

  // Equip/unequip
  for (const item of state.inventory) {
    try {
      const template = getItem(item.template_id)
      if (
        template.type === "equipment"
        && template.equip_slot
        && (!template.class_restriction || template.class_restriction === state.character.class)
      ) {
        actions.push({ type: "equip", item_id: item.id })
      }
    } catch {
      // skip
    }
  }
  for (const slot of ["weapon", "armor", "helm", "hands", "accessory"] as const) {
    if (state.equipment[slot]) {
      actions.push({ type: "unequip", slot })
    }
  }

  // Extraction — available when no enemies are alive in the room
  if (canUsePortal(state, room)) {
    actions.push({ type: "use_portal" })
  }
  if (canRetreat(state, room, realm)) {
    actions.push({ type: "retreat" })
  }

  // Inspect
  for (const enemy of room.enemies) {
    if (enemy.hp > 0) actions.push({ type: "inspect", target_id: enemy.id })
  }

  return actions
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function deathEvent(s: GameState, detail: string): LobbyEvent {
  return {
    type: "death",
    characterName: "",
    characterClass: s.character.class,
    detail,
    timestamp: Date.now(),
  }
}

function result(
  s: GameState,
  mutations: WorldMutation[],
  events: GameEvent[],
  summary: string,
  roomChanged: boolean,
  notableEvents: LobbyEvent[],
  realm: GeneratedRealm,
): TurnResult {
  const observation = buildObservationFromState(s, events, realm)
  markRoomVisited(s, s.position.floor, s.position.room_id)
  return {
    newState: s,
    worldMutations: mutations,
    observation,
    summary,
    roomChanged,
    notableEvents,
  }
}

function tryGetEnemy(id: string) {
  const enemy = getEnemySafe(id)
  if (!enemy) console.warn(`[tryGetEnemy] Unknown enemy template "${id}"`)
  return enemy
}

function tryGetItem(id: string) {
  try {
    return getItem(id)
  } catch {
    return null
  }
}
