import { Hono } from "hono"

const characters = new Hono()

// GET /characters/me
characters.get("/me", async (c) => {
  // TODO: auth middleware, fetch from Supabase
  return c.json({ error: "Not implemented" }, 501)
})

// POST /characters/roll — free character creation
characters.post("/roll", async (c) => {
  // TODO: validate session, check no alive character exists, roll stats, insert to DB
  return c.json({ error: "Not implemented" }, 501)
})

// POST /characters/reroll-stats — x402 gated
characters.post("/reroll-stats", async (c) => {
  // TODO: x402 gate, validate once-per-character, reroll within class bounds
  return c.json({ error: "Not implemented" }, 501)
})

export { characters as characterRoutes }
