import { Hono } from "hono"
import { REALMS, CLASSES, ABILITIES, SKILL_TREES } from "@adventure-fun/engine"

const content = new Hono()

// GET /content/realms — realm template metadata (no auth required)
content.get("/realms", (c) => {
  const templates = Object.values(REALMS).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    theme: r.theme,
    difficulty_tier: r.difficulty_tier,
    floor_count: r.floor_count,
    is_tutorial: r.is_tutorial ?? false,
  }))
  return c.json({ templates })
})

// GET /content/classes — class template metadata (no auth required)
content.get("/classes", (c) => {
  const classes = Object.values(CLASSES).map((cls) => ({
    id: cls.id,
    name: cls.name,
    description: cls.description,
    resource_type: cls.resource_type,
    stat_roll_ranges: cls.stat_roll_ranges,
    visibility_radius: cls.visibility_radius,
  }))
  return c.json({ classes })
})

// GET /content/classes/:id/abilities — abilities for a class (no auth required)
content.get("/classes/:id/abilities", (c) => {
  const classId = c.req.param("id")
  const cls = CLASSES[classId]
  if (!cls) return c.json({ error: `Unknown class: ${classId}` }, 404)

  const abilityIds = cls.starting_abilities ?? []
  const abilities = abilityIds
    .map((id) => ABILITIES[id])
    .filter(Boolean)
    .map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      resource_cost: a.resource_cost,
      cooldown_turns: a.cooldown_turns,
      range: a.range,
      target: a.target,
    }))

  return c.json({ abilities })
})

// GET /content/classes/:id/skill-tree — skill tree for a class (no auth required)
content.get("/classes/:id/skill-tree", (c) => {
  const classId = c.req.param("id")
  const cls = CLASSES[classId]
  if (!cls) return c.json({ error: `Unknown class: ${classId}` }, 404)

  // Try separate skill tree file first, fall back to inline
  const treeId = (cls as Record<string, unknown>).skill_tree_id as string | undefined
  const tree = treeId ? SKILL_TREES[treeId] : undefined
  const tiers = tree?.tiers ?? cls.skill_tree?.tiers ?? []

  return c.json({ class_id: classId, tiers })
})

export { content as contentRoutes }
