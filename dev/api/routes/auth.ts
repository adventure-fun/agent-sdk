import { Hono } from "hono"
import { requireAuth } from "../auth.js"
import { signSession } from "../auth.js"
import { updateAccountProfile, upsertAccount } from "../store.js"

const NONCE_TTL_MS = 5 * 60 * 1000
const nonces = new Map<string, number>()

export const authRoutes = new Hono()

authRoutes.get("/challenge", (c) => {
  const nonce = crypto.randomUUID()
  nonces.set(nonce, Date.now() + NONCE_TTL_MS)
  return c.json({ nonce, expires_in: 300 })
})

authRoutes.post("/connect", async (c) => {
  const body = await c.req.json<{
    wallet_address?: string
    signature?: string
    nonce?: string
    player_type?: "human" | "agent"
  }>()

  if (!body.wallet_address || !body.signature || !body.nonce) {
    return c.json({ error: "wallet_address, signature, and nonce are required" }, 400)
  }

  const expiresAt = nonces.get(body.nonce)
  if (!expiresAt || expiresAt < Date.now()) {
    nonces.delete(body.nonce)
    return c.json({ error: "Invalid or expired nonce" }, 400)
  }
  nonces.delete(body.nonce)

  const account = upsertAccount(body.wallet_address, body.player_type ?? "agent")
  const token = await signSession({
    account_id: account.id,
    wallet_address: account.wallet_address,
    player_type: account.player_type,
  })

  return c.json({
    token,
    expires_at: Date.now() + NONCE_TTL_MS,
    account,
  })
})

authRoutes.patch("/profile", requireAuth, async (c) => {
  const body = await c.req.json<{
    handle?: string
    x_handle?: string
    github_handle?: string
  }>()
  const session = c.get("session")
  const account = updateAccountProfile(session, body)
  if (!account) {
    return c.json({ error: "Account not found" }, 404)
  }

  return c.json(account)
})
