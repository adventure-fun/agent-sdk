import { Hono } from "hono"
import { db } from "../db/client.js"
import { requireAuth } from "../auth/middleware.js"
import { rollStats, rerollStats, getResourceMax } from "../game/stats.js"
import { validateSkillAllocation } from "../game/skill-tree.js"
import { CLASSES, SKILL_TREES } from "@adventure-fun/engine"
import { xpForLevel, xpToNextLevel } from "@adventure-fun/engine"
import type { CharacterClass } from "@adventure-fun/schemas"

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
  return c.json(data)
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

  // TODO: x402 payment gate
  // For now: check X-Payment-Proof header (stub)
  const proof = c.req.header("X-Payment-Proof")
  if (!proof) {
    return c.json(
      { error: "Payment required", action: "stat_reroll", price_usd: "0.10" },
      402,
    )
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
  return c.json(data)
})

// GET /characters/progression — returns skill tree template + XP curve info for the character
characters.get("/progression", requireAuth, async (c) => {
  const { account_id } = c.get("session")

  const { data: character, error } = await db
    .from("characters")
    .select("class, level, xp, skill_tree")
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
  const spentPoints = Object.keys(currentTree).length
  const availablePoints = Math.max(0, (character.level - 1) - spentPoints)

  return c.json({
    level: character.level,
    xp: character.xp,
    xp_to_next_level: xpToNextLevel(character.xp, character.level),
    xp_for_next_level: xpForLevel(character.level + 1),
    skill_points: availablePoints,
    skill_tree_template: tree ?? null,
    skill_tree_unlocked: currentTree,
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

export { characters as characterRoutes }
