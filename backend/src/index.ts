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
import { spectateRoutes } from "./routes/spectate.js"
import { userRoutes } from "./routes/users.js"
import { contentRoutes } from "./routes/content.js"
import { configRoutes } from "./routes/config.js"
import { verifySession, type SessionPayload } from "./auth/jwt.js"
import { consumeWsTicket } from "./game/ws-tickets.js"
import { db } from "./db/client.js"
import { getRedis } from "./redis/client.js"
import { getPubSub } from "./redis/pubsub.js"
import { getLobbyManager, type LobbySocketLike } from "./game/lobby-live.js"
import { getSpectateChatManager, type SpectateChatSocketLike } from "./game/spectate-chat.js"
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

export interface SpectateChatSessionData {
  role: "spectate_chat"
  characterId: string
}

export type SocketSessionData =
  | GameSessionData
  | SpectatorSessionData
  | LobbyLiveSessionData
  | SpectateChatSessionData
import type { ServerWebSocket } from "bun"
import { getActiveSession } from "./game/active-sessions.js"

// Global safety nets so a single bad throw on the hot path can't tear the
// server down and leave every live agent staring at a silent 1006. We
// intentionally keep the process alive (log-and-continue) — the alternative
// is crashing the session for every connected player whenever one of them
// hits a bug. If the unrecoverable state is real, the per-session error
// handling in handleGameMessage will close that one socket with a proper
// code while everyone else keeps playing.
process.on("unhandledRejection", (reason, promise) => {
  console.error("[fatal] unhandledRejection", {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
    promise,
  })
})
process.on("uncaughtException", (error, origin) => {
  console.error("[fatal] uncaughtException", {
    origin,
    message: error?.message,
    stack: error?.stack,
  })
})

getRedis()

// Initialize Redis pub/sub and lobby live manager
const pubsub = getPubSub()
const lobbyManager = getLobbyManager()
if (pubsub) {
  lobbyManager.connectPubSub(pubsub)
  console.log("[lobby] Lobby live manager connected to Redis pub/sub")
}

// Sweep stale "active" realm rows left behind by a prior crash or hard restart.
// At process boot there are zero in-memory sessions, so any row still marked
// "active" is guaranteed to be orphaned. "paused" is the correct resting state
// for an interrupted run — the next reconnect will rebuild it normally.
{
  const { data: sweptRows, error: sweepError } = await db
    .from("realm_instances")
    .update({ status: "paused" })
    .eq("status", "active")
    .select("id")
  if (sweepError) {
    console.error("[startup] Stuck-active realm sweep failed:", sweepError)
  } else {
    console.log(`[startup] Swept ${sweptRows?.length ?? 0} stuck-active realm(s) to paused`)
  }
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
app.use("/spectate/active", createRateLimiter({
  label: "spectate-active",
  windowMs: 60_000,
  maxRequests: 60,
  keyFn: getClientIp,
}))

app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }))

app.route("/auth", authRoutes)
app.route("/characters", characterRoutes)
app.route("/realms", realmRoutes)
app.route("/lobby", lobbyRoutes)
app.route("/marketplace", marketplaceRoutes)
app.route("/leaderboard", leaderboardRoutes)
app.route("/legends", legendsRoutes)
app.route("/spectate", spectateRoutes)
app.route("/users", userRoutes)
app.route("/content", contentRoutes)
app.route("/config", configRoutes)

const port = Number(process.env["PORT"] ?? 3001)
console.log(`Adventure.fun server on :${port}`)

export default {
  port,

  // Bun passes (req, server) to fetch — intercept WS upgrades before Hono
  async fetch(req: Request, server: Bun.Server<SocketSessionData>) {
    const url = new URL(req.url)
    const match = url.pathname.match(/^\/realms\/([^/]+)\/enter$/)
    const spectatorMatch = url.pathname.match(/^\/spectate\/([^/]+)$/)
    const spectateChatMatch = url.pathname.match(/^\/spectate\/([^/]+)\/chat$/)

    if (match?.[1] && req.headers.get("upgrade") === "websocket") {
      const realmId = match[1]

      // Auth check — four supported paths, in priority order:
      //   1) ?ticket= — single-use short-lived ticket minted via POST /auth/ws-ticket.
      //      Proxy-friendly (no Sec-WebSocket-Protocol header shenanigans) and the
      //      JWT itself never hits a URL, so Railway's edge logs only ever see
      //      opaque UUIDs that are worthless after consumption.
      //   2) Authorization: Bearer <jwt>
      //   3) ?token=<jwt>
      //   4) Sec-WebSocket-Protocol: "Bearer, <jwt>" — browser WS workaround.
      //      Broken on Railway today because the edge strips the header, but kept
      //      for local dev and clients behind other proxies.
      let session: SessionPayload | null = null
      let wsSubprotocol = false

      const ticket = url.searchParams.get("ticket")
      if (ticket) {
        session = await consumeWsTicket(ticket)
      }

      if (!session) {
        let token = ""
        const authHeader = req.headers.get("Authorization")
        if (authHeader?.startsWith("Bearer ")) {
          token = authHeader.slice(7)
        } else if (url.searchParams.get("token")) {
          token = url.searchParams.get("token")!
        } else {
          const proto = req.headers.get("Sec-WebSocket-Protocol") ?? ""
          const parts = proto.split(/,\s*/)
          const bearerIdx = parts.indexOf("Bearer")
          if (bearerIdx !== -1 && parts[bearerIdx + 1]) {
            token = parts[bearerIdx + 1]
            wsSubprotocol = true
          }
        }

        try {
          session = await verifySession(token)
        } catch {
          return new Response("Unauthorized", { status: 401 })
        }
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
        headers: wsSubprotocol
          ? new Headers({ "Sec-WebSocket-Protocol": "Bearer" })
          : undefined,
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

    if (spectateChatMatch?.[1] && req.headers.get("upgrade") === "websocket") {
      const characterId = spectateChatMatch[1]
      const upgraded = server.upgrade(req, {
        data: { role: "spectate_chat", characterId } satisfies SpectateChatSessionData,
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

    // Diagnostic: if something that looks like a lobby WS upgrade fell through
    // here, log the path + headers so we can trace proxy/header mutations that
    // make the guard at line 273 miss. Fires only on edge-case misses — normal
    // /lobby/live upgrades return from the block above and never reach this.
    if (url.pathname.startsWith("/lobby/live")) {
      console.warn(
        `[lobby-ws] fallthrough to Hono: path=${url.pathname} `
          + `upgrade=${req.headers.get("upgrade") ?? "none"} method=${req.method}`,
      )
    }

    // All other requests go through Hono
    return app.fetch(req)
  },

  // Bun native WebSocket handler — game sessions
  websocket: {
    async open(ws: ServerWebSocket<SocketSessionData>) {
      if (ws.data.role === "lobby") {
        ws.send(JSON.stringify({ type: "connected", channel: "lobby" }))
        // addClient is async because it may rehydrate the in-memory chat
        // buffer from chat_log on the first connect after a backend restart.
        // It sends lobby_chat_history on the same WS once ready.
        await getLobbyManager().addClient(ws as unknown as LobbySocketLike)
        return
      }

      if (ws.data.role === "spectate_chat") {
        ws.send(JSON.stringify({ type: "connected", channel: "spectate_chat" }))
        await getSpectateChatManager().addClient(
          ws.data.characterId,
          ws as unknown as SpectateChatSocketLike,
        )
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
      if (
        ws.data.role === "lobby" ||
        ws.data.role === "spectator" ||
        ws.data.role === "spectate_chat"
      ) return
      await handleGameMessage(ws as ServerWebSocket<GameSessionData>, message)
    },
    async close(ws: ServerWebSocket<SocketSessionData>) {
      if (ws.data.role === "lobby") {
        getLobbyManager().removeClient(ws as unknown as LobbySocketLike)
        return
      }

      if (ws.data.role === "spectate_chat") {
        getSpectateChatManager().removeClient(
          ws.data.characterId,
          ws as unknown as SpectateChatSocketLike,
        )
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
