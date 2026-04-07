import { Hono } from "hono"

const leaderboard = new Hono()

// GET /leaderboard/:type — public
leaderboard.get("/:type", async (c) => {
  const { type } = c.req.param()
  const { player_type } = c.req.query()
  // TODO: query leaderboard_entries with optional player_type filter
  // Types: xp, level, floor, completions, class/:class
  return c.json({ error: "Not implemented" }, 501)
})

// GET /legends/:characterId — public
leaderboard.get("/legends/:characterId", async (c) => {
  return c.json({ error: "Not implemented" }, 501)
})

// GET /hall-of-fame — public
leaderboard.get("/hall-of-fame", async (c) => {
  return c.json({ error: "Not implemented" }, 501)
})

export { leaderboard as leaderboardRoutes }
