import { Hono } from "hono"
import { db } from "../db/client.js"
import { signSession } from "../auth/jwt.js"
import { verifyWalletSignature } from "../auth/wallet.js"
import { requireAuth } from "../auth/middleware.js"
import { isRedisAvailable, redisDel, redisGet, redisSet } from "../redis/client.js"
import { generateAnonHandle, isAnonHandle, isProfane } from "../game/handle-generator.js"

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
    // New account — auto-assign a fun anonymous handle like
    // "anon-silly-smelly-rat" so the profile / leaderboard / chat
    // rendering is never stuck showing a wallet fragment. Retry up to
    // a few times on unique-constraint collision (the pool is ~75k
    // combinations so collisions are rare but not impossible, and
    // get more likely as the user base grows).
    let createdAccount = null
    let lastError: { message: string } | null = null
    for (let attempt = 0; attempt < 5 && !createdAccount; attempt++) {
      const { data: created, error } = await db
        .from("accounts")
        .insert({
          wallet_address: wallet_address.toLowerCase(),
          player_type,
          handle: generateAnonHandle(),
          free_realm_used: false,
        })
        .select()
        .single()
      if (error) {
        lastError = error
        // Postgres 23505 = unique_violation. Only retry on that — other
        // errors are real failures we shouldn't paper over.
        if (!/duplicate key|unique/i.test(error.message)) break
        continue
      }
      createdAccount = created
    }
    if (!createdAccount) {
      return c.json({ error: lastError?.message ?? "Failed to create account" }, 500)
    }
    account = createdAccount
  } else if (!existing?.handle) {
    // Existing account with a null handle (pre-generator) — backfill
    // with an anon handle on login so every session from here on has
    // a non-null display name. Runs once per legacy account.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: updated, error } = await db
        .from("accounts")
        .update({ handle: generateAnonHandle() })
        .eq("id", existing!.id)
        .is("handle", null)
        .select()
        .single()
      if (!error && updated) {
        account = updated
        break
      }
      if (error && !/duplicate key|unique/i.test(error.message)) {
        console.warn("[auth] anon handle backfill failed", { error: error.message })
        break
      }
    }
  }

  const token = await signSession({
    account_id: account.id,
    wallet_address: account.wallet_address,
    player_type: account.player_type,
  })

  return c.json({ token, account })
})

// ── Validation helpers for PATCH /auth/profile ───────────────────────────────

// Handles are stored lowercase in the DB (unique index is on LOWER(handle))
// so we accept any case in the request and normalize here. 3-24 chars,
// alphanumeric + dash + underscore only so the URL encoder never has to
// escape anything and the visual form stays consistent with the anon
// generator's output (`anon-silly-smelly-rat`).
const HANDLE_RE = /^[a-zA-Z0-9_-]{3,24}$/

// X/Twitter handle spec: 1-15 chars, alphanumeric + underscore. We store
// the bare username, not the full URL, so the frontend can render either
// as text or as a link to https://x.com/{handle}.
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/

// GitHub handle spec: 1-39 chars, alphanumeric, single non-consecutive
// dashes, can't start or end with a dash.
const GITHUB_HANDLE_RE = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/

type ProfilePatchResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

function validateHandle(raw: unknown): ProfilePatchResult {
  if (raw === null || raw === "") return { ok: true, value: null }
  if (typeof raw !== "string") return { ok: false, error: "handle must be a string" }
  const trimmed = raw.trim().toLowerCase()
  if (!HANDLE_RE.test(trimmed)) {
    return { ok: false, error: "Handle must be 3-24 chars, letters, numbers, dash, or underscore." }
  }
  if (isProfane(trimmed)) {
    return { ok: false, error: "Handle failed the profanity check. Try something else." }
  }
  return { ok: true, value: trimmed }
}

function validateXHandle(raw: unknown): ProfilePatchResult {
  if (raw === null || raw === "") return { ok: true, value: null }
  if (typeof raw !== "string") return { ok: false, error: "x_handle must be a string" }
  const trimmed = raw.trim().replace(/^@/, "") // tolerate "@jack"
  if (!X_HANDLE_RE.test(trimmed)) {
    return { ok: false, error: "X handle must be 1-15 chars, letters, numbers, or underscore. Don't include the @ or full URL." }
  }
  return { ok: true, value: trimmed }
}

function validateGithubHandle(raw: unknown): ProfilePatchResult {
  if (raw === null || raw === "") return { ok: true, value: null }
  if (typeof raw !== "string") return { ok: false, error: "github_handle must be a string" }
  const trimmed = raw.trim()
  if (!GITHUB_HANDLE_RE.test(trimmed)) {
    return { ok: false, error: "GitHub handle must be 1-39 chars, alphanumeric and dashes only. Don't include the full URL." }
  }
  return { ok: true, value: trimmed }
}

// PATCH /auth/profile — update handle / x_handle / github_handle.
//
// Each field is independently optional; omitting it leaves the existing
// value alone. Passing an empty string or explicit null clears it.
// Validation mirrors the client-side rules in the profile edit modal so
// a direct API caller can't bypass them.
auth.patch("/profile", requireAuth, async (c) => {
  const body = await c.req.json<{
    handle?: string | null
    x_handle?: string | null
    github_handle?: string | null
  }>()
  const session = c.get("session")

  const update: Record<string, string | null> = {}

  if ("handle" in body) {
    const result = validateHandle(body.handle)
    if (!result.ok) return c.json({ error: result.error }, 400)
    update["handle"] = result.value
  }
  if ("x_handle" in body) {
    const result = validateXHandle(body.x_handle)
    if (!result.ok) return c.json({ error: result.error }, 400)
    update["x_handle"] = result.value
  }
  if ("github_handle" in body) {
    const result = validateGithubHandle(body.github_handle)
    if (!result.ok) return c.json({ error: result.error }, 400)
    update["github_handle"] = result.value
  }

  if (Object.keys(update).length === 0) {
    return c.json({ error: "No fields to update" }, 400)
  }

  const { data, error } = await db
    .from("accounts")
    .update(update)
    .eq("id", session.account_id)
    .select()
    .single()

  if (error) {
    // Map unique-constraint violation to a friendly 409
    if (/duplicate key|unique/i.test(error.message)) {
      return c.json({ error: "That handle is already taken. Try another." }, 409)
    }
    return c.json({ error: error.message }, 500)
  }
  return c.json(data)
})

// GET /auth/profile/suggest-handle — returns a fresh anon handle candidate.
// Used by the "re-roll" button in the profile edit UI. Not persisted until
// the user actually submits it via PATCH /auth/profile.
auth.get("/profile/suggest-handle", requireAuth, async (c) => {
  return c.json({ handle: generateAnonHandle(), is_anon: true })
})

// GET /auth/me — re-read the current session's account row.
//
// The frontend caches the auth state in localStorage at login time. That
// cache goes stale whenever a server-side change edits the row (e.g. the
// anon-handle backfill, or the user updating their handle/X/GitHub via
// PATCH /auth/profile on a different device). This endpoint lets the
// frontend re-hydrate its copy on page load without forcing a full wallet
// re-sign.
auth.get("/me", requireAuth, async (c) => {
  const session = c.get("session")
  const { data, error } = await db
    .from("accounts")
    .select("*")
    .eq("id", session.account_id)
    .maybeSingle()
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: "Account not found" }, 404)
  return c.json(data)
})

// Re-export isAnonHandle so the /users/:id response can flag anon users
// in the profile UI if we want to (currently not used but cheap to have).
export { isAnonHandle }

export { auth as authRoutes }
