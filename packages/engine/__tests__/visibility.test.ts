import { describe, it, expect } from "bun:test"
import {
  computeVisibleTiles,
  hasLineOfSight,
  tileKey,
  mergeDiscoveredTiles,
} from "../src/visibility.js"
import type { Room } from "../src/visibility.js"
import type { Tile } from "@adventure-fun/schemas"

function makeOpenRoom(width: number, height: number): Room {
  const tiles: Tile[][] = []
  for (let y = 0; y < height; y++) {
    const row: Tile[] = []
    for (let x = 0; x < width; x++) {
      const isWall = x === 0 || y === 0 || x === width - 1 || y === height - 1
      row.push({ x, y, type: isWall ? "wall" : "floor", entities: [] })
    }
    tiles.push(row)
  }
  return { id: "test_room", width, height, tiles }
}

describe("computeVisibleTiles", () => {
  it("always includes the player's own tile", () => {
    const room = makeOpenRoom(7, 7)
    const visible = computeVisibleTiles(room, { x: 3, y: 3 }, 3)
    expect(visible.has(tileKey({ x: 3, y: 3 }))).toBe(true)
  })

  it("reveals tiles within radius in an open room", () => {
    const room = makeOpenRoom(9, 9)
    const visible = computeVisibleTiles(room, { x: 4, y: 4 }, 3)
    // Adjacent tiles must be visible
    expect(visible.has(tileKey({ x: 4, y: 3 }))).toBe(true)
    expect(visible.has(tileKey({ x: 4, y: 5 }))).toBe(true)
    expect(visible.has(tileKey({ x: 3, y: 4 }))).toBe(true)
    expect(visible.has(tileKey({ x: 5, y: 4 }))).toBe(true)
  })

  it("walls block vision beyond them", () => {
    // Create a room with a wall in the middle
    const room = makeOpenRoom(9, 9)
    // Add a vertical wall at x=5
    for (let y = 1; y < 8; y++) {
      room.tiles[y]![5] = { x: 5, y, type: "wall", entities: [] }
    }
    const visible = computeVisibleTiles(room, { x: 3, y: 4 }, 6)
    // x=7 should NOT be visible (behind wall at x=5)
    expect(visible.has(tileKey({ x: 7, y: 4 }))).toBe(false)
  })

  it("returns more tiles with larger radius", () => {
    const room = makeOpenRoom(15, 15)
    const small = computeVisibleTiles(room, { x: 7, y: 7 }, 2)
    const large = computeVisibleTiles(room, { x: 7, y: 7 }, 5)
    expect(large.size).toBeGreaterThan(small.size)
  })
})

describe("hasLineOfSight", () => {
  it("returns true in an open room", () => {
    const room = makeOpenRoom(7, 7)
    expect(hasLineOfSight(room, { x: 1, y: 1 }, { x: 5, y: 5 })).toBe(true)
  })

  it("returns false when wall is between positions", () => {
    const room = makeOpenRoom(9, 9)
    // Vertical wall at x=5
    for (let y = 1; y < 8; y++) {
      room.tiles[y]![5] = { x: 5, y, type: "wall", entities: [] }
    }
    expect(hasLineOfSight(room, { x: 3, y: 4 }, { x: 7, y: 4 })).toBe(false)
  })
})

describe("mergeDiscoveredTiles", () => {
  it("combines two sets without duplicates", () => {
    const existing = new Set(["1,1", "2,2"])
    const newly = new Set(["2,2", "3,3"])
    const merged = mergeDiscoveredTiles(existing, newly)
    expect(merged.size).toBe(3)
    expect(merged.has("1,1")).toBe(true)
    expect(merged.has("2,2")).toBe(true)
    expect(merged.has("3,3")).toBe(true)
  })

  it("does not mutate the original set", () => {
    const existing = new Set(["1,1"])
    mergeDiscoveredTiles(existing, new Set(["2,2"]))
    expect(existing.size).toBe(1)
  })
})
