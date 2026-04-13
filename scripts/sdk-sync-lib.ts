import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import path from "node:path"

export const HEADER_COMMENT =
  "// Vendored from @adventure-fun/schemas -- keep in sync with shared/schemas/src/index.ts"

export const TRACKED_EXPORTS = [
  "Stats",
  "CharacterStats",
  "StatusEffectType",
  "StatusEffect",
  "ActiveEffect",
  "AbilitySummary",
  "ItemType",
  "ItemRarity",
  "EquipSlot",
  "OwnerType",
  "InventoryItem",
  "InventorySlot",
  "PlayerType",
  "CharacterClass",
  "ResourceType",
  "KnownMapData",
  "KnownFloor",
  "EntityType",
  "Entity",
  "GameEvent",
  "Action",
  "ServerMessage",
  "ClientMessage",
  "TileType",
  "Tile",
  "Observation",
  "PerkTemplate",
  "EnemyBehavior",
  "LobbyEvent",
  "SanitizedChatMessage",
  "PaymentAcceptOption402",
  "PaymentRequired402",
] as const

export type TrackedExportName = (typeof TRACKED_EXPORTS)[number]

export interface SyncManifestEntry {
  canonical: string
  vendored: string
  canonicalHash: string
  generatedHash: string
  types: TrackedExportName[]
  typeHashes: Record<string, string>
  notes: string
}

export interface EngineWatchEntry {
  file: string
  hash: string
  affectedModules: string[]
}

export interface DevEngineWatchEntry {
  source: string
  vendored: string
  sourceHash: string
  vendoredHash: string
  affectedModules: string[]
}

export interface SyncManifest {
  version: number
  lastSync: string
  sources: [SyncManifestEntry]
  engineWatchlist?: EngineWatchEntry[]
  devEngineWatchlist?: DevEngineWatchEntry[]
}

/**
 * Engine files that affect SDK module behavior.
 * When these change, the affected SDK modules should be reviewed.
 */
export const ENGINE_WATCHLIST: Array<{
  file: string
  affectedModules: string[]
}> = [
  { file: "shared/engine/src/turn.ts", affectedModules: ["combat", "exploration", "inventory", "trap-handling", "portal", "healing"] },
  { file: "shared/engine/src/combat.ts", affectedModules: ["combat", "healing"] },
  { file: "shared/engine/src/visibility.ts", affectedModules: ["exploration", "combat"] },
  { file: "shared/engine/src/realm.ts", affectedModules: ["exploration", "portal"] },
  { file: "shared/engine/src/leveling.ts", affectedModules: ["portal"] },
  { file: "backend/src/auth/jwt.ts", affectedModules: ["dev-stack", "auth", "agent-lifecycle"] },
  { file: "backend/src/game/action-validator.ts", affectedModules: ["dev-stack"] },
  { file: "backend/src/game/session.ts", affectedModules: ["agent-lifecycle", "chat"] },
  { file: "backend/src/routes/auth.ts", affectedModules: ["dev-stack", "auth", "agent-lifecycle"] },
  { file: "backend/src/routes/characters.ts", affectedModules: ["dev-stack", "agent-lifecycle"] },
  { file: "backend/src/routes/realms.ts", affectedModules: ["dev-stack", "agent-lifecycle"] },
  { file: "backend/src/routes/content.ts", affectedModules: ["dev-stack"] },
  { file: "backend/src/index.ts", affectedModules: ["dev-stack", "chat"] },
  { file: "backend/src/payments/x402.ts", affectedModules: ["wallet-adapters", "x402-payment"] },
  { file: "backend/src/auth/wallet.ts", affectedModules: ["wallet-adapters", "auth"] },
  { file: "backend/src/routes/lobby.ts", affectedModules: ["chat"] },
  { file: "backend/src/game/lobby-live.ts", affectedModules: ["chat"] },
  { file: "backend/src/redis/publishers.ts", affectedModules: ["chat"] },
  { file: "agent-sdk/src/adapters/llm/shared.ts", affectedModules: ["llm-adapters"] },
]

export const DEV_ENGINE_WATCHLIST: Array<{
  source: string
  vendored: string
  affectedModules: string[]
}> = [
  { source: "shared/schemas/src/index.ts", vendored: "agent-sdk/dev/engine/types.ts", affectedModules: ["dev-stack"] },
  { source: "shared/engine/src/rng.ts", vendored: "agent-sdk/dev/engine/rng.ts", affectedModules: ["dev-stack"] },
  { source: "shared/engine/src/combat.ts", vendored: "agent-sdk/dev/engine/combat.ts", affectedModules: ["dev-stack"] },
  { source: "shared/engine/src/visibility.ts", vendored: "agent-sdk/dev/engine/visibility.ts", affectedModules: ["dev-stack"] },
  { source: "shared/engine/src/realm.ts", vendored: "agent-sdk/dev/engine/realm.ts", affectedModules: ["dev-stack"] },
  { source: "shared/engine/src/turn.ts", vendored: "agent-sdk/dev/engine/turn.ts", affectedModules: ["dev-stack"] },
  { source: "shared/engine/src/leveling.ts", vendored: "agent-sdk/dev/engine/leveling.ts", affectedModules: ["dev-stack"] },
  { source: "scripts/sync-dev-engine.ts", vendored: "agent-sdk/dev/engine/content.ts", affectedModules: ["dev-stack"] },
  { source: "scripts/sync-dev-engine.ts", vendored: "agent-sdk/dev/engine/index.ts", affectedModules: ["dev-stack"] },
]

interface ExportBlock {
  name: string
  start: number
  end: number
  content: string
}

const currentFile = fileURLToPath(import.meta.url)
export const ROOT_DIR = path.resolve(path.dirname(currentFile), "..")
export const CANONICAL_FILE = path.join(ROOT_DIR, "shared/schemas/src/index.ts")
export const VENDORED_FILE = path.join(ROOT_DIR, "agent-sdk/src/protocol.ts")
export const MANIFEST_FILE = path.join(ROOT_DIR, "agent-sdk/.sync-manifest.json")

const EXPORT_PATTERN =
  /^export\s+(?:const|function|interface|type)\s+([A-Za-z0-9_]+)/gm

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

export function getTodayStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd()
}

export function parseExportBlocks(source: string): Map<string, ExportBlock> {
  const blocks = new Map<string, ExportBlock>()
  const matches = Array.from(source.matchAll(EXPORT_PATTERN))

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    if (match?.index === undefined) {
      continue
    }

    const name = match[1]
    if (!name) {
      continue
    }

    const start = match.index
    const nextStart = matches[index + 1]?.index ?? source.length
    const content = source.slice(start, nextStart).trim()
    blocks.set(name, { name, start, end: nextStart, content })
  }

  return blocks
}

export function getTrackedBlocks(source: string): ExportBlock[] {
  const blocks = parseExportBlocks(source)
  const tracked = TRACKED_EXPORTS.map((name) => {
    const block = blocks.get(name)
    if (!block) {
      throw new Error(`Missing tracked export "${name}" in canonical schemas`)
    }
    return block
  })

  tracked.sort((left, right) => left.start - right.start)
  return tracked
}

export function buildTypeHashes(source: string): Record<string, string> {
  return Object.fromEntries(
    getTrackedBlocks(source).map((block) => [block.name, sha256(normalizeContent(block.content))]),
  )
}

export function generateVendoredProtocol(canonicalSource: string): string {
  const blocks = getTrackedBlocks(canonicalSource)

  const sections = [
    HEADER_COMMENT,
    "",
    'export type Direction = "up" | "down" | "left" | "right"',
    "",
    ...blocks.flatMap((block) => [block.content, ""]),
    "export type EquippedItem = InventoryItem",
    "export type VisibleEntity = Entity",
    "export type RealmEvent = GameEvent",
    "export type TileInfo = Tile",
    'export type CharacterObservation = Observation["character"]',
    'export type RealmInfo = Observation["realm_info"]',
  ]

  return `${sections.join("\n").trimEnd()}\n`
}

export function buildManifest(
  canonicalSource: string,
  engineFileContents?: Map<string, string>,
  devEngineFileContents?: Map<string, string>,
): SyncManifest {
  const generated = generateVendoredProtocol(canonicalSource)

  const manifest: SyncManifest = {
    version: 1,
    lastSync: getTodayStamp(),
    sources: [
      {
        canonical: "shared/schemas/src/index.ts",
        vendored: "agent-sdk/src/protocol.ts",
        canonicalHash: sha256(normalizeContent(canonicalSource)),
        generatedHash: sha256(normalizeContent(generated)),
        types: [...TRACKED_EXPORTS],
        typeHashes: buildTypeHashes(canonicalSource),
        notes:
          "Generated from the canonical schemas file. Custom aliases (Direction, EquippedItem, VisibleEntity, RealmEvent, TileInfo, CharacterObservation, RealmInfo) are appended for SDK ergonomics.",
      },
    ],
  }

  if (engineFileContents) {
    manifest.engineWatchlist = ENGINE_WATCHLIST.map((entry) => ({
      file: entry.file,
      hash: sha256(normalizeContent(engineFileContents.get(entry.file) ?? "")),
      affectedModules: entry.affectedModules,
    }))
  }

  if (devEngineFileContents) {
    manifest.devEngineWatchlist = DEV_ENGINE_WATCHLIST.map((entry) => ({
      source: entry.source,
      vendored: entry.vendored,
      sourceHash: sha256(normalizeContent(devEngineFileContents.get(entry.source) ?? "")),
      vendoredHash: sha256(normalizeContent(devEngineFileContents.get(entry.vendored) ?? "")),
      affectedModules: entry.affectedModules,
    }))
  }

  return manifest
}

export function findChangedEngineFiles(
  previousWatchlist: EngineWatchEntry[],
  currentWatchlist: EngineWatchEntry[],
): EngineWatchEntry[] {
  return currentWatchlist.filter((current) => {
    const previous = previousWatchlist.find((p) => p.file === current.file)
    return !previous || previous.hash !== current.hash
  })
}

export function findChangedDevEngineFiles(
  previousWatchlist: DevEngineWatchEntry[],
  currentWatchlist: DevEngineWatchEntry[],
): DevEngineWatchEntry[] {
  return currentWatchlist.filter((current) => {
    const previous = previousWatchlist.find(
      (entry) => entry.source === current.source && entry.vendored === current.vendored,
    )
    return (
      !previous
      || previous.sourceHash !== current.sourceHash
      || previous.vendoredHash !== current.vendoredHash
    )
  })
}

export function findChangedTypes(
  previousHashes: Record<string, string>,
  nextHashes: Record<string, string>,
): string[] {
  return TRACKED_EXPORTS.filter((name) => previousHashes[name] !== nextHashes[name])
}

export function summarizeFirstDiff(expected: string, actual: string): string | null {
  const expectedLines = normalizeContent(expected).split("\n")
  const actualLines = normalizeContent(actual).split("\n")
  const maxLineCount = Math.max(expectedLines.length, actualLines.length)

  for (let index = 0; index < maxLineCount; index += 1) {
    const expectedLine = expectedLines[index]
    const actualLine = actualLines[index]
    if (expectedLine !== actualLine) {
      const lineNumber = index + 1
      return [
        `First differing line: ${lineNumber}`,
        `Expected: ${expectedLine ?? "<missing>"}`,
        `Actual:   ${actualLine ?? "<missing>"}`,
      ].join("\n")
    }
  }

  return null
}
