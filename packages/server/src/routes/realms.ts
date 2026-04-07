import { Hono } from "hono"

const realms = new Hono()

// GET /realms/mine — list active realm instances
realms.get("/mine", async (c) => {
  return c.json({ error: "Not implemented" }, 501)
})

// POST /realms/generate — x402 gated (first realm free)
realms.post("/generate", async (c) => {
  // TODO: check free_realm_used, x402 gate if used, generate realm, store seed
  return c.json({ error: "Not implemented" }, 501)
})

// POST /realms/:id/regenerate — x402 + gold gated
realms.post("/:id/regenerate", async (c) => {
  return c.json({ error: "Not implemented" }, 501)
})

// GET /realms/:id/enter — WebSocket upgrade for game session
realms.get("/:id/enter", async (c) => {
  // TODO: upgrade to WebSocket, start game session turn loop
  return c.json({ error: "WebSocket upgrade required" }, 426)
})

export { realms as realmRoutes }
