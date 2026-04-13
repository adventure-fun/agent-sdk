import { Hono } from "hono"
import { CLASSES, type CharacterClass } from "../../engine/index.js"
import { requireAuth } from "../auth.js"
import { createCharacter, getCharacterByAccountId } from "../store.js"

export const characterRoutes = new Hono()

const VALID_CLASSES = Object.keys(CLASSES) as CharacterClass[]

function serializeCharacter(character: ReturnType<typeof getCharacterByAccountId> extends infer T ? Exclude<T, null> : never) {
  const { inventory: _inventory, equipment: _equipment, ...publicCharacter } = character
  return publicCharacter
}

characterRoutes.get("/me", requireAuth, (c) => {
  const { account_id } = c.get("session")
  const character = getCharacterByAccountId(account_id)
  if (!character || character.status !== "alive") {
    return c.json({ error: "No living character" }, 404)
  }

  return c.json({
    ...serializeCharacter(character),
    lore_discovered: character.lore_discovered ?? [],
  })
})

characterRoutes.post("/roll", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const body = await c.req.json<{
    class?: string
    name?: string
    // Dev-only test hook: pin any subset of rolled stats to a fixed value.
    // Used by the protocol-coverage integration test so turn-time RNG is
    // the only remaining source of variance (which we kill with a seeded
    // realm in /realms/generate).
    stats?: Partial<{
      hp: number
      attack: number
      defense: number
      accuracy: number
      evasion: number
      speed: number
    }>
  }>()

  if (!body.class || !VALID_CLASSES.includes(body.class as CharacterClass)) {
    return c.json({ error: `Invalid class. Choose: ${VALID_CLASSES.join(", ")}` }, 400)
  }

  if (!body.name || body.name.trim().length < 2 || body.name.trim().length > 24) {
    return c.json({ error: "Name must be 2-24 characters" }, 400)
  }

  try {
    const character = createCharacter(
      account_id,
      body.class as CharacterClass,
      body.name,
      body.stats ? { statsOverride: body.stats } : {},
    )
    return c.json(serializeCharacter(character))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to create character" }, 409)
  }
})
