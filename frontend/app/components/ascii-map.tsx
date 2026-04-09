import type { Tile, Entity, SpectatorEntity } from "@adventure-fun/schemas"

interface AsciiMapProps {
  visibleTiles: Tile[]
  playerPosition: { x: number; y: number }
  entities: (Entity | SpectatorEntity)[]
}

export function AsciiMap({ visibleTiles, playerPosition, entities }: AsciiMapProps) {
  if (visibleTiles.length === 0) {
    return <pre className="text-xs leading-none font-mono text-gray-600">No map data</pre>
  }

  const rows = renderMap(visibleTiles, playerPosition, entities)

  return (
    <pre className="text-xs leading-tight font-mono select-none">
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
  tiles: Tile[],
  playerPos: { x: number; y: number },
  entities: (Entity | SpectatorEntity)[],
): Cell[][] {
  const xs = tiles.map((t) => t.x)
  const ys = tiles.map((t) => t.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const tileMap = new Map(tiles.map((t) => [`${t.x},${t.y}`, t]))
  const entityMap = new Map(entities.map((e) => [`${e.position.x},${e.position.y}`, e]))

  const rows: Cell[][] = []
  for (let y = minY; y <= maxY; y++) {
    const row: Cell[] = []
    for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`

      if (x === playerPos.x && y === playerPos.y) {
        row.push({ char: "@", className: "map-player" })
      } else if (entityMap.has(key)) {
        const entity = entityMap.get(key)!
        if (entity.type === "enemy") {
          row.push({
            char: entity.is_boss ? "B" : "E",
            className: entity.is_boss ? "map-boss" : "map-enemy",
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
      } else {
        const tile = tileMap.get(key)
        if (!tile) {
          row.push({ char: " ", className: "map-fog" })
        } else {
          switch (tile.type) {
            case "wall":
              row.push({ char: "#", className: "map-wall" })
              break
            case "floor":
              row.push({ char: ".", className: "map-floor" })
              break
            case "door":
              row.push({ char: "D", className: "map-door" })
              break
            case "stairs":
              row.push({ char: ">", className: "map-stairs" })
              break
            case "entrance":
              row.push({ char: "<", className: "map-stairs" })
              break
            default:
              row.push({ char: ".", className: "map-floor" })
          }
        }
      }
    }
    rows.push(row)
  }
  return rows
}
