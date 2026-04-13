import { Hono } from "hono"
import type { CharacterClass, LeaderboardEntry, PlayerType } from "@adventure-fun/schemas"
import { db } from "../db/client.js"

const leaderboard = new Hono()

const VALID_TYPES = ["xp", "level", "floor", "completions"] as const
const VALID_PLAYER_TYPES: PlayerType[] = ["human", "agent"]
const VALID_CLASSES: CharacterClass[] = ["knight", "mage", "rogue", "archer"]

type LeaderboardType = (typeof VALID_TYPES)[number]

function clampNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function mapLeaderboardEntry(row: Record<string, unknown>): LeaderboardEntry {
  return {
    character_id: String(row.character_id ?? ""),
    character_name: String(row.character_name ?? ""),
    class: row.class as CharacterClass,
    player_type: row.player_type as PlayerType,
    level: Number(row.level ?? 0),
    xp: Number(row.xp ?? 0),
    deepest_floor: Number(row.deepest_floor ?? 0),
    realms_completed: Number(row.realms_completed ?? 0),
    status: (row.status as LeaderboardEntry["status"]) ?? "alive",
    cause_of_death: (row.cause_of_death as string | null) ?? null,
    owner: {
      handle: String(row.owner_handle ?? ""),
      wallet: String(row.owner_wallet ?? ""),
      x_handle: (row.x_handle as string | null) ?? null,
      github_handle: (row.github_handle as string | null) ?? null,
    },
    created_at: String(row.created_at ?? ""),
    died_at: (row.died_at as string | null) ?? null,
  }
}

function applyOrdering(
  query: ReturnType<typeof db.from>,
  type: LeaderboardType,
) {
  switch (type) {
    case "xp":
      return query.order("xp", { ascending: false }).order("level", { ascending: false })
    case "level":
      return query.order("level", { ascending: false }).order("xp", { ascending: false })
    case "floor":
      return query.order("deepest_floor", { ascending: false }).order("xp", { ascending: false })
    case "completions":
      return query.order("realms_completed", { ascending: false }).order("xp", { ascending: false })
  }
}

// GET /leaderboard/character/:id — public single character lookup
leaderboard.get("/character/:id", async (c) => {
  const { id } = c.req.param()
  const { data, error } = await db
    .from("leaderboard_entries")
    .select("*")
    .eq("character_id", id)
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: "Character not found" }, 404)

  return c.json({ entry: mapLeaderboardEntry(data as Record<string, unknown>) })
})

// GET /leaderboard/search?q=name — public character search by name
leaderboard.get("/search", async (c) => {
  const q = c.req.query("q")?.trim()
  if (!q || q.length < 1) {
    return c.json({ error: "Query parameter 'q' is required" }, 400)
  }

  const { data, error } = await db
    .from("leaderboard_entries")
    .select("*")
    .ilike("character_name", `%${q}%`)
    .order("xp", { ascending: false })
    .limit(10)

  if (error) return c.json({ error: error.message }, 500)

  const rows = Array.isArray(data) ? data : []
  return c.json({
    results: rows.map((row) => mapLeaderboardEntry(row as Record<string, unknown>)),
  })
})

// GET /leaderboard/hall-of-fame — public
leaderboard.get("/hall-of-fame", async (c) => {
  const { data, error } = await db
    .from("hall_of_fame")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ events: data ?? [] })
})

// GET /leaderboard/legends/:characterId — public alias
leaderboard.get("/legends/:characterId", async (c) => {
  const { characterId } = c.req.param()
  return c.redirect(`/legends/${characterId}`, 307)
})

// GET /leaderboard/:type — public
leaderboard.get("/:type", async (c) => {
  const { type } = c.req.param()
  const typeValue = VALID_TYPES.find((value) => value === type)
  if (!typeValue) {
    return c.json({ error: `Invalid leaderboard type. Choose: ${VALID_TYPES.join(", ")}` }, 400)
  }

  const query = c.req.query()
  const playerType = query.player_type
  const classFilter = query.class
  if (playerType && !VALID_PLAYER_TYPES.includes(playerType as PlayerType)) {
    return c.json({ error: `Invalid player_type. Choose: ${VALID_PLAYER_TYPES.join(", ")}` }, 400)
  }
  if (classFilter && !VALID_CLASSES.includes(classFilter as CharacterClass)) {
    return c.json({ error: `Invalid class. Choose: ${VALID_CLASSES.join(", ")}` }, 400)
  }

  const limit = clampNumber(query.limit, 50, 1, 100)
  const offset = clampNumber(query.offset, 0, 0, 10_000)

  // Opt-in alive-only filter (issue #8). Clients pass `?alive_only=true`
  // to hide dead characters from the table. We accept several truthy
  // strings so the query-string can be built by hand as well as by the
  // JS hook.
  const aliveOnly = ["1", "true", "yes"].includes((query.alive_only ?? "").toLowerCase())

  // Leaderboard gating for unconfirmed anon handles. By default we only
  // show characters whose owner has confirmed their handle — either by
  // editing it to something custom or by explicitly acknowledging the
  // auto-assigned anon handle on their profile page. Admins can pass
  // `?include_unconfirmed=true` to bypass this filter, but there is no
  // UI path to that flag and it isn't documented externally.
  //
  // Implementation: leaderboard_entries is denormalized from characters
  // and doesn't carry the account's confirmed flag, so we fetch the
  // set of confirmed account ids first and then filter the character
  // query by joining through characters.account_id. For the tiny user
  // counts we have today this is a trivial two-query path; if
  // leaderboard scale becomes a real concern we can later denormalize
  // handle_confirmed onto leaderboard_entries and upsert it from the
  // turn resolver.
  const includeUnconfirmed = ["1", "true", "yes"]
    .includes((query.include_unconfirmed ?? "").toLowerCase())

  let dbQuery = db.from("leaderboard_entries").select("*")
  if (playerType) {
    dbQuery = dbQuery.eq("player_type", playerType)
  }
  if (classFilter) {
    dbQuery = dbQuery.eq("class", classFilter)
  }
  if (aliveOnly) {
    dbQuery = dbQuery.eq("status", "alive")
  }

  // Build an allowlist of character_ids whose owner is confirmed, unless
  // the caller explicitly opted out. This happens in a second query so
  // we don't have to declare a PostgREST embedded join on
  // leaderboard_entries, which requires a foreign-key relationship the
  // table wasn't originally designed for.
  if (!includeUnconfirmed) {
    const { data: confirmedChars, error: confirmedErr } = await db
      .from("characters")
      .select("id, accounts!inner(handle_confirmed)")
      .eq("accounts.handle_confirmed", true)
    if (confirmedErr) return c.json({ error: confirmedErr.message }, 500)
    const confirmedIds = (confirmedChars ?? []).map((r) => (r as Record<string, unknown>).id as string)
    if (confirmedIds.length === 0) {
      // No confirmed accounts exist yet — short-circuit with an empty
      // response instead of issuing an `in ()` query that Postgres
      // would reject.
      return c.json({
        entries: [],
        total: 0,
        limit,
        offset,
        type: typeValue,
      })
    }
    dbQuery = dbQuery.in("character_id", confirmedIds)
  }

  const { data, error } = await applyOrdering(dbQuery, typeValue)

  if (error) return c.json({ error: error.message }, 500)

  const rows = Array.isArray(data) ? data : []
  const paginatedRows = rows.slice(offset, offset + limit)

  return c.json({
    entries: paginatedRows.map((row) => mapLeaderboardEntry(row as Record<string, unknown>)),
    total: rows.length,
    limit,
    offset,
    type: typeValue,
  })
})

export { leaderboard as leaderboardRoutes }
