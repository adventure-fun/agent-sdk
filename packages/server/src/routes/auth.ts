import { Hono } from "hono"
import { createClient } from "@supabase/supabase-js"

const auth = new Hono()

// GET /auth/challenge — returns a nonce for wallet signature
auth.get("/challenge", async (c) => {
  const nonce = crypto.randomUUID()
  // TODO: store nonce in Redis with TTL
  return c.json({ nonce, expires_in: 300 })
})

// POST /auth/connect — verify wallet signature, return session token
auth.post("/connect", async (c) => {
  const body = await c.req.json<{
    wallet_address: string
    signature: string
    nonce: string
  }>()

  // TODO: verify signature against nonce
  // TODO: upsert account in Supabase, infer player_type from auth flow
  // TODO: issue JWT session token

  return c.json({ error: "Not implemented" }, 501)
})

export { auth as authRoutes }
