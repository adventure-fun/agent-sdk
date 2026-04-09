import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { authRoutes } from "./routes/auth.js"
import { characterRoutes } from "./routes/characters.js"
import { realmRoutes } from "./routes/realms.js"
import { lobbyRoutes } from "./routes/lobby.js"
import { marketplaceRoutes } from "./routes/marketplace.js"
import { leaderboardRoutes } from "./routes/leaderboard.js"
import { legendsRoutes } from "./routes/legends.js"
import { contentRoutes } from "./routes/content.js"
import { verifySession } from "./auth/jwt.js"
import { db } from "./db/client.js"
import { getRedis } from "./redis/client.js"
import { getPubSub } from "./redis/pubsub.js"
import { getLobbyManager, type LobbySocketLike } from "./game/lobby-live.js"
import { createRateLimiter, getClientIp } from "./middleware/rate-limit.js"
import {
  resolveCorsOrigin,
  canOpenWebSocket,
  registerWebSocketOpen,
  registerWebSocketClose,
} from "./server/security-config.js"
import {
  handleGameOpen,
  handleGameMessage,
  handleGameClose,
  type GameSessionData,
  type SpectatorSessionData,
} from "./game/session.js"

export interface LobbyLiveSessionData {
  role: "lobby"
}

export type SocketSessionData = GameSessionData | SpectatorSessionData | LobbyLiveSessionData
import type { ServerWebSocket } from "bun"
import { getActiveSession } from "./game/active-sessions.js"

getRedis()

// Initialize Redis pub/sub and lobby live manager
const pubsub = getPubSub()
const lobbyManager = getLobbyManager()
if (pubsub) {
  lobbyManager.connectPubSub(pubsub)
  console.log("[lobby] Lobby live manager connected to Redis pub/sub")
}

const app = new Hono()

app.use("*", logger())
app.use("*", cors({
  origin: (origin, c) => {
    return resolveCorsOrigin(origin, new URL(c.req.url).pathname)
  },
  credentials: true,
}))
app.use("*", createRateLimiter({
  label: "global",
  windowMs: 60_000,
  maxRequests: 100,
  keyFn: getClientIp,
}))
app.use("/auth/challenge", createRateLimiter({
  label: "auth-challenge",
  windowMs: 60_000,
  maxRequests: 10,
  keyFn: getClientIp,
}))
app.use("/characters/roll", createRateLimiter({
  label: "character-roll",
  windowMs: 60_000,
  maxRequests: 5,
  keyFn: (c) => {
    const session = c.get("session")
    return session?.account_id ?? getClientIp(c)
  },
}))
app.use("/realms/generate", createRateLimiter({
  label: "realm-generate",
  windowMs: 60_000,
  maxRequests: 10,
  keyFn: (c) => {
    const session = c.get("session")
    return session?.account_id ?? getClientIp(c)
  },
}))

app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }))

app.route("/auth", authRoutes)
app.route("/characters", characterRoutes)
app.route("/realms", realmRoutes)
app.route("/lobby", lobbyRoutes)
app.route("/marketplace", marketplaceRoutes)
app.route("/leaderboard", leaderboardRoutes)
app.route("/legends", legendsRoutes)
app.route("/content", contentRoutes)

const port = Number(process.env["PORT"] ?? 3001)
console.log(`Adventure.fun server on :${port}`)

export default {
  port,

  // Bun passes (req, server) to fetch — intercept WS upgrades before Hono
  async fetch(req: Request, server: Bun.Server<SocketSessionData>) {
    const url = new URL(req.url)
    const match = url.pathname.match(/^\/realms\/([^/]+)\/enter$/)
    const spectatorMatch = url.pathname.match(/^\/spectate\/([^/]+)$/)

    if (match?.[1] && req.headers.get("upgrade") === "websocket") {
      const realmId = match[1]

      // Auth check
      const authHeader = req.headers.get("Authorization") ??
        url.searchParams.get("token") ?? ""
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader

      let session
      try {
        session = await verifySession(token)
      } catch {
        return new Response("Unauthorized", { status: 401 })
      }

      if (!canOpenWebSocket(session.account_id)) {
        return new Response("Too many open game connections", { status: 429 })
      }

      // Get character
      const { data: character } = await db
        .from("characters")
        .select("id")
        .eq("account_id", session.account_id)
        .eq("status", "alive")
        .maybeSingle()

      if (!character) return new Response("No living character", { status: 404 })

      // Verify realm belongs to character
      const { data: realm } = await db
        .from("realm_instances")
        .select("id, status")
        .eq("id", realmId)
        .eq("character_id", character.id)
        .maybeSingle()

      if (!realm) return new Response("Realm not found", { status: 404 })

      // Guard: reject completed or dead_end realms (must regenerate first)
      if (realm.status === "completed" || realm.status === "dead_end") {
        return new Response("Realm is finished — regenerate to play again", { status: 409 })
      }

      // Mark realm as active
      await db.from("realm_instances")
        .update({ status: "active" })
        .eq("id", realmId)

      registerWebSocketOpen(session.account_id)
      const upgraded = server.upgrade(req, {
        data: {
          role: "player",
          realmId,
          session,
          characterId: character.id,
        } satisfies Omit<GameSessionData, "turnTimer">,
      })

      if (!upgraded) {
        registerWebSocketClose(session.account_id)
      }
      return upgraded ? undefined as unknown as Response : new Response("WS upgrade failed", { status: 500 })
    }

    if (url.pathname === "/lobby/live" && req.headers.get("upgrade") === "websocket") {
      const upgraded = server.upgrade(req, {
        data: { role: "lobby" } satisfies LobbyLiveSessionData,
      })
      return upgraded ? undefined as unknown as Response : new Response("WS upgrade failed", { status: 500 })
    }

    if (spectatorMatch?.[1] && req.headers.get("upgrade") === "websocket") {
      const characterId = spectatorMatch[1]
      const session = getActiveSession(characterId)
      if (!session) {
        return new Response("Character is not currently in a live realm", { status: 404 })
      }

      const upgraded = server.upgrade(req, {
        data: {
          role: "spectator",
          characterId,
        } satisfies SpectatorSessionData,
      })

      return upgraded ? undefined as unknown as Response : new Response("WS upgrade failed", { status: 500 })
    }

    // All other requests go through Hono
    return app.fetch(req)
  },

  // Bun native WebSocket handler — game sessions
  websocket: {
    async open(ws: ServerWebSocket<SocketSessionData>) {
      if (ws.data.role === "lobby") {
        getLobbyManager().addClient(ws as unknown as LobbySocketLike)
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
        session.addSpectator(ws as unknown as ServerWebSocket<SpectatorSessionData>)
        ws.send(JSON.stringify({ type: "observation", data: session.getSpectatorObservation() }))
        return
      }

      await handleGameOpen(ws as ServerWebSocket<GameSessionData>)
    },
    async message(ws: ServerWebSocket<SocketSessionData>, message: string | Buffer) {
      if (ws.data.role === "lobby" || ws.data.role === "spectator") return
      await handleGameMessage(ws as ServerWebSocket<GameSessionData>, message)
    },
    async close(ws: ServerWebSocket<SocketSessionData>) {
      if (ws.data.role === "lobby") {
        getLobbyManager().removeClient(ws as unknown as LobbySocketLike)
        return
      }

      if (ws.data.role === "spectator") {
        const session = getActiveSession(ws.data.characterId)
        session?.removeSpectator(ws as unknown as ServerWebSocket<SpectatorSessionData>)
        return
      }

      registerWebSocketClose(ws.data.session.account_id)
      await handleGameClose(ws as ServerWebSocket<GameSessionData>)
    },
  },
}
