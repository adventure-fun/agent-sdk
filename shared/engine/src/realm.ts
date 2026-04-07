import type { RealmTemplate, Tile, TileType } from "@adventure-fun/schemas"
import { SeededRng, deriveSeed } from "./rng.js"

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
 * Uses room_templates in order to produce a fixed layout.
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
    // Distribute room templates across floors evenly
    const roomsPerFloor = Math.ceil(roomTemplateIds.length / floorCount)
    const floorRoomIds = roomTemplateIds.slice(roomOffset, roomOffset + roomsPerFloor)
    roomOffset += roomsPerFloor

    const rooms: GeneratedRoom[] = floorRoomIds.map((templateId, index) => {
      const id = `f${f}_r${index}_${templateId}`
      const textPool = template.narrative.room_text_pool
      const description = textPool.length > 0
        ? textPool[index % textPool.length].text
        : "You enter the room."

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
        description_first_visit: description,
        description_revisit: null,
      }
    })

    // Wire rooms linearly
    for (let r = 1; r < rooms.length; r++) {
      rooms[r - 1].connections.push(rooms[r].id)
      rooms[r].connections.push(rooms[r - 1].id)
    }

    floors.push({
      floor_number: f,
      rooms,
      entrance_room_id: rooms[0].id,
      exit_room_id: isFinalFloor ? null : rooms[rooms.length - 1].id,
      boss_room_id: isFinalFloor && hasBoss ? rooms[rooms.length - 1].id : null,
    })
  }

  return {
    template_id: template.id,
    template_version: template.version,
    seed,
    floors,
    total_floors: floorCount,
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

  // Entrance room is always a simple corridor/rest
  const entranceRoom = generateRoom(template, rng, floorNumber, 0, "rest", isFinalFloor)
  rooms.push(entranceRoom)

  // Middle rooms
  for (let r = 1; r < roomCount - 1; r++) {
    const type = pickRoomType(template, rng, isFinalFloor)
    const room = generateRoom(template, rng, floorNumber, r, type, isFinalFloor)
    // Connect to previous room
    const prevRoom = rooms[r - 1]
    if (prevRoom) {
      prevRoom.connections.push(room.id)
      room.connections.push(prevRoom.id)
    }
    rooms.push(room)
  }

  // Final room: boss on last floor, stairs otherwise
  const finalType = isFinalFloor ? "boss" : "combat"
  const finalRoom = generateRoom(template, rng, floorNumber, roomCount - 1, finalType, isFinalFloor)
  const prevRoom = rooms[roomCount - 2]
  if (prevRoom) {
    prevRoom.connections.push(finalRoom.id)
    finalRoom.connections.push(prevRoom.id)
  }
  rooms.push(finalRoom)

  return {
    floor_number: floorNumber,
    rooms,
    entrance_room_id: entranceRoom.id,
    exit_room_id: isFinalFloor ? null : finalRoom.id,
    boss_room_id: isFinalFloor ? finalRoom.id : null,
  }
}

function generateRoom(
  template: RealmTemplate,
  rng: SeededRng,
  floor: number,
  index: number,
  type: string,
  _isFinalFloor: boolean,
): GeneratedRoom {
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
    const types = ["combat", "treasure", "trap", "rest", "event"] as const
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
