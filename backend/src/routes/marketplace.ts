import { Hono } from "hono"

const marketplace = new Hono()
const DEFERRED_MESSAGE = "Marketplace coming in v1.5"

// GET /marketplace/listings — public
marketplace.get("/listings", async (c) => {
  const { rarity, item_type, min_price, max_price, sort } = c.req.query()
  // TODO: query Supabase with filters
  return c.json({ error: DEFERRED_MESSAGE }, 501)
})

// GET /marketplace/listings/:id — public
marketplace.get("/listings/:id", async (c) => {
  return c.json({ error: DEFERRED_MESSAGE }, 501)
})

// GET /marketplace/my-listings — session required
marketplace.get("/my-listings", async (c) => {
  return c.json({ error: DEFERRED_MESSAGE }, 501)
})

// POST /marketplace/list — session required, deducts gold listing fee
marketplace.post("/list", async (c) => {
  // TODO: validate character alive + in lobby, item owned + not equipped,
  //        deduct gold listing fee, transfer item to escrow owner_type
  return c.json({ error: DEFERRED_MESSAGE }, 501)
})

// POST /marketplace/buy/:id — session required, x402 with dynamic payTo
marketplace.post("/buy/:id", async (c) => {
  // TODO: check if seller alive → payTo seller wallet, else → platform wallet
  //        return 402 Payment Required with x402 header
  //        on retry with payment proof: verify, transfer item, mark sold
  return c.json({ error: DEFERRED_MESSAGE }, 501)
})

// POST /marketplace/cancel/:id — session required
marketplace.post("/cancel/:id", async (c) => {
  // TODO: validate ownership, return item from escrow, mark cancelled
  return c.json({ error: DEFERRED_MESSAGE }, 501)
})

export { marketplace as marketplaceRoutes }
