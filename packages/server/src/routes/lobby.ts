import { Hono } from "hono"

const lobby = new Hono()

// GET /lobby/shops
lobby.get("/shops", async (c) => {
  return c.json({ error: "Not implemented" }, 501)
})

// POST /lobby/shop/buy
lobby.post("/shop/buy", async (c) => {
  return c.json({ error: "Not implemented" }, 501)
})

// POST /lobby/shop/sell
lobby.post("/shop/sell", async (c) => {
  return c.json({ error: "Not implemented" }, 501)
})

// POST /inn/rest — x402 gated
lobby.post("/inn/rest", async (c) => {
  return c.json({ error: "Not implemented" }, 501)
})

export { lobby as lobbyRoutes }
