import { Hono } from "hono"
import { db } from "../db/client.js"
import { signSession } from "../auth/jwt.js"
import { verifyWalletSignature } from "../auth/wallet.js"
import { requireAuth } from "../auth/middleware.js"
import { isRedisAvailable, redisDel, redisGet, redisSet } from "../redis/client.js"

const auth = new Hono()

const NONCE_TTL_SECONDS = 5 * 60
const pendingNonces = new Map<string, { nonce: string; expires: number }>()

async function storeNonce(nonce: string): Promise<void> {
  const value = JSON.stringify({ nonce, expires: Date.now() + NONCE_TTL_SECONDS * 1000 })
  const storedInRedis = await redisSet(`nonce:${nonce}`, value, NONCE_TTL_SECONDS)
  if (!storedInRedis) {
    pendingNonces.set(nonce, { nonce, expires: Date.now() + NONCE_TTL_SECONDS * 1000 })
    for (const [key, entry] of pendingNonces) {
      if (entry.expires < Date.now()) pendingNonces.delete(key)
    }
  }
}

async function readNonce(nonce: string): Promise<{ nonce: string; expires: number } | null> {
  const stored = await redisGet(`nonce:${nonce}`)
  if (stored) {
    try {
      return JSON.parse(stored) as { nonce: string; expires: number }
    } catch {
      return null
    }
  }
  return pendingNonces.get(nonce) ?? null
}

async function deleteNonce(nonce: string): Promise<void> {
  const deleted = await redisDel(`nonce:${nonce}`)
  if (!deleted || !isRedisAvailable()) {
    pendingNonces.delete(nonce)
  }
}

// GET /auth/challenge
auth.get("/challenge", async (c) => {
  const nonce = crypto.randomUUID()
  await storeNonce(nonce)
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
  const stored = await readNonce(nonce)
  if (!stored || stored.expires < Date.now()) {
    return c.json({ error: "Invalid or expired nonce" }, 400)
  }
  await deleteNonce(nonce)

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
auth.patch("/profile", requireAuth, async (c) => {
  const body = await c.req.json<{
    handle?: string
    x_handle?: string
    github_handle?: string
  }>()
  const session = c.get("session")

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
