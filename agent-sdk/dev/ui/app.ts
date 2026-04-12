import type {
  Action,
  Entity,
  GameEvent,
  InventoryItem,
  InventorySlot,
  Observation,
  SpectatableSessionSummary,
  SpectatorEntity,
  SpectatorObservation,
  Tile,
} from "../engine/index.js"

type ViewerMode = "spectate" | "debug"

interface LobbyChatMessage {
  type: "lobby_chat"
  data: {
    character_name: string
    message: string
  }
}

interface LobbyActivityMessage {
  type: "lobby_activity"
  data: {
    characterName: string
    detail: string
  }
}

interface ObservationMessage {
  type: "observation"
  data: SpectatorObservation | Observation
}

interface SessionEndedMessage {
  type: "session_ended"
  reason: string
}

interface ErrorMessage {
  type: "error"
  message: string
}

type LobbyMessage = LobbyChatMessage | LobbyActivityMessage | { type: "connected"; channel: "lobby" }
type ViewerMessage = ObservationMessage | SessionEndedMessage | ErrorMessage

const statusEl = document.getElementById("status")
const viewerTitleEl = document.getElementById("viewerTitle")
const modeHelpEl = document.getElementById("modeHelp")
const modeSelectEl = document.getElementById("modeSelect") as HTMLSelectElement | null
const sessionSelectEl = document.getElementById("sessionSelect") as HTMLSelectElement | null
const refreshButtonEl = document.getElementById("refreshButton") as HTMLButtonElement | null
const roomTextEl = document.getElementById("roomText")
const asciiMapEl = document.getElementById("asciiMap")
const entitiesEl = document.getElementById("entities") as HTMLUListElement | null
const eventsEl = document.getElementById("events") as HTMLUListElement | null
const chatLogEl = document.getElementById("chatLog") as HTMLUListElement | null
const characterMetaEl = document.getElementById("characterMeta")
const realmMetaEl = document.getElementById("realmMeta")
const positionMetaEl = document.getElementById("positionMeta")
const hpMetaEl = document.getElementById("hpMeta")
const resourceMetaEl = document.getElementById("resourceMeta")
const turnMetaEl = document.getElementById("turnMeta")
const goldMetaEl = document.getElementById("goldMeta")
const xpMetaEl = document.getElementById("xpMeta")
const lastActionEl = document.getElementById("lastAction")
const reasoningEl = document.getElementById("reasoning")
const debugPanelsEl = document.getElementById("debugPanels")
const inventoryListEl = document.getElementById("inventoryList") as HTMLUListElement | null
const equipmentListEl = document.getElementById("equipmentList") as HTMLUListElement | null
const legalActionsEl = document.getElementById("legalActions") as HTMLUListElement | null
const effectsListEl = document.getElementById("effectsList") as HTMLUListElement | null

let currentMode: ViewerMode = getRequestedMode()
let gameSocket: WebSocket | null = null
let lobbySocket: WebSocket | null = null
let selectedCharacterId = ""

function getRequestedMode(): ViewerMode {
  const raw = new URL(window.location.href).searchParams.get("mode")
  return raw === "debug" ? "debug" : "spectate"
}

function isDebugObservation(observation: SpectatorObservation | Observation): observation is Observation {
  return "legal_actions" in observation
}

function getBaseHttpUrl() {
  const queryValue = new URL(window.location.href).searchParams.get("api")
  if (queryValue) return queryValue.replace(/\/$/, "")
  return `${window.location.protocol}//${window.location.hostname}:3001`
}

function getBaseWsUrl() {
  const httpUrl = getBaseHttpUrl()
  return httpUrl.replace(/^http/, "ws")
}

function getActiveSessionsPath(): string {
  return currentMode === "debug" ? "/debug/active" : "/spectate/active"
}

function getSessionSocketPath(characterId: string): string {
  return currentMode === "debug" ? `/debug/${characterId}` : `/spectate/${characterId}`
}

function setStatus(message: string) {
  if (statusEl) {
    statusEl.textContent = message
  }
}

function renderList(target: HTMLUListElement | null, values: string[]) {
  if (!target) return
  target.innerHTML = ""
  for (const value of values) {
    const item = document.createElement("li")
    item.textContent = value
    target.appendChild(item)
  }
}

function updateModeUi() {
  if (modeSelectEl) {
    modeSelectEl.value = currentMode
  }
  if (viewerTitleEl) {
    viewerTitleEl.textContent = currentMode === "debug" ? "Agent SDK Debug Inspector" : "Agent SDK Spectator"
  }
  if (modeHelpEl) {
    modeHelpEl.textContent = currentMode === "debug"
      ? "Debug mode streams the full local player observation for agent testing."
      : "Spectator mode shows the redacted public view."
  }
  if (debugPanelsEl) {
    debugPanelsEl.hidden = currentMode !== "debug"
  }
}

function syncModeQuery() {
  const url = new URL(window.location.href)
  url.searchParams.set("mode", currentMode)
  window.history.replaceState({}, "", url)
}

function formatModifiers(modifiers: Record<string, number> | undefined): string {
  if (!modifiers) return ""
  const entries = Object.entries(modifiers).filter(([, value]) => value !== 0)
  if (entries.length === 0) return ""
  return ` (${entries.map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`).join(", ")})`
}

function describeEntity(entity: SpectatorEntity | Entity): string {
  const position = `@ (${entity.position.x}, ${entity.position.y})`
  if ("health_indicator" in entity && entity.health_indicator) {
    return `${entity.type}: ${entity.name} ${position} [${entity.health_indicator}]`
  }
  const hp = "hp_current" in entity && "hp_max" in entity
    && typeof entity.hp_current === "number" && typeof entity.hp_max === "number"
    ? ` [${entity.hp_current}/${entity.hp_max} hp]`
    : ""
  const trapped = "trapped" in entity && entity.trapped ? " [trapped]" : ""
  const boss = entity.is_boss ? " [boss]" : ""
  return `${entity.type}: ${entity.name} ${position}${hp}${boss}${trapped}`
}

function renderMap(observation: SpectatorObservation | Observation) {
  if (!asciiMapEl) return
  const visibleTiles = observation.visible_tiles ?? []
  const knownTiles = observation.known_map?.floors?.[observation.position.floor]?.tiles ?? []
  const allTiles = [...visibleTiles, ...knownTiles]
  if (allTiles.length === 0) {
    asciiMapEl.textContent = "No visible tiles."
    return
  }

  const xs = allTiles.map((tile: Tile) => tile.x)
  const ys = allTiles.map((tile: Tile) => tile.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const visibleMap = new Map(visibleTiles.map((tile: Tile) => [`${tile.x},${tile.y}`, tile] as const))
  const knownMap = new Map(knownTiles.map((tile: Tile) => [`${tile.x},${tile.y}`, tile] as const))
  const entityMap = new Map(
    (observation.visible_entities ?? []).map((entity) => [`${entity.position.x},${entity.position.y}`, entity] as const),
  )

  asciiMapEl.innerHTML = ""
  for (let y = minY; y <= maxY; y += 1) {
    const rowEl = document.createElement("div")
    rowEl.className = "map-row"
    for (let x = minX; x <= maxX; x += 1) {
      const cellEl = document.createElement("span")
      if (observation.position.tile.x === x && observation.position.tile.y === y) {
        cellEl.textContent = "@"
        cellEl.className = "map-player"
        rowEl.appendChild(cellEl)
        continue
      }

      const key = `${x},${y}` as `${number},${number}`
      const visibleTile = visibleMap.get(key)
      const knownTile = knownMap.get(key)
      const entity = entityMap.get(key)

      if (entity && visibleTile) {
        const rendered = entityToCell(entity)
        cellEl.textContent = rendered.char
        cellEl.className = rendered.className
        rowEl.appendChild(cellEl)
        continue
      }

      if (visibleTile) {
        const rendered = tileToCell(visibleTile, false)
        cellEl.textContent = rendered.char
        cellEl.className = rendered.className
        rowEl.appendChild(cellEl)
        continue
      }

      if (knownTile) {
        const rendered = tileToCell(knownTile, true)
        cellEl.textContent = rendered.char
        cellEl.className = rendered.className
        rowEl.appendChild(cellEl)
        continue
      }

      cellEl.textContent = " "
      cellEl.className = "map-fog"
      rowEl.appendChild(cellEl)
    }
    asciiMapEl.appendChild(rowEl)
  }
}

function tileToCell(tile: Tile, dimmed: boolean): { char: string; className: string } {
  const suffix = dimmed ? " map-dim" : ""
  switch (tile.type) {
    case "wall":
      return { char: "#", className: `map-wall${suffix}` }
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

function entityToCell(entity: SpectatorEntity | Entity): { char: string; className: string } {
  switch (entity.type) {
    case "enemy":
      return {
        char: entity.is_boss || entity.name.toLowerCase().includes("boss") ? "B" : "E",
        className: entity.is_boss || entity.name.toLowerCase().includes("boss") ? "map-boss" : "map-enemy",
      }
    case "item":
      return { char: "?", className: "map-item" }
    case "interactable":
      return { char: "!", className: "map-interactable" }
    case "trap_visible":
      return { char: "^", className: "map-trap" }
    default:
      return { char: "?", className: "map-item" }
  }
}

function formatAction(action: Action): string {
  switch (action.type) {
    case "move":
      return `move ${action.direction}`
    case "attack":
      return `attack ${action.target_id}${action.ability_id ? ` via ${action.ability_id}` : ""}`
    case "disarm_trap":
      return `disarm trap ${action.item_id}`
    case "use_item":
      return `use item ${action.item_id}${action.target_id ? ` on ${action.target_id}` : ""}`
    case "equip":
      return `equip ${action.item_id}`
    case "unequip":
      return `unequip ${action.slot}`
    case "inspect":
      return `inspect ${action.target_id}`
    case "interact":
      return `interact ${action.target_id}`
    case "pickup":
      return `pickup ${action.item_id}`
    case "drop":
      return `drop ${action.item_id}`
    case "use_portal":
      return "use portal"
    case "retreat":
      return "retreat"
    case "wait":
      return "wait"
    default:
      return JSON.stringify(action)
  }
}

function formatInventoryItem(item: InventorySlot | InventoryItem, isNew = false): string {
  const quantity = item.quantity > 1 ? ` x${item.quantity}` : ""
  const newTag = isNew ? " [new]" : ""
  return `${item.name}${quantity}${formatModifiers(item.modifiers)}${newTag}`
}

function renderDebugPanels(observation: SpectatorObservation | Observation) {
  if (!isDebugObservation(observation)) {
    renderList(inventoryListEl, ["Available in debug mode only."])
    renderList(equipmentListEl, ["Available in debug mode only."])
    renderList(legalActionsEl, ["Available in debug mode only."])
    renderList(effectsListEl, ["Available in debug mode only."])
    return
  }

  const newItemIds = new Set(observation.new_item_ids ?? [])
  renderList(
    inventoryListEl,
    observation.inventory.length > 0
      ? observation.inventory.map((item) => formatInventoryItem(item, newItemIds.has(item.item_id)))
      : ["Inventory empty."],
  )

  renderList(
    equipmentListEl,
    Object.entries(observation.equipment).map(([slot, item]) =>
      item ? `${slot}: ${formatInventoryItem(item)}` : `${slot}: empty`,
    ),
  )

  renderList(
    legalActionsEl,
    observation.legal_actions.length > 0
      ? observation.legal_actions.map(formatAction)
      : ["No legal actions available."],
  )

  const buffs = observation.character.buffs.map(
    (effect) => `buff ${effect.type} (${effect.magnitude}, ${effect.turns_remaining} turns)`,
  )
  const debuffs = observation.character.debuffs.map(
    (effect) => `debuff ${effect.type} (${effect.magnitude}, ${effect.turns_remaining} turns)`,
  )
  renderList(effectsListEl, buffs.length + debuffs.length > 0 ? [...buffs, ...debuffs] : ["No active effects."])
}

function renderObservation(observation: SpectatorObservation | Observation) {
  if (roomTextEl) {
    roomTextEl.textContent = observation.room_text ?? "No room text available."
  }

  renderMap(observation)
  renderDebugPanels(observation)

  renderList(entitiesEl, (observation.visible_entities ?? []).map(describeEntity))
  renderList(
    eventsEl,
    (observation.recent_events ?? []).map((event: GameEvent) => `${event.type}: ${event.detail}`),
  )

  if (characterMetaEl) {
    characterMetaEl.textContent = `Character: ${observation.character.class} lvl ${observation.character.level}`
  }
  if (realmMetaEl) {
    realmMetaEl.textContent = `Realm: ${observation.realm_info.template_name} [${observation.realm_info.status}]`
  }
  if (positionMetaEl) {
    positionMetaEl.textContent = `Position: f${observation.position.floor} ${observation.position.room_id} (${observation.position.tile.x}, ${observation.position.tile.y})`
  }
  if (hpMetaEl) {
    hpMetaEl.textContent = `HP: ${isDebugObservation(observation)
      ? `${observation.character.hp.current}/${observation.character.hp.max}`
      : `${observation.character.hp_percent}%`}`
  }
  if (resourceMetaEl) {
    resourceMetaEl.textContent = `Resource: ${isDebugObservation(observation)
      ? `${observation.character.resource.current}/${observation.character.resource.max} ${observation.character.resource.type}`
      : `${observation.character.resource_percent}%`}`
  }
  if (turnMetaEl) {
    turnMetaEl.textContent = `Turn: ${observation.turn}`
  }
  if (goldMetaEl) {
    goldMetaEl.textContent = `Gold: ${isDebugObservation(observation) ? observation.gold : "hidden"}`
  }
  if (xpMetaEl) {
    xpMetaEl.textContent = `XP: ${isDebugObservation(observation)
      ? `${observation.character.xp} (${observation.character.skill_points} skill pts)`
      : "hidden"}`
  }

  const lastEvent = observation.recent_events?.[observation.recent_events.length - 1]
  if (lastActionEl) {
    lastActionEl.textContent = lastEvent ? `${lastEvent.type}` : "No action observed yet."
  }
  if (reasoningEl) {
    reasoningEl.textContent = lastEvent
      ? lastEvent.detail
      : currentMode === "debug"
        ? "Inspecting raw player observation from the local dev stack."
        : "Reasoning is inferred from the most recent event in the engine-only dev stack."
  }
}

function connectLobby() {
  if (lobbySocket) {
    lobbySocket.close()
  }

  lobbySocket = new WebSocket(`${getBaseWsUrl()}/lobby/live`)
  lobbySocket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as LobbyMessage
    if (message.type === "lobby_chat") {
      const li = document.createElement("li")
      li.textContent = `[${message.data.character_name}] ${message.data.message}`
      chatLogEl?.appendChild(li)
      chatLogEl?.parentElement?.scrollTo({ top: chatLogEl.parentElement.scrollHeight })
    }
    if (message.type === "lobby_activity") {
      const li = document.createElement("li")
      li.textContent = `[lobby] ${message.data.characterName}: ${message.data.detail}`
      eventsEl?.appendChild(li)
    }
  }
}

function connectViewer(characterId: string) {
  selectedCharacterId = characterId
  if (gameSocket) {
    gameSocket.close()
  }

  if (!characterId) {
    setStatus("No active sessions.")
    return
  }

  const verb = currentMode === "debug" ? "Inspecting" : "Watching"
  setStatus(`${verb} ${characterId}...`)
  gameSocket = new WebSocket(`${getBaseWsUrl()}${getSessionSocketPath(characterId)}`)
  gameSocket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as ViewerMessage
    if (message.type === "observation") {
      renderObservation(message.data)
      setStatus(`${verb} ${characterId}`)
    } else if (message.type === "session_ended") {
      setStatus(`Session ended: ${message.reason}`)
    } else if (message.type === "error") {
      setStatus(message.message)
    }
  }
  gameSocket.onclose = () => {
    setStatus(`${currentMode === "debug" ? "Debug" : "Spectator"} socket closed.`)
  }
}

async function refreshSessions() {
  const response = await fetch(`${getBaseHttpUrl()}${getActiveSessionsPath()}`)
  const payload = await response.json() as { sessions?: SpectatableSessionSummary[] }
  const sessions = payload.sessions ?? []

  if (!sessionSelectEl) return
  sessionSelectEl.innerHTML = ""

  for (const session of sessions) {
    const option = document.createElement("option")
    option.value = session.character_id
    option.textContent = `${session.character_id.slice(0, 8)} | ${session.realm_info.template_name} | turn ${session.turn}`
    sessionSelectEl.appendChild(option)
  }

  const requestedCharacterId = new URL(window.location.href).searchParams.get("characterId")
  const preferredCharacterId = requestedCharacterId || selectedCharacterId || sessions[0]?.character_id || ""
  if (preferredCharacterId) {
    sessionSelectEl.value = preferredCharacterId
    connectViewer(preferredCharacterId)
  } else {
    setStatus("No active sessions.")
  }
}

modeSelectEl?.addEventListener("change", () => {
  currentMode = modeSelectEl.value === "debug" ? "debug" : "spectate"
  updateModeUi()
  syncModeQuery()
  void refreshSessions()
})

sessionSelectEl?.addEventListener("change", () => {
  connectViewer(sessionSelectEl.value)
})

refreshButtonEl?.addEventListener("click", () => {
  void refreshSessions()
})

updateModeUi()
syncModeQuery()
connectLobby()
void refreshSessions()
setInterval(() => {
  void refreshSessions()
}, 10_000)
