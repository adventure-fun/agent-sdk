import type { RealmTemplate, RoomTemplate, Tile, TileType } from "@adventure-fun/schemas"
import { SeededRng, deriveSeed } from "./rng.js"
import { ROOMS } from "./content.js"

export interface GeneratedRoom {
  id: string          // deterministic: f{floor}_r{room}_{type}_{index}
  type: string
  width: number
  height: number
  tiles: Tile[][]
  enemy_ids: string[]
  item_ids: string[]
  trap_ids: string[]
  connections: string[] // room IDs this room connects to
  description_first_visit: string
  description_revisit: string | null
}

export interface GeneratedFloor {
  floor_number: number
  rooms: GeneratedRoom[]
  entrance_room_id: string
  exit_room_id: string | null  // null on final floor (boss room is the "exit")
  boss_room_id: string | null  // only on final floor
}

export interface GeneratedRealm {
  template_id: string
  template_version: number
  seed: number
  floors: GeneratedFloor[]
  total_floors: number
}

/**
 * Generates a complete realm deterministically from seed + template.
 * Same seed + same template version = same realm, always.
 *
 * When template.procedural is false, generates a fixed layout using
 * the room_templates list in order rather than random generation.
 */
export function generateRealm(
  template: RealmTemplate,
  seed: number,
): GeneratedRealm {
  if (template.procedural === false) {
    return generateHandcraftedRealm(template, seed)
  }

  const rng = new SeededRng(seed)
  const floorCount = rng.nextInt(template.floor_count.min, template.floor_count.max)
  const hasBoss = template.boss_id != null
  const floors: GeneratedFloor[] = []

  for (let f = 1; f <= floorCount; f++) {
    const floorRng = new SeededRng(deriveSeed(seed, `floor_${f}`))
    const isFinalFloor = f === floorCount
    floors.push(generateFloor(template, floorRng, f, isFinalFloor && hasBoss))
  }

  return {
    template_id: template.id,
    template_version: template.version,
    seed,
    floors,
    total_floors: floorCount,
  }
}

/**
 * Generates a handcrafted realm from a template with procedural: false.
 * Uses room_templates in order, looking up actual RoomTemplate JSON for
 * size, text, enemy slots, and loot slots.
 */
function generateHandcraftedRealm(
  template: RealmTemplate,
  seed: number,
): GeneratedRealm {
  const roomTemplateIds = template.room_templates
  const hasBoss = template.boss_id != null
  const floorCount = template.floor_count.min // fixed for handcrafted
  const floors: GeneratedFloor[] = []

  let roomOffset = 0
  for (let f = 1; f <= floorCount; f++) {
    const isFinalFloor = f === floorCount
    const roomsPerFloor = Math.ceil(roomTemplateIds.length / floorCount)
    const floorRoomIds = roomTemplateIds.slice(roomOffset, roomOffset + roomsPerFloor)
    roomOffset += roomsPerFloor

    const rooms: GeneratedRoom[] = floorRoomIds.map((templateId, index) => {
      return generateRoomFromTemplate(templateId, f, index)
    })

    // Wire rooms linearly, skipping forward connections blocked by locked_exit
    for (let r = 1; r < rooms.length; r++) {
      const prevTemplateId = floorRoomIds[r - 1]
      const prevTemplate = prevTemplateId ? ROOMS[prevTemplateId] : undefined
      const currentRoom = rooms[r]!
      const previousRoom = rooms[r - 1]!
      if (prevTemplate?.locked_exit) {
        // Previous room has a locked exit — don't connect forward.
        // Player must unlock the door at runtime to create this connection.
        // Still connect backward so player can retreat.
        currentRoom.connections.push(previousRoom.id)
      } else {
        previousRoom.connections.push(currentRoom.id)
        currentRoom.connections.push(previousRoom.id)
      }
    }

    const floorResult: GeneratedFloor = {
      floor_number: f,
      rooms,
      entrance_room_id: rooms[0]!.id,
      exit_room_id: isFinalFloor ? null : rooms[rooms.length - 1]!.id,
      boss_room_id: isFinalFloor && hasBoss ? rooms[rooms.length - 1]!.id : null,
    }
    placeDoors(floorResult)
    floors.push(floorResult)
  }

  return {
    template_id: template.id,
    template_version: template.version,
    seed,
    floors,
    total_floors: floorCount,
  }
}

/**
 * Generates a room from a RoomTemplate definition.
 * Uses the actual template data for size, text, enemy placement, and loot.
 * Falls back to defaults if no template is found in the ROOMS registry.
 */
function generateRoomFromTemplate(
  templateId: string,
  floor: number,
  index: number,
): GeneratedRoom {
  const roomTemplate = ROOMS[templateId]
  const id = `f${floor}_r${index}_${templateId}`

  if (!roomTemplate) {
    // Fallback for room IDs not yet in the registry
    return {
      id,
      type: templateId,
      width: 7,
      height: 7,
      tiles: buildRoomTiles(7, 7),
      enemy_ids: [],
      item_ids: [],
      trap_ids: [],
      connections: [],
      description_first_visit: "You enter the room.",
      description_revisit: null,
    }
  }

  const { width, height } = roomTemplate.size
  const tiles = buildRoomTiles(width, height)

  // Generate enemy entity IDs from enemy_slots
  const enemy_ids: string[] = []
  for (const slot of roomTemplate.enemy_slots) {
    const count = slot.count.max // handcrafted uses fixed counts
    for (let e = 0; e < count; e++) {
      enemy_ids.push(`${id}_enemy_${String(enemy_ids.length).padStart(2, "0")}`)
    }
  }

  // Generate item entity IDs from loot_slots
  const item_ids: string[] = roomTemplate.loot_slots.map(
    (_, i) => `${id}_loot_${String(i).padStart(2, "0")}`
  )

  return {
    id,
    type: roomTemplate.type,
    width,
    height,
    tiles,
    enemy_ids,
    item_ids,
    trap_ids: [],
    connections: [],
    description_first_visit: roomTemplate.text_first_visit,
    description_revisit: roomTemplate.text_revisit,
  }
}

function generateFloor(
  template: RealmTemplate,
  rng: SeededRng,
  floorNumber: number,
  isFinalFloor: boolean,
): GeneratedFloor {
  const roomCount = rng.nextInt(4, 8)
  const rooms: GeneratedRoom[] = []
  // Guaranteed key-items gained so far on this floor. Populated from
  // grant-item interactable effects as rooms are placed and consulted when
  // picking later rooms so a locked_exit candidate is only eligible once its
  // key source is upstream. This is the procedural path's solvability guard.
  const availableKeys = new Set<string>()

  const recordRoomGrants = (room: GeneratedRoom) => {
    const rt = findRoomTemplateForGeneratedRoom(room.id)
    if (!rt) return
    for (const item of collectGrantedItemTemplateIds(rt)) {
      availableKeys.add(item)
    }
  }

  const connectRooms = (prev: GeneratedRoom, next: GeneratedRoom) => {
    const prevTemplate = findRoomTemplateForGeneratedRoom(prev.id)
    if (prevTemplate?.locked_exit) {
      // Previous room has a locked exit — don't create the forward edge.
      // Backward traversal is still allowed so the player can retreat to
      // pick up a missed key; the forward connection is added when the
      // lock is mutated via replayLockedExitUnlocks.
      next.connections.push(prev.id)
    } else {
      prev.connections.push(next.id)
      next.connections.push(prev.id)
    }
  }

  // Entrance room is always a simple corridor/rest
  const entranceRoom = generateRoom(template, rng, floorNumber, 0, "rest", isFinalFloor, availableKeys)
  rooms.push(entranceRoom)
  recordRoomGrants(entranceRoom)

  // Middle rooms
  for (let r = 1; r < roomCount - 1; r++) {
    const type = pickRoomType(template, rng, isFinalFloor)
    const room = generateRoom(template, rng, floorNumber, r, type, isFinalFloor, availableKeys)
    const prevRoom = rooms[r - 1]
    if (prevRoom) connectRooms(prevRoom, room)
    rooms.push(room)
    recordRoomGrants(room)
  }

  // Final room: boss on last floor, combat otherwise
  const finalType = isFinalFloor ? "boss" : "combat"
  const finalRoom = generateRoom(template, rng, floorNumber, roomCount - 1, finalType, isFinalFloor, availableKeys)
  const prevRoom = rooms[roomCount - 2]
  if (prevRoom) connectRooms(prevRoom, finalRoom)
  rooms.push(finalRoom)
  recordRoomGrants(finalRoom)

  const floorResult: GeneratedFloor = {
    floor_number: floorNumber,
    rooms,
    entrance_room_id: entranceRoom.id,
    exit_room_id: isFinalFloor ? null : finalRoom.id,
    boss_room_id: isFinalFloor ? finalRoom.id : null,
  }

  placeDoors(floorResult)
  return floorResult
}

// Returns the set of item_template_ids that the room's interactables grant
// via `grant-item` effects. Used by the procedural solvability filter —
// loot_slot drops are intentionally excluded because they're probabilistic
// and would make the solvability guarantee hollow.
function collectGrantedItemTemplateIds(roomTemplate: RoomTemplate): Set<string> {
  const out = new Set<string>()
  for (const interactable of roomTemplate.interactables) {
    for (const effect of interactable.effects) {
      if (effect.type === "grant-item") {
        out.add(effect.item_template_id)
      }
    }
  }
  return out
}

// Returns the item_id required by the room's locked_exit, or null if the
// room has no locked exit or the lock does not have a has-item condition.
function getLockedExitKeyRequirement(roomTemplate: RoomTemplate): string | null {
  if (!roomTemplate.locked_exit) return null
  const lockInteractable = roomTemplate.interactables.find(
    (i) => i.id === roomTemplate.locked_exit,
  )
  if (!lockInteractable) return null
  for (const cond of lockInteractable.conditions) {
    if (cond.type === "has-item") return cond.item_id
  }
  return null
}

function generateRoom(
  template: RealmTemplate,
  rng: SeededRng,
  floor: number,
  index: number,
  type: string,
  _isFinalFloor: boolean,
  availableKeys: ReadonlySet<string> = new Set(),
): GeneratedRoom {
  // For procedural generation, try to pick a matching room template by type.
  // Solvability filter: drop any candidate whose locked_exit needs a key that
  // hasn't been placed upstream on this floor yet. If the filter empties the
  // pool we fall through to the narrative-text-pool fallback below rather
  // than picking an unsolvable locked room — content-authored locked rooms
  // are an opt-in pattern and "don't place it this run" is strictly safer
  // than "place it and soft-lock the player."
  const matchingTemplates = template.room_templates
    .map((id) => ROOMS[id])
    .filter((rt): rt is RoomTemplate => rt != null && rt.type === type)
    .filter((rt) => {
      const requiredKey = getLockedExitKeyRequirement(rt)
      if (requiredKey == null) return true
      return availableKeys.has(requiredKey)
    })

  if (matchingTemplates.length > 0) {
    const roomTemplate = rng.pick(matchingTemplates)
    const id = `f${floor}_r${index}_${roomTemplate.id}`
    const { width, height } = roomTemplate.size
    const tiles = buildRoomTiles(width, height)

    const enemy_ids: string[] = []
    for (const slot of roomTemplate.enemy_slots) {
      const count = rng.nextInt(slot.count.min, slot.count.max)
      for (let e = 0; e < count; e++) {
        enemy_ids.push(`${id}_enemy_${String(enemy_ids.length).padStart(2, "0")}`)
      }
    }

    const item_ids: string[] = roomTemplate.loot_slots.map(
      (_, i) => `${id}_loot_${String(i).padStart(2, "0")}`
    )

    const trap_ids: string[] = []
    if (type === "trap") {
      trap_ids.push(`${id}_trap_00`)
    }

    return {
      id,
      type: roomTemplate.type,
      width,
      height,
      tiles,
      enemy_ids,
      item_ids,
      trap_ids,
      connections: [],
      description_first_visit: roomTemplate.text_first_visit,
      description_revisit: roomTemplate.text_revisit,
    }
  }

  // Fallback: generate room from realm-level narrative text pool
  const id = `f${floor}_r${index}_${type}`
  const width = rng.nextInt(5, 10)
  const height = rng.nextInt(5, 10)
  const tiles = buildRoomTiles(width, height)

  const enemy_ids: string[] = []
  const item_ids: string[] = []
  const trap_ids: string[] = []

  if (type === "combat" || type === "boss") {
    const enemyCount = type === "boss" ? 1 : rng.nextInt(1, 3)
    for (let e = 0; e < enemyCount; e++) {
      enemy_ids.push(`${id}_enemy_${String(e).padStart(2, "0")}`)
    }
  }

  if (type === "treasure") {
    item_ids.push(`${id}_chest_00`)
  }

  if (type === "trap") {
    trap_ids.push(`${id}_trap_00`)
  }

  const textPool = template.narrative.room_text_pool
  const firstVisitText = textPool.length > 0
    ? rng.pick(textPool).text
    : "You enter the room."

  return {
    id,
    type,
    width,
    height,
    tiles,
    enemy_ids,
    item_ids,
    trap_ids,
    connections: [],
    description_first_visit: firstVisitText,
    description_revisit: null,
  }
}

function pickRoomType(template: RealmTemplate, rng: SeededRng, isFinalFloor: boolean): string {
  if (isFinalFloor) {
    // No boss rooms mid-floor
    const types = ["combat", "treasure", "trap", "rest", "event"]
    return rng.pick(types)
  }

  const dist = template.room_distribution
  const weights: Array<[string, number]> = [
    ["combat", dist.combat],
    ["treasure", dist.treasure],
    ["trap", dist.trap],
    ["rest", dist.rest],
    ["event", dist.event],
  ]

  const total = weights.reduce((sum, [, w]) => sum + w, 0)
  let roll = rng.next() * total
  for (const [type, weight] of weights) {
    roll -= weight
    if (roll <= 0) return type
  }
  return "combat"
}

/**
 * After rooms are connected, punch door tiles through the walls
 * so the player can see and walk through exits.
 * Linear chain: previous room ← left wall door | right wall door → next room.
 * Exit rooms (non-final floor) get a stairs tile instead of a right door.
 * Floors above 1 also get a stairs_up tile at the entrance room.
 *
 * Rooms whose template has a `locked_exit` get an east wall by default,
 * regardless of whether the east neighbor is the next intra-floor room or
 * the floor-descent stairs. replayLockedExitUnlocks is what swaps that wall
 * to a door (intra-floor) or stairs (floor-exit) once the lock is mutated,
 * so placeDoors leaving the wall in place here keeps the two code paths in
 * sync and removes the landmine where a locked room at the tail of a floor
 * would silently place walkable stairs that bypassed the gate.
 */
function placeDoors(floor: GeneratedFloor): void {
  const rooms = floor.rooms
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i]!
    const h = room.tiles.length
    const w = room.tiles[0]?.length ?? 0
    if (h < 3 || w < 3) continue

    const midY = Math.floor(h / 2)
    const template = findRoomTemplateForGeneratedRoom(room.id)
    const hasLockedExit = template?.locked_exit != null

    // Floors above 1 get an up-stair at the entrance room's left wall.
    if (floor.floor_number > 1 && room.id === floor.entrance_room_id) {
      const row = room.tiles[midY]
      if (row) row[0] = { x: 0, y: midY, type: "stairs_up", entities: [] }
    }

    // Door to previous room → left wall center
    const prev = rooms[i - 1]
    if (prev && room.connections.includes(prev.id) && room.id !== floor.entrance_room_id) {
      const row = room.tiles[midY]
      if (row) row[0] = { x: 0, y: midY, type: "door", entities: [] }
    }

    // Door/stairs to next room → right wall center. Skipped for rooms with a
    // locked_exit — the wiring loop does not add a forward connection in that
    // case, so `connections.includes(next.id)` is already false, but we also
    // never want an east door painted for a locked gate room since
    // replayLockedExitUnlocks is the single source of truth for the swap.
    const next = rooms[i + 1]
    if (!hasLockedExit && next && room.connections.includes(next.id)) {
      const row = room.tiles[midY]
      // If this is the exit room, use stairs instead of door
      const tileType: TileType = room.id === floor.exit_room_id ? "stairs" : "door"
      if (row) row[w - 1] = { x: w - 1, y: midY, type: tileType, entities: [] }
    }

    // If this is the exit room with no next room in the chain and the room
    // does NOT have a locked_exit, place stairs on the right wall center
    // for floor descent. A locked_exit on the floor-exit room gates those
    // stairs: the wall stays until the lock is mutated and
    // replayLockedExitUnlocks swaps wall → stairs.
    if (!hasLockedExit && room.id === floor.exit_room_id && !next) {
      const row = room.tiles[midY]
      if (row) row[w - 1] = { x: w - 1, y: midY, type: "stairs", entities: [] }
    }
  }
}

function buildRoomTiles(width: number, height: number): Tile[][] {
  const tiles: Tile[][] = []
  for (let y = 0; y < height; y++) {
    const row: Tile[] = []
    for (let x = 0; x < width; x++) {
      const isWall = x === 0 || y === 0 || x === width - 1 || y === height - 1
      const type: TileType = isWall ? "wall" : "floor"
      row.push({ x, y, type, entities: [] })
    }
    tiles.push(row)
  }
  return tiles
}

function findRoomTemplateForGeneratedRoom(generatedRoomId: string): RoomTemplate | null {
  // Generated room IDs look like: f1_r0_tutorial-storeroom — template id is everything after the second underscore
  const parts = generatedRoomId.split("_")
  if (parts.length < 3) return null
  const templateId = parts.slice(2).join("_")
  return ROOMS[templateId] ?? null
}

/**
 * Replays locked-exit unlocks against an already-generated realm so that the
 * in-memory topology matches the unlock-door effects that have already fired
 * for this realm instance. Must be called after generateRealm() and before
 * any code that reads room.connections or room.tiles.
 *
 * Idempotent: guards against duplicate connections and re-door'ing a tile
 * that is already a door, so it is safe to invoke more than once.
 */
export function replayLockedExitUnlocks(
  realm: GeneratedRealm,
  mutatedEntities: ReadonlySet<string> | readonly string[],
): void {
  const mutatedSet =
    mutatedEntities instanceof Set
      ? (mutatedEntities as ReadonlySet<string>)
      : new Set<string>(mutatedEntities as readonly string[])

  for (const floor of realm.floors) {
    for (let i = 0; i < floor.rooms.length; i++) {
      const genRoom = floor.rooms[i]!
      const template = findRoomTemplateForGeneratedRoom(genRoom.id)
      if (!template?.locked_exit) continue
      if (!mutatedSet.has(template.locked_exit)) continue

      const h = genRoom.tiles.length
      const w = genRoom.tiles[0]?.length ?? 0
      const midY = Math.floor(h / 2)
      const row = genRoom.tiles[midY]

      const nextRoom = floor.rooms[i + 1]
      if (nextRoom) {
        // Intra-floor locked connection: punch a door and wire forward.
        if (!genRoom.connections.includes(nextRoom.id)) {
          genRoom.connections.push(nextRoom.id)
        }
        if (row && row[w - 1]?.type !== "door") {
          row[w - 1] = { x: w - 1, y: midY, type: "door", entities: [] }
        }
      } else if (genRoom.id === floor.exit_room_id) {
        // Floor-exit locked stairs: swap the east-wall center to stairs so the
        // player can descend. placeDoors deliberately leaves the wall in place
        // for rooms with a locked_exit, so there is nothing to clean up first.
        if (row && row[w - 1]?.type !== "stairs") {
          row[w - 1] = { x: w - 1, y: midY, type: "stairs", entities: [] }
        }
      }
    }
  }
}
