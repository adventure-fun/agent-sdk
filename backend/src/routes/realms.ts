import { Hono } from "hono"
import { db } from "../db/client.js"
import { requireAuth } from "../auth/middleware.js"
import { REALMS } from "@adventure-fun/engine"
import { cleanupRealmForRegeneration } from "./realm-helpers.js"
import { getRequestedNetworks, logPayment, return402, verifyAndSettle } from "../payments/x402.js"

const realms = new Hono()
const TUTORIAL_TEMPLATE_ID = "tutorial-cellar"

// Derive valid templates from engine content
const VALID_TEMPLATES = Object.keys(REALMS)
const TEMPLATE_VERSIONS: Record<string, number> = Object.fromEntries(
  Object.values(REALMS).map((r) => [r.id, r.version ?? 1]),
)

// GET /realms/mine
realms.get("/mine", requireAuth, async (c) => {
  const { account_id } = c.get("session")

  const { data: character } = await db
    .from("characters")
    .select("id")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (!character) return c.json({ realms: [] })

  const { data, error } = await db
    .from("realm_instances")
    .select("*")
    .eq("character_id", character.id)
    .order("created_at", { ascending: false })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ realms: data })
})

// POST /realms/generate — first realm free, then x402
realms.post("/generate", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const body = await c.req.json<{ template_id: string }>()

  if (!VALID_TEMPLATES.includes(body.template_id)) {
    return c.json({ error: `Invalid template. Choose: ${VALID_TEMPLATES.join(", ")}` }, 400)
  }

  // Get living character
  const { data: character } = await db
    .from("characters")
    .select("id")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (!character) return c.json({ error: "No living character" }, 404)

  const isTutorialTemplate = body.template_id === TUTORIAL_TEMPLATE_ID

  if (!isTutorialTemplate) {
    const { data: tutorialCompletion } = await db
      .from("realm_instances")
      .select("id")
      .eq("character_id", character.id)
      .eq("template_id", TUTORIAL_TEMPLATE_ID)
      .eq("status", "completed")
      .maybeSingle()

    if (!tutorialCompletion) {
      return c.json({ error: "Complete the tutorial first" }, 403)
    }
  }

  // Check if already has this realm
  const { data: existingRealm } = await db
    .from("realm_instances")
    .select("id, status")
    .eq("character_id", character.id)
    .eq("template_id", body.template_id)
    .maybeSingle()

  if (existingRealm && existingRealm.status !== "completed" && existingRealm.status !== "dead_end") {
    return c.json({ error: "Realm already exists for this character", realm: existingRealm }, 409)
  }

  // Check free realm
  const { data: account } = await db
    .from("accounts")
    .select("free_realm_used")
    .eq("id", account_id)
    .single()

  const isFree = isTutorialTemplate || !account?.free_realm_used

  const networks = getRequestedNetworks(c)
  let settledPayment = null as Awaited<ReturnType<typeof verifyAndSettle>>
  if (!isFree) {
    settledPayment = await verifyAndSettle(c, "realm_generate", networks)
    if (!settledPayment) {
      return return402(c, "realm_generate", networks)
    }
  }

  // Generate realm with random seed
  const seed = Math.floor(Math.random() * 2 ** 32)
  const templateVersion = TEMPLATE_VERSIONS[body.template_id] ?? 1

  const { data: realm, error } = await db
    .from("realm_instances")
    .insert({
      character_id: character.id,
      template_id: body.template_id,
      template_version: templateVersion,
      seed,
      status: "generated",
      floor_reached: 1,
      is_free: isFree,
    })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)

  // Mark free realm as used
  if (isFree && !account?.free_realm_used) {
    await db.from("accounts").update({ free_realm_used: true }).eq("id", account_id)
  } else if (settledPayment) {
    Object.entries(settledPayment.headers).forEach(([key, value]) => c.header(key, value))
    await logPayment(account_id, settledPayment)
  }

  // Initialize discovered map for floor 1
  await db.from("realm_discovered_map").insert({
    realm_instance_id: realm.id,
    floor: 1,
    discovered_tiles: [],
  })

  return c.json(realm, 201)
})

// POST /realms/:id/regenerate — completed realms only, x402 + gold
realms.post("/:id/regenerate", requireAuth, async (c) => {
  const { account_id } = c.get("session")
  const realmId = c.req.param("id")!

  const { data: character } = await db
    .from("characters")
    .select("id, gold")
    .eq("account_id", account_id)
    .eq("status", "alive")
    .maybeSingle()

  if (!character) return c.json({ error: "No living character" }, 404)

  const { data: realm } = await db
    .from("realm_instances")
    .select("*")
    .eq("id", realmId)
    .eq("character_id", character.id)
    .maybeSingle()

  if (!realm) return c.json({ error: "Realm not found" }, 404)
  if (realm.status !== "completed") {
    return c.json({ error: "Only completed realms can be regenerated" }, 409)
  }
  if (REALMS[realm.template_id]?.is_tutorial) {
    return c.json({ error: "Tutorial realms cannot be replayed" }, 403)
  }

  const REGEN_GOLD_COST = 100
  if (character.gold < REGEN_GOLD_COST) {
    return c.json({ error: `Requires ${REGEN_GOLD_COST} gold`, gold: character.gold }, 400)
  }

  const regenNetworks = getRequestedNetworks(c)
  const settledPayment = await verifyAndSettle(c, "realm_regen", regenNetworks)
  if (!settledPayment) {
    return return402(c, "realm_regen", regenNetworks)
  }

  const newSeed = Math.floor(Math.random() * 2 ** 32)

  const [{ data: updated }, _] = await Promise.all([
    db.from("realm_instances")
      .update({ seed: newSeed, status: "generated", floor_reached: 1 })
      .eq("id", realmId)
      .select()
      .single(),
    db.from("characters")
      .update({ gold: character.gold - REGEN_GOLD_COST })
      .eq("id", character.id),
  ])

  await cleanupRealmForRegeneration(db, realmId)

  Object.entries(settledPayment.headers).forEach(([key, value]) => c.header(key, value))
  await logPayment(account_id, settledPayment)
  return c.json(updated)
})

export { realms as realmRoutes }
