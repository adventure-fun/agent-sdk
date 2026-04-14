import { Hono } from "hono"
import { getAllActionPrices } from "../payments/x402.js"

const config = new Hono()

// GET /config/payments — x402 action → USD price map (no auth required)
config.get("/payments", (c) => {
  return c.json({ prices: getAllActionPrices() })
})

export { config as configRoutes }
