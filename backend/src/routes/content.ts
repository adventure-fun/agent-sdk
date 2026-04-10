import { Hono } from "hono"
import { REALMS, CLASSES, ABILITIES, ITEMS, SKILL_TREES, LORE } from "@adventure-fun/engine"

const content = new Hono()

// GET /content/realms — realm template metadata (no auth required)
content.get("/realms", (c) => {
  const templates = Object.values(REALMS)
    .map((r) => ({
      id: r.id,
      orderIndex: r.orderIndex ?? 99,
      name: r.name,
      description: r.description,
      theme: r.theme,
      difficulty_tier: r.difficulty_tier,
      floor_count: r.floor_count,
      is_tutorial: r.is_tutorial ?? false,
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex)
  return c.json({ templates })
})

// GET /content/classes — class template metadata (no auth required)
content.get("/classes", (c) => {
  const classes = Object.values(CLASSES).map((cls) => ({
    id: cls.id,
    name: cls.name,
    description: cls.description,
    resource_type: cls.resource_type,
    resource_max: cls.resource_max,
    stat_roll_ranges: cls.stat_roll_ranges,
    visibility_radius: cls.visibility_radius,
  }))
  return c.json({ classes })
})

// GET /content/items — item template metadata (no auth required)
content.get("/items", (c) => {
  const items = Object.values(ITEMS)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      type: item.type,
      rarity: item.rarity,
      equip_slot: item.equip_slot ?? null,
      class_restriction: item.class_restriction ?? null,
      stats: item.stats ?? {},
      effects: item.effects ?? [],
      stack_limit: item.stack_limit,
      sell_price: item.sell_price,
      buy_price: item.buy_price,
      range: "range" in item && typeof item.range === "number" ? item.range : undefined,
    }))
  return c.json({ items })
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

// GET /content/lore — lore entry names and text (no auth required)
content.get("/lore", (c) => {
  const entries = Object.values(LORE).map((entry) => ({
    id: entry.id,
    name: entry.name,
    text: entry.text,
  }))
  return c.json({ entries })
})

export { content as contentRoutes }
