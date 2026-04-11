import { Hono } from "hono"
import { CLASSES, ITEMS, REALMS } from "../../engine/index.js"

export const contentRoutes = new Hono()

contentRoutes.get("/realms", (c) => {
  const templates = Object.values(REALMS)
    .map((realm) => ({
      id: realm.id,
      orderIndex: realm.orderIndex ?? 99,
      name: realm.name,
      description: realm.description,
      theme: realm.theme,
      difficulty_tier: realm.difficulty_tier,
      floor_count: realm.floor_count,
      is_tutorial: realm.is_tutorial ?? false,
    }))
    .sort((left, right) => left.orderIndex - right.orderIndex)

  return c.json({ templates })
})

contentRoutes.get("/classes", (c) => {
  const classes = Object.values(CLASSES).map((classTemplate) => ({
    id: classTemplate.id,
    name: classTemplate.name,
    description: (classTemplate as { description?: string }).description ?? null,
    resource_type: classTemplate.resource_type,
    resource_max: classTemplate.resource_max,
    stat_roll_ranges: classTemplate.stat_roll_ranges,
    visibility_radius: classTemplate.visibility_radius,
  }))

  return c.json({ classes })
})

contentRoutes.get("/items", (c) => {
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
    }))

  return c.json({ items })
})
