import type { ServerWebSocket } from "bun"
import { CLASSES, REALMS, getItem, type Account, type Character, type CharacterClass, type EquipSlot, type InventoryItem, type PlayerType, type RealmInstance, type SanitizedChatMessage, type SpectatableSessionSummary, type SpectatorObservation } from "../engine/index.js"

export interface SessionPayload {
  account_id: string
  wallet_address: string
  player_type: "human" | "agent"
}

export interface DevCharacter extends Omit<Character, "skill_tree"> {
  skill_tree: Record<string, boolean>
  inventory: InventoryItem[]
  equipment: Record<EquipSlot, InventoryItem | null>
}

export interface ActiveSessionHandle {
  characterId: string
  realmId: string
  getSpectatorObservation(): SpectatorObservation
  addSpectator(ws: ServerWebSocket<SpectatorSocketData>): void
  removeSpectator(ws: ServerWebSocket<SpectatorSocketData>): void
  processAction(rawAction: unknown): Promise<void>
  close(reason: "disconnect" | "death" | "extracted"): Promise<void>
}

export interface PlayerSocketData {
  role: "player"
  realmId: string
  session: SessionPayload
  characterId: string
  turnTimer?: ReturnType<typeof setTimeout>
}

export interface SpectatorSocketData {
  role: "spectator"
  characterId: string
}

export interface LobbySocketData {
  role: "lobby"
}

export type SocketSessionData = PlayerSocketData | SpectatorSocketData | LobbySocketData

const accountsByCompositeKey = new Map<string, Account>()
const charactersByAccountId = new Map<string, DevCharacter>()
const realmsById = new Map<string, RealmInstance>()
const realmIdsByCharacterId = new Map<string, string[]>()
const activeSessions = new Map<string, ActiveSessionHandle>()
const lobbyClients = new Set<ServerWebSocket<LobbySocketData>>()
const chatRateLimitByCharacterId = new Map<string, number>()
const lobbyMessages: SanitizedChatMessage[] = []

const EQUIP_SLOTS: EquipSlot[] = ["weapon", "armor", "helm", "hands", "accessory"]

function createEmptyEquipment(): Record<EquipSlot, InventoryItem | null> {
  return {
    weapon: null,
    armor: null,
    helm: null,
    hands: null,
    accessory: null,
  }
}

function compositeAccountKey(walletAddress: string, playerType: PlayerType): string {
  return `${walletAddress.toLowerCase()}:${playerType}`
}

function rollInRange([min, max]: [number, number]): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function rollStats(characterClass: CharacterClass): Character["stats"] {
  const classTemplate = CLASSES[characterClass]
  if (!classTemplate) {
    throw new Error(`Unknown class: ${characterClass}`)
  }
  const ranges = classTemplate.stat_roll_ranges
  return {
    hp: rollInRange(ranges.hp!),
    attack: rollInRange(ranges.attack!),
    defense: rollInRange(ranges.defense!),
    accuracy: rollInRange(ranges.accuracy!),
    evasion: rollInRange(ranges.evasion!),
    speed: rollInRange(ranges.speed!),
  }
}

function createInventoryItem(templateId: string, ownerId: string, quantity = 1): InventoryItem {
  const template = getItem(templateId)
  return {
    id: crypto.randomUUID(),
    template_id: template.id,
    name: template.name,
    quantity,
    modifiers: { ...(template.stats ?? {}) },
    owner_type: "character",
    owner_id: ownerId,
    slot: null,
  }
}

export function upsertAccount(walletAddress: string, playerType: PlayerType): Account {
  const key = compositeAccountKey(walletAddress, playerType)
  const existing = accountsByCompositeKey.get(key)
  if (existing) {
    return existing
  }

  const account: Account = {
    id: crypto.randomUUID(),
    wallet_address: walletAddress.toLowerCase(),
    player_type: playerType,
    free_realm_used: false,
    created_at: new Date().toISOString(),
  }
  accountsByCompositeKey.set(key, account)
  return account
}

export function getAccountBySession(session: SessionPayload): Account | null {
  const key = compositeAccountKey(session.wallet_address, session.player_type)
  return accountsByCompositeKey.get(key) ?? null
}

export function updateAccountProfile(
  session: SessionPayload,
  input: {
    handle?: string
    x_handle?: string
    github_handle?: string
  },
): Account | null {
  const key = compositeAccountKey(session.wallet_address, session.player_type)
  const existing = accountsByCompositeKey.get(key)
  if (!existing) {
    return null
  }

  const updated: Account = {
    ...existing,
    ...(input.handle !== undefined ? { handle: input.handle } : {}),
    ...(input.x_handle !== undefined ? { x_handle: input.x_handle } : {}),
    ...(input.github_handle !== undefined ? { github_handle: input.github_handle } : {}),
  }

  accountsByCompositeKey.set(key, updated)
  return updated
}

export function getCharacterByAccountId(accountId: string): DevCharacter | null {
  return charactersByAccountId.get(accountId) ?? null
}

export function createCharacter(accountId: string, characterClass: CharacterClass, name: string): DevCharacter {
  const existing = charactersByAccountId.get(accountId)
  if (existing?.status === "alive") {
    throw new Error("You already have a living character. They must die first.")
  }

  const classTemplate = CLASSES[characterClass]
  if (!classTemplate) {
    throw new Error(`Unknown class: ${characterClass}`)
  }
  const stats = rollStats(characterClass)
  const characterId = crypto.randomUUID()
  const equipment = createEmptyEquipment()
  const inventory: InventoryItem[] = []

  for (const templateId of classTemplate.starting_equipment ?? []) {
    const item = createInventoryItem(templateId, characterId)
    const template = getItem(templateId)
    const equipSlot = template.equip_slot
    if (equipSlot && EQUIP_SLOTS.includes(equipSlot)) {
      const resolvedSlot = equipSlot as EquipSlot
      if (!equipment[resolvedSlot]) {
        equipment[resolvedSlot] = { ...item, slot: resolvedSlot }
        continue
      }
    }
    inventory.push(item)
  }

  const character: DevCharacter = {
    id: characterId,
    account_id: accountId,
    name: name.trim(),
    class: characterClass,
    level: 1,
    xp: 0,
    gold: 0,
    hp_current: stats.hp,
    hp_max: stats.hp,
    resource_current: classTemplate.resource_max,
    resource_max: classTemplate.resource_max,
    resource_type: classTemplate.resource_type,
    stats,
    effective_stats: { ...stats },
    skill_tree: {},
    status: "alive",
    stat_rerolled: false,
    lore_discovered: [],
    created_at: new Date().toISOString(),
    inventory,
    equipment,
  }

  charactersByAccountId.set(accountId, character)
  return character
}

export function listRealmsForCharacter(characterId: string): RealmInstance[] {
  return (realmIdsByCharacterId.get(characterId) ?? [])
    .map((realmId) => realmsById.get(realmId))
    .filter((realm): realm is RealmInstance => realm != null)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export function createRealm(characterId: string, templateId: string): RealmInstance {
  const template = REALMS[templateId]
  if (!template) {
    throw new Error(`Unknown realm template: ${templateId}`)
  }

  const realm: RealmInstance = {
    id: crypto.randomUUID(),
    character_id: characterId,
    template_id: template.id,
    template_version: template.version,
    seed: Math.floor(Math.random() * 2_147_483_647),
    status: "generated",
    floor_reached: 1,
    is_free: true,
    completions: 0,
    created_at: new Date().toISOString(),
  }

  realmsById.set(realm.id, realm)
  const realmIds = realmIdsByCharacterId.get(characterId) ?? []
  realmIds.unshift(realm.id)
  realmIdsByCharacterId.set(characterId, realmIds)
  return realm
}

export function getRealmById(realmId: string): RealmInstance | null {
  return realmsById.get(realmId) ?? null
}

export function updateRealm(realm: RealmInstance): void {
  realmsById.set(realm.id, realm)
}

export function updateCharacter(character: DevCharacter): void {
  charactersByAccountId.set(character.account_id, character)
}

export function registerActiveSession(session: ActiveSessionHandle): void {
  activeSessions.set(session.characterId, session)
}

export function unregisterActiveSession(characterId: string): void {
  activeSessions.delete(characterId)
}

export function getActiveSession(characterId: string): ActiveSessionHandle | null {
  return activeSessions.get(characterId) ?? null
}

export function listSpectatableSessions(): SpectatableSessionSummary[] {
  return Array.from(activeSessions.values()).map((session) => {
    const observation = session.getSpectatorObservation()
    return {
      character_id: session.characterId,
      turn: observation.turn,
      character: observation.character,
      realm_info: observation.realm_info,
      position: {
        floor: observation.position.floor,
        room_id: observation.position.room_id,
      },
    }
  })
}

export function addLobbyClient(ws: ServerWebSocket<LobbySocketData>): void {
  lobbyClients.add(ws)
}

export function removeLobbyClient(ws: ServerWebSocket<LobbySocketData>): void {
  lobbyClients.delete(ws)
}

export function broadcastLobbyMessage(message: Record<string, unknown>): void {
  const payload = JSON.stringify(message)
  for (const client of lobbyClients) {
    client.send(payload)
  }
}

export function getRecentLobbyMessages(): SanitizedChatMessage[] {
  return [...lobbyMessages]
}

export function appendLobbyMessage(message: SanitizedChatMessage): void {
  lobbyMessages.push(message)
  if (lobbyMessages.length > 50) {
    lobbyMessages.splice(0, lobbyMessages.length - 50)
  }
}

export function getLastChatTimestamp(characterId: string): number {
  return chatRateLimitByCharacterId.get(characterId) ?? 0
}

export function setLastChatTimestamp(characterId: string, timestamp: number): void {
  chatRateLimitByCharacterId.set(characterId, timestamp)
}
