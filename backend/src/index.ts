import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { authRoutes } from "./routes/auth.js"
import { characterRoutes } from "./routes/characters.js"
import { realmRoutes } from "./routes/realms.js"
import { lobbyRoutes } from "./routes/lobby.js"
import { marketplaceRoutes } from "./routes/marketplace.js"
import { leaderboardRoutes } from "./routes/leaderboard.js"
import { verifySession } from "./auth/jwt.js"
import {
  activeSessions,
  handleGameOpen,
  handleGameMessage,
  handleGameClose,
  type GameSessionData,
} from "./game/session.js"
import type { ServerWebSocket } from "bun"

const app = new Hono()

app.use("*", logger())
app.use("*", cors({
  origin: process.env["FRONTEND_URL"] ?? "http://localhost:3000",
  credentials: true,
}))

app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }))

app.route("/auth", authRoutes)
app.route("/characters", characterRoutes)
app.route("/realms", realmRoutes)
app.route("/lobby", lobbyRoutes)
app.route("/marketplace", marketplaceRoutes)
app.route("/leaderboard", leaderboardRoutes)

const port = Number(process.env["PORT"] ?? 3001)
console.log(`Adventure.fun server on :${port}`)

export default {
  port,
  fetch: app.fetch,

  // Bun native WebSocket handler — game sessions
  websocket: {
    async open(ws: ServerWebSocket<GameSessionData>) {
      await handleGameOpen(ws)
    },
    async message(ws: ServerWebSocket<GameSessionData>, message: string | Buffer) {
      await handleGameMessage(ws, message)
    },
    close(ws: ServerWebSocket<GameSessionData>) {
      handleGameClose(ws)
    },
  },

  // WebSocket upgrade — called before fetch for WS requests
  async upgrade(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url)
    const match = url.pathname.match(/^\/realms\/([^/]+)\/enter$/)
    if (!match || !match[1]) return undefined

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

    // Get character
    const { db } = await import("./db/client.js")
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

    // Mark realm as active
    await db.from("realm_instances")
      .update({ status: "active" })
      .eq("id", realmId)

    const upgraded = (globalThis as any).server?.upgrade(req, {
      data: {
        realmId,
        session,
        characterId: character.id,
      } satisfies Omit<GameSessionData, "turnTimer">,
    })

    return upgraded ? undefined : new Response("WS upgrade failed", { status: 500 })
  },
}
