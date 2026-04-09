import type { Tile, Entity, SpectatorEntity } from "@adventure-fun/schemas"

interface AsciiMapProps {
  visibleTiles: Tile[]
  knownTiles?: Tile[]
  playerPosition: { x: number; y: number }
  entities: (Entity | SpectatorEntity)[]
}

export function AsciiMap({ visibleTiles, knownTiles = [], playerPosition, entities }: AsciiMapProps) {
  const allTiles = [...visibleTiles, ...knownTiles]
  if (allTiles.length === 0) {
    return <pre className="text-xs leading-none font-mono text-gray-600">No map data</pre>
  }

  const rows = renderMap(visibleTiles, knownTiles, playerPosition, entities)

  return (
    <pre className="text-xs leading-tight font-mono select-none w-fit mx-auto">
      {rows.map((row, y) => (
        <div key={y}>
          {row.map((cell, x) => (
            <span key={x} className={cell.className}>
              {cell.char}
            </span>
          ))}
        </div>
      ))}
    </pre>
  )
}

interface Cell {
  char: string
  className: string
}

function renderMap(
  visibleTiles: Tile[],
  knownTiles: Tile[],
  playerPos: { x: number; y: number },
  entities: (Entity | SpectatorEntity)[],
): Cell[][] {
  const allTiles = [...visibleTiles, ...knownTiles]
  const xs = allTiles.map((t) => t.x)
  const ys = allTiles.map((t) => t.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const visibleMap = new Map(visibleTiles.map((t) => [`${t.x},${t.y}`, t]))
  const knownMap = new Map(knownTiles.map((t) => [`${t.x},${t.y}`, t]))
  const entityMap = new Map(entities.map((e) => [`${e.position.x},${e.position.y}`, e]))

  const rows: Cell[][] = []
  for (let y = minY; y <= maxY; y++) {
    const row: Cell[] = []
    for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`

      if (x === playerPos.x && y === playerPos.y) {
        row.push({ char: "@", className: "map-player" })
      } else if (entityMap.has(key) && visibleMap.has(key)) {
        const entity = entityMap.get(key)!
        const isBoss = "is_boss" in entity && entity.is_boss
        if (entity.type === "enemy") {
          row.push({
            char: isBoss ? "B" : "E",
            className: isBoss ? "map-boss" : "map-enemy",
          })
        } else if (entity.type === "item") {
          row.push({ char: "?", className: "map-chest" })
        } else if (entity.type === "interactable") {
          row.push({ char: "!", className: "map-chest" })
        } else if (entity.type === "trap_visible") {
          row.push({ char: "^", className: "map-trap" })
        } else {
          row.push({ char: "?", className: "map-chest" })
        }
      } else if (visibleMap.has(key)) {
        const tile = visibleMap.get(key)!
        row.push(tileToCell(tile, false))
      } else if (knownMap.has(key)) {
        const tile = knownMap.get(key)!
        row.push(tileToCell(tile, true))
      } else {
        row.push({ char: " ", className: "map-fog" })
      }
    }
    rows.push(row)
  }
  return rows
}

function tileToCell(tile: Tile, dimmed: boolean): Cell {
  const suffix = dimmed ? " map-dim" : ""
  switch (tile.type) {
    case "wall":
      return { char: "#", className: `map-wall${suffix}` }
    case "floor":
      return { char: ".", className: `map-floor${suffix}` }
    case "door":
      return { char: "D", className: `map-door${suffix}` }
    case "stairs":
      return { char: ">", className: `map-stairs${suffix}` }
    case "stairs_up":
      return { char: "<", className: `map-stairs${suffix}` }
    case "entrance":
      return { char: "<", className: `map-stairs${suffix}` }
    default:
      return { char: ".", className: `map-floor${suffix}` }
  }
}
