import { Hono } from "hono"
import { db } from "../db/client.js"
import { requireAuth } from "../auth/middleware.js"
import { rollStats, rerollStats, getResourceMax } from "../game/stats.js"
import { validatePerkAllocation, validateSkillAllocation } from "../game/skill-tree.js"
import { CLASSES, PERK_LIST, SKILL_TREES } from "@adventure-fun/engine"
import {
  computePerkPointsRemaining,
  computeTierChoicesAvailable,
  xpForLevel,
  xpToNextLevel,
} from "@adventure-fun/engine"
import type { CharacterClass } from "@adventure-fun/schemas"
import { getRequestedNetworks, logPayment, return402, verifyAndSettle } from "../payments/x402.js"

const characters = new Hono()

const VALID_CLASSES: CharacterClass[] = ["knight", "mage", "rogue", "archer"]

// GET /characters/me
characters.get("/me", requireAuth, async (c) => {
  const { account_id } = c.get("session")

  const { data, error } = await db
    .from("characters")
    .select("*")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: "No living character" }, 404)
  const { data: loreRows, error: loreError } = await db
    .from("lore_discovered")
    .select("*")
    .eq("character_id", data.id)
    .order("discovered_at_turn")

  if (loreError) return c.json({ error: loreError.message }, 500)
  return c.json({
    ...data,
    lore_discovered: (loreRows ?? []).map((row) => ({
      lore_entry_id: row.lore_entry_id,
      discovered_at_turn: row.discovered_at_turn,
    })),
  })
})

// POST /characters/roll — free, one alive character per account
characters.post("/roll", requireAuth, async (c) => {
  const { account_id } = c.get("session")

  // Check for existing alive character
  const { data: existing } = await db
    .from("characters")
    .select("id")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (existing) {
    return c.json({ error: "You already have a living character. They must die first." }, 409)
  }

  const body = await c.req.json<{ class: string; name: string }>()
  const cls = body.class as CharacterClass

  if (!VALID_CLASSES.includes(cls)) {
    return c.json({ error: `Invalid class. Choose: ${VALID_CLASSES.join(", ")}` }, 400)
  }
  if (!body.name || body.name.length < 2 || body.name.length > 24) {
    return c.json({ error: "Name must be 2-24 characters" }, 400)
  }

  const stats = rollStats(cls)
  const resourceMax = getResourceMax(cls)

  const { data, error } = await db
    .from("characters")
    .insert({
      account_id,
      name: body.name.trim(),
      class: cls,
      level: 1,
      xp: 0,
      gold: 50, // starting gold
      hp_current: stats.hp,
      hp_max: stats.hp,
      resource_current: resourceMax,
      resource_max: resourceMax,
      stats,
      skill_tree: {},
      perks: {},
      status: "alive",
      stat_rerolled: false,
    })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data, 201)
})

// POST /characters/reroll-stats — x402 gated, once per character
characters.post("/reroll-stats", requireAuth, async (c) => {
  const { account_id } = c.get("session")

  const { data: character, error: fetchErr } = await db
    .from("characters")
    .select("*")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (fetchErr) return c.json({ error: fetchErr.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)
  if (character.stat_rerolled) {
    return c.json({ error: "Stats already rerolled. Once per character." }, 409)
  }

  const networks = getRequestedNetworks(c)
  const settledPayment = await verifyAndSettle(c, "stat_reroll", networks)
  if (!settledPayment) {
    return return402(c, "stat_reroll", networks)
  }

  const newStats = rerollStats(character.class as CharacterClass)

  const { data, error } = await db
    .from("characters")
    .update({
      stats: newStats,
      hp_current: newStats.hp,
      hp_max: newStats.hp,
      stat_rerolled: true,
    })
    .eq("id", character.id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  Object.entries(settledPayment.headers).forEach(([key, value]) => c.header(key, value))
  await logPayment(account_id, settledPayment)
  return c.json(data)
})

// GET /characters/progression — returns skill tree + perk template + XP curve info
characters.get("/progression", requireAuth, async (c) => {
  const { account_id } = c.get("session")

  const { data: character, error } = await db
    .from("characters")
    .select("class, level, xp, skill_tree, perks")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)

  const cls = character.class as CharacterClass
  const classTemplate = CLASSES[cls]
  const treeId = (classTemplate as Record<string, unknown>).skill_tree_id as string | undefined
  const tree = treeId ? SKILL_TREES[treeId] : classTemplate?.skill_tree

  const currentTree = (character.skill_tree ?? {}) as Record<string, boolean>
  const currentPerks = (character.perks ?? {}) as Record<string, number>
  const perkPointsRemaining = computePerkPointsRemaining({
    level: character.level,
    perks: currentPerks,
  })
  const tierChoicesAvailable = computeTierChoicesAvailable({
    level: character.level,
    class: cls,
    skill_tree: currentTree,
  })

  return c.json({
    level: character.level,
    xp: character.xp,
    xp_to_next_level: xpToNextLevel(character.xp, character.level),
    xp_for_next_level: xpForLevel(character.level + 1),
    skill_points: perkPointsRemaining,
    tier_choices_available: tierChoicesAvailable,
    skill_tree_template: tree ?? null,
    skill_tree_unlocked: currentTree,
    perks_template: PERK_LIST,
    perks_unlocked: currentPerks,
  })
})

// POST /characters/skill — spend a skill point to unlock a skill tree node
characters.post("/skill", requireAuth, async (c) => {
  const { account_id } = c.get("session")

  const { data: character, error: fetchErr } = await db
    .from("characters")
    .select("*")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (fetchErr) return c.json({ error: fetchErr.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)

  const body = await c.req.json<{ node_id: string }>()
  if (!body.node_id || typeof body.node_id !== "string") {
    return c.json({ error: "node_id is required" }, 400)
  }

  const currentTree = (character.skill_tree ?? {}) as Record<string, boolean>
  const result = validateSkillAllocation(
    character.class as CharacterClass,
    character.level,
    currentTree,
    body.node_id,
  )

  if (!result.ok) {
    return c.json({ error: result.error }, 400)
  }

  const updatedTree = { ...currentTree, [body.node_id]: true }
  const { data, error } = await db
    .from("characters")
    .update({ skill_tree: updatedTree })
    .eq("id", character.id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// POST /characters/perk — spend 1 perk point to buy one more stack of a shared perk
characters.post("/perk", requireAuth, async (c) => {
  const { account_id } = c.get("session")

  const { data: character, error: fetchErr } = await db
    .from("characters")
    .select("*")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (fetchErr) return c.json({ error: fetchErr.message }, 500)
  if (!character) return c.json({ error: "No living character" }, 404)

  const body = await c.req.json<{ perk_id: string }>()
  if (!body.perk_id || typeof body.perk_id !== "string") {
    return c.json({ error: "perk_id is required" }, 400)
  }

  const currentPerks = (character.perks ?? {}) as Record<string, number>
  const result = validatePerkAllocation(character.level, currentPerks, body.perk_id)
  if (!result.ok) {
    return c.json({ error: result.error }, 400)
  }

  const updatedPerks = {
    ...currentPerks,
    [body.perk_id]: (currentPerks[body.perk_id] ?? 0) + 1,
  }
  const { data, error } = await db
    .from("characters")
    .update({ perks: updatedPerks })
    .eq("id", character.id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})
  
// ── Public character detail ──────────────────────────────────────────────────
// GET /characters/public/:id
//
// Reads one character by ID with owner info, inventory, and current/paused
// realm (if alive). Powers the /character/[id] route on the frontend. No
// auth required — this is a public profile.
//
// Note the `/public/` prefix: characters also has a param-style `/me` and
// `/progression` above, and Hono's trie routing would route a bare `/:id`
// ahead of those. The `/public/` prefix sidesteps the collision without
// introducing ambiguity for existing callers.
characters.get("/public/:id", async (c) => {
  const id = c.req.param("id")
  if (!id) return c.json({ error: "Character id is required" }, 400)

  const { data: character, error: charErr } = await db
    .from("characters")
    .select(`
      id, name, class, level, xp, gold,
      hp_current, hp_max, resource_current, resource_max,
      stats, skill_tree, status, stat_rerolled,
      created_at, died_at,
      account_id,
      accounts (
        id, wallet_address, handle, player_type, x_handle, github_handle
      )
    `)
    .eq("id", id)
    .maybeSingle()

  if (charErr) return c.json({ error: charErr.message }, 500)
  if (!character) return c.json({ error: "Character not found" }, 404)

  // Lore discovered
  const { data: loreRows } = await db
    .from("lore_discovered")
    .select("lore_entry_id, discovered_at_turn")
    .eq("character_id", id)
    .order("discovered_at_turn")

  // Inventory (equipped + bag)
  const { data: inventoryRows } = await db
    .from("inventory_items")
    .select("id, template_id, quantity, modifiers, slot")
    .eq("owner_type", "character")
    .eq("owner_id", id)

  // Current realm (alive only — latest active or paused)
  let currentRealm: Record<string, unknown> | null = null
  if (character.status === "alive") {
    const { data: realm } = await db
      .from("realm_instances")
      .select("id, template_id, status, floor_reached, created_at")
      .eq("character_id", id)
      .in("status", ["active", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    currentRealm = realm ?? null
  }

  // Realms completed total (for stat summary)
  const { data: completedRealms } = await db
    .from("realm_instances")
    .select("id", { count: "exact" })
    .eq("character_id", id)
    .eq("status", "completed")

  // Leaderboard snapshot — issue #6 says the character page should have
  // "all information about a character", so we pull the denormalized
  // stats that chat/leaderboard are already computed from: deepest
  // floor, realms_completed, cause_of_death. Alive characters usually
  // have a row here too because the engine upserts on every turn's XP
  // gain.
  const { data: leaderboardRow } = await db
    .from("leaderboard_entries")
    .select("deepest_floor, realms_completed, cause_of_death, died_at")
    .eq("character_id", id)
    .maybeSingle()

  return c.json({
    character: {
      id: character.id,
      name: character.name,
      class: character.class,
      level: character.level,
      xp: character.xp,
      gold: character.gold,
      hp_current: character.hp_current,
      hp_max: character.hp_max,
      resource_current: character.resource_current,
      resource_max: character.resource_max,
      stats: character.stats,
      skill_tree: character.skill_tree,
      status: character.status,
      stat_rerolled: character.stat_rerolled,
      created_at: character.created_at,
      died_at: character.died_at,
    },
    owner: character.accounts
      ? {
          id: (character.accounts as Record<string, unknown>).id,
          handle: (character.accounts as Record<string, unknown>).handle,
          wallet: (character.accounts as Record<string, unknown>).wallet_address,
          player_type: (character.accounts as Record<string, unknown>).player_type,
          x_handle: (character.accounts as Record<string, unknown>).x_handle,
          github_handle: (character.accounts as Record<string, unknown>).github_handle,
        }
      : null,
    inventory: inventoryRows ?? [],
    lore_discovered: loreRows ?? [],
    current_realm: currentRealm,
    realms_completed: completedRealms?.length ?? 0,
    // Issue #6 — extra stats for feature parity with the legend page.
    // All nullable because leaderboard_entries is upserted lazily on
    // turn resolution and a brand-new character may not have a row
    // yet.
    history: leaderboardRow
      ? {
          deepest_floor: (leaderboardRow as Record<string, unknown>).deepest_floor ?? null,
          cause_of_death: (leaderboardRow as Record<string, unknown>).cause_of_death ?? null,
        }
      : null,
  })
})

export { characters as characterRoutes }
