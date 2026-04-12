import { describe, expect, it } from "bun:test"
import { Hono } from "hono"
import { contentRoutes } from "../src/routes/content.js"
import { ABILITIES, CLASSES } from "@adventure-fun/engine"

function mountContent() {
  const app = new Hono()
  app.route("/content", contentRoutes)
  return app
}

describe("15.2 — content ability templates", () => {
  it("GET /content/abilities returns full AbilityTemplate fields for every registry entry", async () => {
    const app = mountContent()
    const res = await app.request("http://example.test/content/abilities")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { abilities: unknown[] }
    expect(Array.isArray(body.abilities)).toBe(true)
    expect(body.abilities.length).toBe(Object.keys(ABILITIES).length)

    const ids = body.abilities.map((a) => (a as { id: string }).id).sort()
    expect(ids).toEqual(Object.keys(ABILITIES).sort())

    for (const raw of body.abilities) {
      const a = raw as Record<string, unknown>
      expect(typeof a["id"]).toBe("string")
      expect(typeof a["name"]).toBe("string")
      expect(typeof a["description"]).toBe("string")
      expect(typeof a["resource_cost"]).toBe("number")
      expect(typeof a["cooldown_turns"]).toBe("number")
      expect(["string", "number"].includes(typeof a["range"])).toBe(true)
      expect(Array.isArray(a["effects"])).toBe(true)
      expect(typeof a["target"]).toBe("string")
      const df = a["damage_formula"] as Record<string, unknown> | undefined
      expect(df).toBeDefined()
      expect(typeof df!["base"]).toBe("number")
      expect(typeof df!["stat_scaling"]).toBe("string")
      expect(typeof df!["scaling_factor"]).toBe("number")
    }
  })

  it("GET /content/classes/:id/abilities returns full templates for starting abilities", async () => {
    const app = mountContent()
    const res = await app.request("http://example.test/content/classes/knight/abilities")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { abilities: unknown[] }
    const knight = CLASSES["knight"]
    expect(body.abilities.length).toBe((knight?.starting_abilities ?? []).length)

    for (const raw of body.abilities) {
      const a = raw as Record<string, unknown>
      expect(a["damage_formula"]).toBeDefined()
      expect(Array.isArray(a["effects"])).toBe(true)
      expect(a["target"]).toBeDefined()
    }
  })

  it("GET /content/classes/:id/abilities 404 for unknown class", async () => {
    const app = mountContent()
    const res = await app.request("http://example.test/content/classes/not-a-class/abilities")
    expect(res.status).toBe(404)
  })
})
