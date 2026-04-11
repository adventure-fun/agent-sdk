import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import type { ServerWebSocket } from "bun"
import { authRoutes } from "./routes/auth.js"
import { characterRoutes } from "./routes/characters.js"
import { realmRoutes } from "./routes/realms.js"
import { lobbyRoutes } from "./routes/lobby.js"
import { contentRoutes } from "./routes/content.js"
import { verifySession } from "./auth.js"
import { addLobbyClient, broadcastLobbyMessage, getActiveSession, getCharacterByAccountId, getRealmById, listSpectatableSessions, removeLobbyClient, type LobbySocketData, type PlayerSocketData, type SocketSessionData, type SpectatorSocketData } from "./store.js"
import { handleGameClose, handleGameMessage, handleGameOpen } from "./game/session.js"

const app = new Hono()

app.use("*", logger())
app.use("*", cors())

app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }))
app.get("/spectate/active", (c) => c.json({ sessions: listSpectatableSessions() }))

app.route("/auth", authRoutes)
app.route("/characters", characterRoutes)
app.route("/realms", realmRoutes)
app.route("/lobby", lobbyRoutes)
app.route("/content", contentRoutes)

const port = Number(process.env["PORT"] ?? 3001)

function parseWebSocketToken(req: Request, url: URL): string {
  const authHeader = req.headers.get("Authorization") ?? url.searchParams.get("token") ?? ""
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }

  if (authHeader) {
    return authHeader
  }

  const subprotocolHeader = req.headers.get("sec-websocket-protocol")
  if (!subprotocolHeader) {
    return ""
  }

  const parts = subprotocolHeader.split(",").map((part) => part.trim()).filter(Boolean)
  if (parts[0] === "Bearer" && parts[1]) {
    return parts[1]
  }

  return parts[0] ?? ""
}

export default {
  port,
  async fetch(req: Request, server: Bun.Server<SocketSessionData>) {
    const url = new URL(req.url)
    const match = url.pathname.match(/^\/realms\/([^/]+)\/enter$/)
    const spectatorMatch = url.pathname.match(/^\/spectate\/([^/]+)$/)

    if (match?.[1] && req.headers.get("upgrade") === "websocket") {
      const token = parseWebSocketToken(req, url)
      let session
      try {
        session = await verifySession(token)
      } catch {
        return new Response("Unauthorized", { status: 401 })
      }

      const character = getCharacterByAccountId(session.account_id)
      const realm = getRealmById(match[1])
      if (!character || character.status !== "alive") {
        return new Response("No living character", { status: 404 })
      }
      if (!realm || realm.character_id !== character.id) {
        return new Response("Realm not found", { status: 404 })
      }

      realm.status = "active"
      const upgraded = server.upgrade(req, {
        data: {
          role: "player",
          realmId: realm.id,
          session,
          characterId: character.id,
        } satisfies Omit<PlayerSocketData, "turnTimer">,
      })

      return upgraded
        ? undefined as unknown as Response
        : new Response("WS upgrade failed", { status: 500 })
    }

    if (url.pathname === "/lobby/live" && req.headers.get("upgrade") === "websocket") {
      const upgraded = server.upgrade(req, {
        data: { role: "lobby" } satisfies LobbySocketData,
      })
      return upgraded
        ? undefined as unknown as Response
        : new Response("WS upgrade failed", { status: 500 })
    }

    if (spectatorMatch?.[1] && req.headers.get("upgrade") === "websocket") {
      const activeSession = getActiveSession(spectatorMatch[1])
      if (!activeSession) {
        return new Response("Character is not currently in a live realm", { status: 404 })
      }

      const upgraded = server.upgrade(req, {
        data: {
          role: "spectator",
          characterId: spectatorMatch[1],
        } satisfies SpectatorSocketData,
      })
      return upgraded
        ? undefined as unknown as Response
        : new Response("WS upgrade failed", { status: 500 })
    }

    return app.fetch(req)
  },
  websocket: {
    async open(ws: ServerWebSocket<SocketSessionData>) {
      if (ws.data.role === "lobby") {
        addLobbyClient(ws as ServerWebSocket<LobbySocketData>)
        ws.send(JSON.stringify({ type: "connected", channel: "lobby" }))
        return
      }

      if (ws.data.role === "spectator") {
        const session = getActiveSession(ws.data.characterId)
        if (!session) {
          ws.send(JSON.stringify({ type: "error", message: "Character is not currently in a live realm" }))
          ws.close()
          return
        }
        session.addSpectator(ws as ServerWebSocket<SpectatorSocketData>)
        ws.send(JSON.stringify({ type: "observation", data: session.getSpectatorObservation() }))
        return
      }

      await handleGameOpen(ws as ServerWebSocket<PlayerSocketData>)
      const character = getCharacterByAccountId(ws.data.session.account_id)
      if (character) {
        broadcastLobbyMessage({
          type: "lobby_activity",
          data: {
            type: "realm_enter",
            characterName: character.name,
            characterClass: character.class,
            detail: `Entered realm ${ws.data.realmId}`,
            timestamp: Date.now(),
          },
        })
      }
    },
    async message(ws: ServerWebSocket<SocketSessionData>, message: string | Buffer) {
      if (ws.data.role === "lobby" || ws.data.role === "spectator") {
        return
      }
      await handleGameMessage(ws as ServerWebSocket<PlayerSocketData>, message)
    },
    async close(ws: ServerWebSocket<SocketSessionData>) {
      if (ws.data.role === "lobby") {
        removeLobbyClient(ws as ServerWebSocket<LobbySocketData>)
        return
      }

      if (ws.data.role === "spectator") {
        const session = getActiveSession(ws.data.characterId)
        session?.removeSpectator(ws as ServerWebSocket<SpectatorSocketData>)
        return
      }

      await handleGameClose(ws as ServerWebSocket<PlayerSocketData>)
    },
  },
}
