import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { authRoutes } from "./routes/auth.js"
import { characterRoutes } from "./routes/characters.js"
import { realmRoutes } from "./routes/realms.js"
import { lobbyRoutes } from "./routes/lobby.js"
import { marketplaceRoutes } from "./routes/marketplace.js"
import { leaderboardRoutes } from "./routes/leaderboard.js"

const app = new Hono()

app.use("*", logger())
app.use("*", cors({
  origin: process.env["FRONTEND_URL"] ?? "http://localhost:3000",
  credentials: true,
}))

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }))

// API routes
app.route("/auth", authRoutes)
app.route("/characters", characterRoutes)
app.route("/realms", realmRoutes)
app.route("/lobby", lobbyRoutes)
app.route("/marketplace", marketplaceRoutes)
app.route("/leaderboard", leaderboardRoutes)

const port = Number(process.env["PORT"] ?? 3001)

console.log(`Adventure.fun server starting on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
