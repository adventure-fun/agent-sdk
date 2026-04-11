import { Hono } from "hono"
import { REALMS } from "../../engine/index.js"
import { requireAuth } from "../auth.js"
import { createRealm, getCharacterByAccountId, listRealmsForCharacter } from "../store.js"

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
