import { Hono } from "hono"
import { db } from "../db/client.js"
import { signSession } from "../auth/jwt.js"
import { verifyWalletSignature } from "../auth/wallet.js"

const auth = new Hono()

// In-memory nonce store (replace with Redis in production)
const pendingNonces = new Map<string, { nonce: string; expires: number }>()

// GET /auth/challenge
auth.get("/challenge", (c) => {
  const nonce = crypto.randomUUID()
  const walletHint = c.req.query("wallet") ?? "unknown"
  pendingNonces.set(nonce, { nonce, expires: Date.now() + 5 * 60 * 1000 })
  // Clean expired nonces
  for (const [k, v] of pendingNonces) {
    if (v.expires < Date.now()) pendingNonces.delete(k)
  }
  return c.json({ nonce, expires_in: 300 })
})

// POST /auth/connect
auth.post("/connect", async (c) => {
  const body = await c.req.json<{
    wallet_address: string
    signature: string
    nonce: string
    player_type?: "human" | "agent"
  }>()

  const { wallet_address, signature, nonce, player_type = "agent" } = body

  // Verify nonce exists and hasn't expired
  const stored = pendingNonces.get(nonce)
  if (!stored || stored.expires < Date.now()) {
    return c.json({ error: "Invalid or expired nonce" }, 400)
  }
  pendingNonces.delete(nonce)

  // Verify wallet signature
  const valid = await verifyWalletSignature(wallet_address, nonce, signature)
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 401)
  }

  // Upsert account — one wallet can have human + agent account
  const { data: existing } = await db
    .from("accounts")
    .select("*")
    .eq("wallet_address", wallet_address.toLowerCase())
    .eq("player_type", player_type)
    .maybeSingle()

  let account = existing
  if (!account) {
    const { data: created, error } = await db
      .from("accounts")
      .insert({
        wallet_address: wallet_address.toLowerCase(),
        player_type,
        free_realm_used: false,
      })
      .select()
      .single()
    if (error) return c.json({ error: error.message }, 500)
    account = created
  }

  const token = await signSession({
    account_id: account.id,
    wallet_address: account.wallet_address,
    player_type: account.player_type,
  })

  return c.json({ token, account })
})

// PATCH /auth/profile
auth.patch("/profile", async (c) => {
  const { requireAuth } = await import("../auth/middleware.js")
  // inline middleware call
  const header = c.req.header("Authorization")
  if (!header?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401)

  const body = await c.req.json<{
    handle?: string
    x_handle?: string
    github_handle?: string
  }>()

  const { verifySession } = await import("../auth/jwt.js")
  const session = await verifySession(header.slice(7))

  const { data, error } = await db
    .from("accounts")
    .update(body)
    .eq("id", session.account_id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

export { auth as authRoutes }
