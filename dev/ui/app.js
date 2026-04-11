const statusEl = document.getElementById("status")
const sessionSelectEl = document.getElementById("sessionSelect")
const refreshButtonEl = document.getElementById("refreshButton")
const roomTextEl = document.getElementById("roomText")
const asciiMapEl = document.getElementById("asciiMap")
const entitiesEl = document.getElementById("entities")
const eventsEl = document.getElementById("events")
const chatLogEl = document.getElementById("chatLog")
const characterMetaEl = document.getElementById("characterMeta")
const realmMetaEl = document.getElementById("realmMeta")
const positionMetaEl = document.getElementById("positionMeta")
const hpMetaEl = document.getElementById("hpMeta")
const resourceMetaEl = document.getElementById("resourceMeta")
const turnMetaEl = document.getElementById("turnMeta")
const lastActionEl = document.getElementById("lastAction")
const reasoningEl = document.getElementById("reasoning")

let gameSocket = null
let lobbySocket = null
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

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message
  }
}

function renderList(target, values) {
  if (!target) return
  target.innerHTML = ""
  for (const value of values) {
    const item = document.createElement("li")
    item.textContent = value
    target.appendChild(item)
  }
}

function renderMap(observation) {
  if (!asciiMapEl) return
  const points = observation.visible_tiles ?? []
  if (points.length === 0) {
    asciiMapEl.textContent = "No visible tiles."
    return
  }

  const xs = points.map((tile) => tile.x)
  const ys = points.map((tile) => tile.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const pointMap = new Map(points.map((tile) => [`${tile.x},${tile.y}`, tile]))

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

function renderObservation(observation) {
  if (roomTextEl) {
    roomTextEl.textContent = observation.room_text ?? "No room text available."
  }

  renderMap(observation)

  renderList(
    entitiesEl,
    (observation.visible_entities ?? []).map((entity) => {
      const health = "health_indicator" in entity && entity.health_indicator
        ? ` [${entity.health_indicator}]`
        : ""
      return `${entity.type}: ${entity.name} @ (${entity.position.x}, ${entity.position.y})${health}`
    }),
  )

  renderList(
    eventsEl,
    (observation.recent_events ?? []).map((event) => `${event.type}: ${event.detail}`),
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
    const hpValue = "hp_percent" in observation.character
      ? `${observation.character.hp_percent}%`
      : `${observation.character.hp.current}/${observation.character.hp.max}`
    hpMetaEl.textContent = `HP: ${hpValue}`
  }
  if (resourceMetaEl) {
    const resourceValue = "resource_percent" in observation.character
      ? `${observation.character.resource_percent}%`
      : `${observation.character.resource.current}/${observation.character.resource.max}`
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
    const message = JSON.parse(String(event.data))
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

function connectSpectator(characterId) {
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
    const message = JSON.parse(String(event.data))
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
  const payload = await response.json()
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
