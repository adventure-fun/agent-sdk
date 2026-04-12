import { Hono } from "hono"
import { REALMS } from "../../engine/index.js"
import { requireAuth } from "../auth.js"
import { createRealm, getCharacterByAccountId, getRealmById, listRealmsForCharacter, regenerateRealm } from "../store.js"

export const realmRoutes = new Hono()

const VALID_TEMPLATES = Object.keys(REALMS)

realmRoutes.get("/mine", requireAuth, (c) => {
  const { account_id } = c.get("session")
  const character = getCharacterByAccountId(account_id)
  if (!character || character.status !== "alive") {
    return c.json({ realms: [] })
  }

  return c.json({ realms: listRealmsForCharacter(character.id) })
})

realmRoutes.post("/generate", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const body = await c.req.json<{ template_id?: string }>()

  if (!body.template_id || !VALID_TEMPLATES.includes(body.template_id)) {
    return c.json({ error: `Invalid template. Choose: ${VALID_TEMPLATES.join(", ")}` }, 400)
  }

  const character = getCharacterByAccountId(account_id)
  if (!character || character.status !== "alive") {
    return c.json({ error: "No living character" }, 404)
  }

  const realm = createRealm(character.id, body.template_id)
  return c.json(realm)
})

realmRoutes.post("/:id/regenerate", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const character = getCharacterByAccountId(account_id)
  if (!character || character.status !== "alive") {
    return c.json({ error: "No living character" }, 404)
  }

  const realmId = c.req.param("id")
  if (!realmId) {
    return c.json({ error: "Realm id is required" }, 400)
  }
  const realm = getRealmById(realmId)
  if (!realm || realm.character_id !== character.id) {
    return c.json({ error: "Realm not found" }, 404)
  }

  if (realm.status !== "completed") {
    return c.json({ error: "Only completed realms can be regenerated" }, 409)
  }

  const regenerated = regenerateRealm(realmId)
  if (!regenerated) {
    return c.json({ error: "Realm not found" }, 404)
  }

  return c.json(regenerated)
})
