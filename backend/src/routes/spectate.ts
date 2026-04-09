import { Hono } from "hono"
import type { ActiveSpectateListResponse } from "@adventure-fun/schemas"
import { listSpectatableSessions } from "../game/active-sessions.js"

const spectate = new Hono()

// GET /spectate/active — public, no auth
spectate.get("/active", (c) => {
  const body: ActiveSpectateListResponse = { sessions: listSpectatableSessions() }
  return c.json(body)
})

export { spectate as spectateRoutes }
