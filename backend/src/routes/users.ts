// Public user profile endpoints.
//
// The frontend /user/[id] page lets visitors look up any account — their own
// or someone else's — and see the account's handle, wallet, join date, and
// the full list of characters (living + graveyard). These routes are public
// (no auth) because everything they return is already visible on the
// leaderboard and on individual character pages.
//
// The `id` segment in /users/:id accepts three forms, in priority order:
//   1. a literal account UUID (looked up by accounts.id)
//   2. a handle (looked up case-insensitively against accounts.handle)
//   3. a wallet address (exact match against accounts.wallet_address)
//
// If the resolved account has multiple characters, they're returned sorted
// alive-first-then-by-created_at-desc so the viewer sees the current living
// hero at the top of the list.

import { Hono } from "hono"
import { db } from "../db/client.js"

const users = new Hono()

// ── Helpers ──────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

async function resolveAccount(identifier: string): Promise<Record<string, unknown> | null> {
  if (UUID_RE.test(identifier)) {
    const { data } = await db
      .from("accounts")
      .select("*")
      .eq("id", identifier)
      .maybeSingle()
    if (data) return data as Record<string, unknown>
  }

  if (WALLET_RE.test(identifier)) {
    const { data } = await db
      .from("accounts")
      .select("*")
      .eq("wallet_address", identifier.toLowerCase())
      .maybeSingle()
    if (data) return data as Record<string, unknown>
  }

  // Handle lookup (case-insensitive). Some wallet strings also survive this
  // path if they aren't well-formed 0x-prefixed — that's fine, the ilike
  // simply won't match anything.
  const { data } = await db
    .from("accounts")
    .select("*")
    .ilike("handle", identifier)
    .maybeSingle()
  return (data as Record<string, unknown> | null) ?? null
}

// ── GET /users/:id ───────────────────────────────────────────────────────────

users.get("/:id", async (c) => {
  const id = c.req.param("id")
  if (!id) return c.json({ error: "User id is required" }, 400)

  const account = await resolveAccount(id)
  if (!account) return c.json({ error: "User not found" }, 404)

  const accountId = account["id"] as string

  // Fetch every character the account has ever owned — alive or dead.
  const { data: characters, error: charsErr } = await db
    .from("characters")
    .select(`
      id, name, class, level, xp,
      hp_current, hp_max, resource_current, resource_max,
      status, stat_rerolled, created_at, died_at
    `)
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })

  if (charsErr) return c.json({ error: charsErr.message }, 500)

  // Pull leaderboard snapshots for richer stats (deepest floor, completions,
  // cause of death). These are denormalized at run-end so they're cheaper to
  // read than joining realm_instances + run_logs.
  const characterIds = (characters ?? []).map((c) => c.id as string)
  let leaderboardByChar = new Map<string, Record<string, unknown>>()
  if (characterIds.length > 0) {
    const { data: lbRows } = await db
      .from("leaderboard_entries")
      .select("character_id, deepest_floor, realms_completed, cause_of_death")
      .in("character_id", characterIds)
    for (const row of lbRows ?? []) {
      leaderboardByChar.set((row as Record<string, unknown>).character_id as string, row as Record<string, unknown>)
    }
  }

  // Sort alive-first, then newest-first
  const sortedCharacters = (characters ?? []).slice().sort((a, b) => {
    if (a.status === "alive" && b.status !== "alive") return -1
    if (a.status !== "alive" && b.status === "alive") return 1
    return String(b.created_at).localeCompare(String(a.created_at))
  })

  const enrichedCharacters = sortedCharacters.map((character) => {
    const lb = leaderboardByChar.get(character.id as string)
    return {
      id: character.id,
      name: character.name,
      class: character.class,
      level: character.level,
      xp: character.xp,
      status: character.status,
      hp_current: character.hp_current,
      hp_max: character.hp_max,
      resource_current: character.resource_current,
      resource_max: character.resource_max,
      created_at: character.created_at,
      died_at: character.died_at,
      deepest_floor: (lb?.["deepest_floor"] as number | undefined) ?? null,
      realms_completed: (lb?.["realms_completed"] as number | undefined) ?? null,
      cause_of_death: (lb?.["cause_of_death"] as string | null | undefined) ?? null,
    }
  })

  // Aggregate stats across all characters
  const totalCharacters = enrichedCharacters.length
  const aliveCount = enrichedCharacters.filter((c) => c.status === "alive").length
  const deadCount = totalCharacters - aliveCount
  const totalXp = enrichedCharacters.reduce((sum, c) => sum + (c.xp ?? 0), 0)
  const deepestFloor = enrichedCharacters.reduce(
    (max, c) => Math.max(max, c.deepest_floor ?? 0),
    0,
  )
  const totalCompletions = enrichedCharacters.reduce(
    (sum, c) => sum + (c.realms_completed ?? 0),
    0,
  )

  return c.json({
    user: {
      id: account["id"],
      handle: account["handle"],
      wallet: account["wallet_address"],
      player_type: account["player_type"],
      x_handle: account["x_handle"],
      github_handle: account["github_handle"],
      created_at: account["created_at"],
    },
    characters: enrichedCharacters,
    stats: {
      total_characters: totalCharacters,
      alive_count: aliveCount,
      dead_count: deadCount,
      total_xp: totalXp,
      deepest_floor: deepestFloor,
      total_completions: totalCompletions,
    },
  })
})

export { users as userRoutes }
