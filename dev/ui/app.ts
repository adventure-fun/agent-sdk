import type { GameEvent, SpectatableSessionSummary, SpectatorEntity, SpectatorObservation, Tile } from "../engine/index.js"

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
  data: SpectatorObservation
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
type SpectatorMessage = ObservationMessage | SessionEndedMessage | ErrorMessage

const statusEl = document.getElementById("status")
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
const lastActionEl = document.getElementById("lastAction")
const reasoningEl = document.getElementById("reasoning")

let gameSocket: WebSocket | null = null
let lobbySocket: WebSocket | null = null
let selectedCharacterId = ""

function getBaseHttpUrl() {
  const queryValue = new URL(window.location.href).searchParams.get("api")
  if (queryValue) return queryValue.replace(/\/$/, "")
  return `${window.location.protocol}//${window.location.hostname}:3001`
}

function getBaseWsUrl() {
  const httpUrl = getBaseHttpUrl()
  return httpUrl.replace(/^http/, "ws")
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

function renderMap(observation: SpectatorObservation) {
  if (!asciiMapEl) return
  const points = observation.visible_tiles ?? []
  if (points.length === 0) {
    asciiMapEl.textContent = "No visible tiles."
    return
  }

  const xs = points.map((tile: Tile) => tile.x)
  const ys = points.map((tile: Tile) => tile.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const pointMap = new Map(points.map((tile: Tile) => [`${tile.x},${tile.y}`, tile] as const))

  const rows = []
  for (let y = minY; y <= maxY; y += 1) {
    let row = ""
    for (let x = minX; x <= maxX; x += 1) {
      if (observation.position?.tile?.x === x && observation.position?.tile?.y === y) {
        row += "@"
        continue
      }

      const tile = pointMap.get(`${x},${y}`)
      if (!tile) {
        row += " "
        continue
      }

      switch (tile.type) {
        case "wall":
          row += "#"
          break
        case "door":
          row += "+"
          break
        case "stairs":
          row += ">"
          break
        case "stairs_up":
          row += "<"
          break
        case "entrance":
          row += "E"
          break
        default:
          row += "."
      }
    }
    rows.push(row)
  }

  asciiMapEl.textContent = rows.join("\n")
}

function renderObservation(observation: SpectatorObservation) {
  if (roomTextEl) {
    roomTextEl.textContent = observation.room_text ?? "No room text available."
  }

  renderMap(observation)

  renderList(
    entitiesEl,
    (observation.visible_entities ?? []).map((entity: SpectatorEntity) => {
      const health = "health_indicator" in entity && entity.health_indicator
        ? ` [${entity.health_indicator}]`
        : ""
      return `${entity.type}: ${entity.name} @ (${entity.position.x}, ${entity.position.y})${health}`
    }),
  )

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
    positionMetaEl.textContent = `Position: f${observation.position.floor} ${observation.position.room_id}`
  }
  if (hpMetaEl) {
    const hpValue = `${observation.character.hp_percent}%`
    hpMetaEl.textContent = `HP: ${hpValue}`
  }
  if (resourceMetaEl) {
    const resourceValue = `${observation.character.resource_percent}%`
    resourceMetaEl.textContent = `Resource: ${resourceValue}`
  }
  if (turnMetaEl) {
    turnMetaEl.textContent = `Turn: ${observation.turn}`
  }

  const lastEvent = observation.recent_events?.[observation.recent_events.length - 1]
  if (lastActionEl) {
    lastActionEl.textContent = lastEvent ? `${lastEvent.type}` : "No action observed yet."
  }
  if (reasoningEl) {
    reasoningEl.textContent = lastEvent
      ? lastEvent.detail
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

function connectSpectator(characterId: string) {
  selectedCharacterId = characterId
  if (gameSocket) {
    gameSocket.close()
  }

  if (!characterId) {
    setStatus("No active sessions.")
    return
  }

  setStatus(`Watching ${characterId}...`)
  gameSocket = new WebSocket(`${getBaseWsUrl()}/spectate/${characterId}`)
  gameSocket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as SpectatorMessage
    if (message.type === "observation") {
      renderObservation(message.data)
      setStatus(`Watching ${characterId}`)
    } else if (message.type === "session_ended") {
      setStatus(`Session ended: ${message.reason}`)
    } else if (message.type === "error") {
      setStatus(message.message)
    }
  }
  gameSocket.onclose = () => {
    setStatus("Spectator socket closed.")
  }
}

async function refreshSessions() {
  const response = await fetch(`${getBaseHttpUrl()}/spectate/active`)
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
    connectSpectator(preferredCharacterId)
  } else {
    setStatus("No active sessions.")
  }
}

sessionSelectEl?.addEventListener("change", () => {
  connectSpectator(sessionSelectEl.value)
})

refreshButtonEl?.addEventListener("click", () => {
  void refreshSessions()
})

connectLobby()
void refreshSessions()
setInterval(() => {
  void refreshSessions()
}, 10_000)
