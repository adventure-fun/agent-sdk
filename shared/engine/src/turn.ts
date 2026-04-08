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
} from "@adventure-fun/schemas"
import type { GeneratedRealm, GeneratedFloor, GeneratedRoom } from "./realm.js"
import {
  resolveAttack,
  resolveStatusEffectTick,
  type Combatant,
} from "./combat.js"
import {
  computeVisibleTiles,
  tileKey,
  parseTileKey,
  mergeDiscoveredTiles,
  type Position,
} from "./visibility.js"
import { getEnemy, getItem, CLASSES, ROOMS, REALMS } from "./content.js"
import { SeededRng, deriveSeed } from "./rng.js"

// ── Internal types ────────────────────────────────────────────────────────────

type RoomState = GameState["activeFloor"]["rooms"][number]

type Direction = "up" | "down" | "left" | "right"

const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function resolveTurn(
  state: GameState,
  action: Action,
  realm: GeneratedRealm,
  rng: SeededRng,
): TurnResult {
  const s = structuredClone(state)
  const mutations: WorldMutation[] = []
  const events: GameEvent[] = []
  const notableEvents: LobbyEvent[] = []
  let summary = ""
  let roomChanged = false

  const room = getCurrentRoom(s)
  if (!room) {
    return result(s, mutations, events, "Error: invalid room", false, notableEvents, realm)
  }

  // 1. Status effect ticks (poison, etc.)
  const statusDmg = processStatusEffects(s, events)
  if (s.character.hp.current <= 0) {
    notableEvents.push(deathEvent(s, "Succumbed to status effects"))
    return result(s, mutations, events, "You succumbed to your wounds.", false, notableEvents, realm)
  }

  // 2. Resolve player action
  switch (action.type) {
    case "move": {
      const r = resolveMove(s, room, action.direction, realm, events)
      summary = r.summary
      roomChanged = r.roomChanged
      break
    }
    case "attack": {
      const r = resolvePlayerAttack(s, room, action, rng, events, mutations)
      summary = r.summary
      if (r.notableEvent) notableEvents.push(r.notableEvent)
      break
    }
    case "use_item": {
      summary = resolveUseItem(s, action, events)
      break
    }
    case "pickup": {
      summary = resolvePickup(s, room, action, events, mutations)
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
      summary =
        action.type === "use_portal"
          ? "You step through the portal and return to safety."
          : "You retreat from the realm."
      events.push({ turn: 0, type: action.type, detail: summary, data: {} })
      break
    }
  }

  // 3. Enemy turns (skip if extracting)
  if (action.type !== "use_portal" && action.type !== "retreat") {
    const er = resolveEnemyTurns(s, room, rng, events)
    if (er.summary) summary += " " + er.summary
    if (er.playerDied) {
      notableEvents.push(deathEvent(s, er.killedBy ?? "Killed by an enemy"))
    }
  }

  // 4. Visibility
  updateVisibility(s, room, realm)

  // 5. Cooldowns
  tickCooldowns(s)

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

  // Build the new floor's rooms
  s.activeFloor.rooms = nextGenFloor.rooms.map((gr) =>
    buildRoomState(gr, s.mutatedEntities, s.realm.template_id, s.realm.seed),
  )
  s.position.floor = nextFloorNum
  s.position.room_id = nextGenFloor.entrance_room_id
  s.position.tile = { x: 1, y: 1 }

  events.push({
    turn: 0,
    type: "floor_change",
    detail: `Descended to floor ${nextFloorNum}`,
    data: { floor: nextFloorNum },
  })

  return { summary: `You descend to floor ${nextFloorNum}.` }
}

function resolvePlayerAttack(
  s: GameState,
  room: RoomState,
  action: { type: "attack"; target_id: string; ability_id?: string },
  rng: SeededRng,
  events: GameEvent[],
  mutations: WorldMutation[],
): { summary: string; notableEvent: LobbyEvent | null } {
  const enemy = room.enemies.find((e) => e.id === action.target_id && e.hp > 0)
  if (!enemy) {
    events.push({ turn: 0, type: "attack_miss", detail: "No valid target", data: {} })
    return { summary: "No valid target.", notableEvent: null }
  }

  // Check range — must be adjacent (Manhattan distance ≤ 1) for melee
  const dist =
    Math.abs(s.position.tile.x - enemy.position.x) +
    Math.abs(s.position.tile.y - enemy.position.y)
  if (dist > 1) {
    return { summary: "Target is out of range.", notableEvent: null }
  }

  const enemyTemplate = getEnemy(enemy.template_id)
  const attacker: Combatant = {
    id: s.character.id,
    stats: s.character.effective_stats,
    hp: s.character.hp.current,
    active_effects: s.character.buffs,
  }
  const defender: Combatant = {
    id: enemy.id,
    stats: enemyTemplate.stats,
    hp: enemy.hp,
    active_effects: [],
  }

  const combatResult = resolveAttack(attacker, defender, rng)

  // Apply damage to enemy
  enemy.hp = combatResult.defender_hp_after

  let summary: string
  let notableEvent: LobbyEvent | null = null

  if (!combatResult.hit) {
    summary = `You miss the ${enemyTemplate.name}.`
    events.push({ turn: 0, type: "attack_miss", detail: summary, data: { target: enemy.id } })
  } else {
    const critText = combatResult.critical ? " Critical hit!" : ""
    summary = `You deal ${combatResult.damage} damage to the ${enemyTemplate.name}.${critText}`
    events.push({
      turn: 0,
      type: "attack_hit",
      detail: summary,
      data: {
        target: enemy.id,
        damage: combatResult.damage,
        critical: combatResult.critical,
        defender_hp: enemy.hp,
      },
    })

    if (enemy.hp <= 0) {
      summary += ` The ${enemyTemplate.name} is defeated!`
      events.push({
        turn: 0,
        type: "enemy_killed",
        detail: `${enemyTemplate.name} defeated`,
        data: { enemy_id: enemy.id, xp: enemyTemplate.xp_value },
      })

      // Award XP
      s.character.xp += enemyTemplate.xp_value

      // Produce world mutation
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

      // Check for boss kill
      if (enemyTemplate.behavior === "boss") {
        s.realmStatus = "boss_cleared"
        notableEvent = {
          type: "boss_kill",
          characterName: "",
          characterClass: s.character.class,
          detail: `Defeated ${enemyTemplate.name}`,
          timestamp: Date.now(),
        }
      }
    }
  }

  return { summary, notableEvent }
}

function resolveEnemyTurns(
  s: GameState,
  room: RoomState,
  rng: SeededRng,
  events: GameEvent[],
): { summary: string; playerDied: boolean; killedBy: string | null } {
  const aliveEnemies = room.enemies.filter((e) => e.hp > 0)
  if (aliveEnemies.length === 0) return { summary: "", playerDied: false, killedBy: null }

  const parts: string[] = []
  let killedBy: string | null = null

  for (const enemy of aliveEnemies) {
    const template = getEnemy(enemy.template_id)
    const dist =
      Math.abs(s.position.tile.x - enemy.position.x) +
      Math.abs(s.position.tile.y - enemy.position.y)

    if (dist <= 1) {
      // Adjacent — attack the player
      const attacker: Combatant = {
        id: enemy.id,
        stats: template.stats,
        hp: enemy.hp,
        active_effects: [],
      }
      const defender: Combatant = {
        id: s.character.id,
        stats: s.character.effective_stats,
        hp: s.character.hp.current,
        active_effects: s.character.debuffs,
      }

      const combatResult = resolveAttack(attacker, defender, rng)
      s.character.hp.current = combatResult.defender_hp_after

      if (combatResult.hit) {
        const critText = combatResult.critical ? " Critical hit!" : ""
        parts.push(`${template.name} deals ${combatResult.damage} damage.${critText}`)
        events.push({
          turn: 0,
          type: "enemy_attack",
          detail: `${template.name} hit for ${combatResult.damage}`,
          data: {
            enemy_id: enemy.id,
            damage: combatResult.damage,
            critical: combatResult.critical,
            player_hp: s.character.hp.current,
          },
        })
      } else {
        parts.push(`${template.name} misses.`)
        events.push({
          turn: 0,
          type: "enemy_miss",
          detail: `${template.name} missed`,
          data: { enemy_id: enemy.id },
        })
      }

      // Apply status effects from combat
      for (const eff of combatResult.effects_applied) {
        s.character.debuffs.push(eff)
      }

      if (s.character.hp.current <= 0) {
        killedBy = template.name
        break
      }
    } else {
      // Not adjacent — move one tile toward player
      moveEnemyToward(enemy, s.position.tile, room)
    }
  }

  return {
    summary: parts.join(" "),
    playerDied: s.character.hp.current <= 0,
    killedBy,
  }
}

function moveEnemyToward(
  enemy: RoomState["enemies"][number],
  target: { x: number; y: number },
  room: RoomState,
) {
  const dx = Math.sign(target.x - enemy.position.x)
  const dy = Math.sign(target.y - enemy.position.y)
  const height = room.tiles.length
  const width = room.tiles[0]?.length ?? 0

  // Try horizontal first, then vertical
  const candidates = [
    { x: enemy.position.x + dx, y: enemy.position.y },
    { x: enemy.position.x, y: enemy.position.y + dy },
  ].filter(({ x, y }) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const tile = room.tiles[y]?.[x]
    if (!tile || tile.type === "wall") return false
    // Don't walk onto other enemies
    if (room.enemies.some((e) => e.hp > 0 && e.id !== enemy.id && e.position.x === x && e.position.y === y))
      return false
    return true
  })

  if (candidates[0]) {
    enemy.position = { x: candidates[0].x, y: candidates[0].y }
  }
}

function resolveUseItem(
  s: GameState,
  action: { type: "use_item"; item_id: string; target_id?: string },
  events: GameEvent[],
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
      case "heal_hp": {
        const amount = Math.min(effect.magnitude ?? 0, s.character.hp.max - s.character.hp.current)
        s.character.hp.current += amount
        parts.push(`Restored ${amount} HP.`)
        break
      }
      case "heal_resource": {
        const amount = Math.min(
          effect.magnitude ?? 0,
          s.character.resource.max - s.character.resource.current,
        )
        s.character.resource.current += amount
        parts.push(`Restored ${amount} ${s.character.resource.type}.`)
        break
      }
      case "cure_debuff": {
        s.character.debuffs = []
        parts.push("Debuffs cleared.")
        break
      }
      case "buff": {
        s.character.buffs.push({
          type: "buff_attack",
          turns_remaining: effect.duration ?? 5,
          magnitude: effect.magnitude ?? 5,
        })
        parts.push(`Attack boosted by ${effect.magnitude ?? 5} for ${effect.duration ?? 5} turns.`)
        break
      }
      case "portal": {
        // Signal portal usage — session layer handles extraction
        parts.push("A portal opens before you.")
        break
      }
      case "reveal_map": {
        parts.push("The map reveals itself.")
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

  // Add to inventory
  const existing = s.inventory.find(
    (i) => i.template_id === floorItem.template_id && i.quantity < template.stack_limit,
  )
  if (existing) {
    existing.quantity += 1
  } else {
    s.inventory.push({
      id: floorItem.id,
      template_id: floorItem.template_id,
      name: template.name,
      quantity: 1,
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

  const summary = `Picked up ${template.name}.`
  events.push({ turn: 0, type: "pickup", detail: summary, data: { item_id: floorItem.id } })
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
      case "enemy_defeated":
        if (!s.mutatedEntities.includes(cond.entity_id)) {
          return "Something must be dealt with first."
        }
        break
      case "has_item":
        if (!s.inventory.some((i) => i.template_id === cond.item_id)) {
          return "You're missing something."
        }
        break
      case "class_is":
        if (s.character.class !== cond.class) continue // condition doesn't apply
        break
    }
  }

  // Apply interactable effects
  const parts: string[] = [interactable.text_on_interact]
  for (const effect of interactable.effects) {
    applyEffect(s, effect, parts)
  }

  // Check triggers for this interactable
  for (const trigger of roomTemplate.triggers) {
    if (trigger.target_id !== action.target_id) continue
    if (trigger.trigger_on !== "interact") continue

    // Check trigger conditions
    let conditionsMet = true
    for (const cond of trigger.conditions) {
      if (cond.type === "class_is" && s.character.class !== cond.class) {
        conditionsMet = false
        break
      }
      if (cond.type === "enemy_defeated" && !s.mutatedEntities.includes(cond.entity_id)) {
        conditionsMet = false
        break
      }
    }

    if (conditionsMet) {
      for (const effect of trigger.effects) {
        applyEffect(s, effect, parts)
      }
    }
  }

  // Mark as used
  const mutationType: MutationType = interactable.lore_entry_id ? "discovered" : "used"
  mutations.push({
    entity_id: action.target_id,
    mutation: mutationType,
    floor: s.position.floor,
    metadata: { name: interactable.name },
  })
  s.mutatedEntities.push(action.target_id)

  const summary = parts.join(" ")
  events.push({ turn: 0, type: "interact", detail: summary, data: { target: action.target_id } })
  return summary
}

function applyEffect(
  s: GameState,
  effect: { type: string; [key: string]: unknown },
  parts: string[],
) {
  switch (effect.type) {
    case "grant_item": {
      const templateId = effect.item_template_id as string
      const qty = (effect.quantity as number) ?? 1
      try {
        const template = getItem(templateId)
        const existing = s.inventory.find(
          (i) => i.template_id === templateId && i.quantity < template.stack_limit,
        )
        if (existing) {
          existing.quantity += qty
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
    case "grant_gold": {
      const amount = effect.amount as number
      s.character.gold += amount
      parts.push(`Received ${amount} gold.`)
      break
    }
    case "heal_hp": {
      const amount = Math.min(effect.amount as number, s.character.hp.max - s.character.hp.current)
      s.character.hp.current += amount
      parts.push(`Restored ${amount} HP.`)
      break
    }
    case "reveal_lore": {
      parts.push("You discover a piece of lore.")
      break
    }
    case "show_text": {
      parts.push(effect.text as string)
      break
    }
    case "apply_buff": {
      const buff = effect.buff as ActiveEffect
      if (buff) s.character.buffs.push({ ...buff })
      break
    }
    case "apply_debuff": {
      const debuff = effect.debuff as ActiveEffect
      if (debuff) s.character.debuffs.push({ ...debuff })
      break
    }
    case "cure_debuffs": {
      s.character.debuffs = []
      parts.push("Debuffs cleared.")
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
    const template = getEnemy(enemy.template_id)
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

  // Map enemy index → template_id using room template's enemy_slots order
  const enemyTemplateMap: Array<{ templateId: string; pos: { x: number; y: number } }> = []
  if (roomTemplate) {
    for (const slot of roomTemplate.enemy_slots) {
      const count = slot.count.max
      const pos =
        typeof slot.position === "object"
          ? { x: slot.position.x, y: slot.position.y }
          : { x: 3, y: 3 }
      for (let e = 0; e < count; e++) {
        enemyTemplateMap.push({ templateId: slot.enemy_template_id, pos })
      }
    }
  }

  const enemies: RoomState["enemies"] = []
  for (let i = 0; i < genRoom.enemy_ids.length; i++) {
    const enemyId = genRoom.enemy_ids[i]!
    if (mutatedEntities.includes(enemyId)) continue

    const mapped = enemyTemplateMap[i]
    const templateId = mapped?.templateId ?? "unknown"
    let hp = 20
    try {
      hp = getEnemy(templateId).stats.hp
    } catch {
      // unknown template — use default HP
    }

    enemies.push({
      id: enemyId,
      template_id: templateId,
      hp,
      hp_max: hp,
      position: mapped?.pos ? { ...mapped.pos } : { x: 3, y: 3 },
    })
  }

  // Resolve loot items from room template's loot_slots + realm loot tables
  const items: RoomState["items"] = []
  const realmTemplate = realmTemplateId ? REALMS[realmTemplateId] : undefined
  const lootTables = realmTemplate?.loot_tables

  for (let i = 0; i < genRoom.item_ids.length; i++) {
    const itemId = genRoom.item_ids[i]!
    if (mutatedEntities.includes(itemId)) continue

    let templateId = "health_potion" // fallback
    const lootSlot = roomTemplate?.loot_slots[i]
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
            break
          }
        }
      }
    }

    items.push({
      id: itemId,
      template_id: templateId,
      position: { x: 2, y: 2 },
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
  if (s.character.debuffs.length === 0) return 0

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

  return damage
}

function tickCooldowns(s: GameState) {
  for (const key of Object.keys(s.character.cooldowns)) {
    const val = s.character.cooldowns[key]
    if (val !== undefined && val > 0) {
      s.character.cooldowns[key] = val - 1
    }
    if (s.character.cooldowns[key] === 0) {
      delete s.character.cooldowns[key]
    }
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
          if (key in effective && typeof val === "number") {
            (effective as Record<string, number>)[key] =
              ((effective as Record<string, number>)[key] ?? 0) + val
          }
        }
      }
    } catch {
      // Unknown item template — skip
    }
  }

  // Add buff bonuses
  for (const buff of s.character.buffs) {
    if (buff.type === "buff_attack") effective.attack += buff.magnitude
    if (buff.type === "buff_defense") effective.defense += buff.magnitude
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
): Observation {
  const room = getCurrentRoom(state)
  const genFloor = realm.floors.find((f) => f.floor_number === state.position.floor)
  const genRoom = genFloor?.rooms.find((r) => r.id === state.position.room_id)

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
      })
    }

    // Interactables from room template
    const obsRoomTemplate = findRoomTemplate(room.id)
    if (obsRoomTemplate) {
      for (const inter of obsRoomTemplate.interactables) {
        if (state.mutatedEntities.includes(inter.id)) continue
        visibleEntities.push({
          id: inter.id,
          type: "interactable",
          name: inter.name,
          position: { x: 0, y: 0 },
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
      rooms_visited: [], // TODO: track visited rooms
    }
  }

  // Room text
  const roomTemplate = room ? findRoomTemplate(room.id) : null
  const isFirstVisit = genRoom
    ? !state.discoveredTiles[state.position.floor]?.some(
        (t) => t.x === state.position.tile.x && t.y === state.position.tile.y,
      )
    : true
  const roomText =
    roomTemplate?.text_first_visit ?? genRoom?.description_first_visit ?? null

  // Inventory slots
  const inventorySlots: InventorySlot[] = state.inventory.map((item) => ({
    item_id: item.id,
    template_id: item.template_id,
    name: item.name,
    quantity: item.quantity,
    modifiers: item.modifiers,
  }))

  // Legal actions
  const legalActions = computeLegalActions(state, room, realm)

  return {
    turn: 0, // filled by session layer
    character: {
      id: state.character.id,
      class: state.character.class,
      level: state.character.level,
      xp: state.character.xp,
      hp: { ...state.character.hp },
      resource: { ...state.character.resource },
      buffs: [...state.character.buffs],
      debuffs: [...state.character.debuffs],
      cooldowns: { ...state.character.cooldowns },
      base_stats: state.character.stats,
      effective_stats: state.character.effective_stats,
    },
    inventory: inventorySlots,
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
    health_indicator,
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

  // Attack adjacent enemies
  for (const enemy of room.enemies) {
    if (enemy.hp <= 0) continue
    const dist =
      Math.abs(state.position.tile.x - enemy.position.x) +
      Math.abs(state.position.tile.y - enemy.position.y)
    if (dist <= 1) {
      actions.push({ type: "attack", target_id: enemy.id })
    }
  }

  // Pickup adjacent items
  for (const item of room.items) {
    const dist =
      Math.abs(state.position.tile.x - item.position.x) +
      Math.abs(state.position.tile.y - item.position.y)
    if (dist <= 1) {
      actions.push({ type: "pickup", item_id: item.id })
    }
  }

  // Interact with available interactables
  const roomTemplate = findRoomTemplate(room.id)
  if (roomTemplate) {
    for (const inter of roomTemplate.interactables) {
      if (!state.mutatedEntities.includes(inter.id)) {
        actions.push({ type: "interact", target_id: inter.id })
      }
    }
  }

  // Use items from inventory
  for (const item of state.inventory) {
    try {
      const template = getItem(item.template_id)
      if (template.type === "consumable") {
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
      if (template.type === "equipment" && template.equip_slot) {
        actions.push({ type: "equip", item_id: item.id })
      }
    } catch {
      // skip
    }
  }
  for (const slot of ["weapon", "armor", "accessory", "class_specific"] as const) {
    if (state.equipment[slot]) {
      actions.push({ type: "unequip", slot })
    }
  }

  // Extraction — available when no enemies are alive in the room
  const hasLiveEnemies = room.enemies.some((e) => e.hp > 0)
  if (!hasLiveEnemies) {
    actions.push({ type: "use_portal" })
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
  return {
    newState: s,
    worldMutations: mutations,
    observation: buildObservationFromState(s, events, realm),
    summary,
    roomChanged,
    notableEvents,
  }
}

function tryGetEnemy(id: string) {
  try {
    return getEnemy(id)
  } catch {
    return null
  }
}

function tryGetItem(id: string) {
  try {
    return getItem(id)
  } catch {
    return null
  }
}
