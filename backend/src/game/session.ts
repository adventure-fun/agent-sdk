import type { ServerWebSocket } from "bun"
import type { Action, Observation, CharacterStats } from "@adventure-fun/schemas"
import { resolveAttack, generateRealm, SeededRng } from "@adventure-fun/engine"
import { db } from "../db/client.js"
import type { SessionPayload } from "../auth/jwt.js"

const TURN_TIMEOUT_MS = (Number(process.env["TURN_TIMEOUT_SECONDS"] ?? 30)) * 1000

export interface GameSessionData {
  realmId: string
  session: SessionPayload
  characterId: string
  turnTimer?: ReturnType<typeof setTimeout>
}

/** Map of characterId → active WebSocket */
export const activeSessions = new Map<string, ServerWebSocket<GameSessionData>>()

export async function handleGameOpen(ws: ServerWebSocket<GameSessionData>) {
  const { realmId, characterId } = ws.data
  activeSessions.set(characterId, ws)

  const obs = await buildObservation(realmId, characterId)
  if (!obs) {
    ws.send(JSON.stringify({ type: "error", message: "Failed to load realm state" }))
    ws.close()
    return
  }

  ws.send(JSON.stringify({ type: "observation", data: obs }))
  startTurnTimer(ws)
}

export async function handleGameMessage(
  ws: ServerWebSocket<GameSessionData>,
  message: string | Buffer,
) {
  clearTurnTimer(ws)

  let parsed: { type: string; data: Action }
  try {
    parsed = JSON.parse(message.toString())
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
    startTurnTimer(ws)
    return
  }

  if (parsed.type !== "action") {
    ws.send(JSON.stringify({ type: "error", message: "Expected action message" }))
    startTurnTimer(ws)
    return
  }

  const { realmId, characterId } = ws.data
  const result = await processTurn(realmId, characterId, parsed.data)

  if (result.type === "death") {
    ws.send(JSON.stringify({ type: "death", data: result.data }))
    activeSessions.delete(characterId)
    ws.close()
    return
  }

  if (result.type === "extracted") {
    ws.send(JSON.stringify({ type: "extracted", data: result.data }))
    activeSessions.delete(characterId)
    ws.close()
    return
  }

  ws.send(JSON.stringify({ type: "observation", data: result.observation }))
  startTurnTimer(ws)
}

export function handleGameClose(ws: ServerWebSocket<GameSessionData>) {
  clearTurnTimer(ws)
  activeSessions.delete(ws.data.characterId)
}

// ── Turn processing ───────────────────────────────────────────────────────────

async function processTurn(
  realmId: string,
  characterId: string,
  action: Action,
): Promise<
  | { type: "observation"; observation: Observation }
  | { type: "death"; data: { cause: string; floor: number; room: string; turn: number } }
  | { type: "extracted"; data: { loot_summary: unknown[]; xp_gained: number } }
> {
  // Load current state
  const [{ data: realm }, { data: character }, { data: mutations }] = await Promise.all([
    db.from("realm_instances").select("*").eq("id", realmId).single(),
    db.from("characters").select("*").eq("id", characterId).single(),
    db.from("realm_mutations").select("*").eq("realm_instance_id", realmId).order("id"),
  ])

  if (!realm || !character) {
    return { type: "observation", observation: await buildObservation(realmId, characterId) as Observation }
  }

  // Get current turn number
  const currentTurn = (mutations?.length ?? 0) + 1

  // Validate action and get next state
  // TODO: full turn resolution — for now handle basic moves + wait
  let eventType = "action_taken"
  let eventPayload: Record<string, unknown> = { action, turn: currentTurn }
  let deathResult: { cause: string; floor: number; room: string } | null = null
  let extractResult: { xp_gained: number } | null = null

  // Handle extraction (use_portal or retreat at entrance)
  if (action.type === "use_portal" || action.type === "retreat") {
    const xpGained = Math.floor(character.xp * 0.1) + 50
    await db.from("realm_instances")
      .update({ status: "paused" })
      .eq("id", realmId)
    return { type: "extracted", data: { loot_summary: [], xp_gained: xpGained } }
  }

  // Store mutation
  await db.from("realm_mutations").insert({
    realm_instance_id: realmId,
    entity_id: `turn_${currentTurn}`,
    mutation: eventType,
    turn: currentTurn,
    floor: realm.floor_reached,
    metadata: eventPayload,
  })

  // Store run event
  await db.from("run_events").insert({
    realm_instance_id: realmId,
    turn: currentTurn,
    event_type: eventType,
    payload: eventPayload,
  })

  const obs = await buildObservation(realmId, characterId)
  return { type: "observation", observation: obs as Observation }
}

// ── Observation builder ───────────────────────────────────────────────────────

async function buildObservation(realmId: string, characterId: string): Promise<Observation | null> {
  const [{ data: character }, { data: realm }, { data: inventory }, { data: mutations }] =
    await Promise.all([
      db.from("characters").select("*").eq("id", characterId).single(),
      db.from("realm_instances").select("*").eq("id", realmId).single(),
      db.from("inventory_items")
        .select("*")
        .eq("owner_type", "character")
        .eq("owner_id", characterId),
      db.from("realm_mutations")
        .select("*")
        .eq("realm_instance_id", realmId)
        .order("id"),
    ])

  if (!character || !realm) return null

  const turn = (mutations?.length ?? 0) + 1
  const stats = character.stats as CharacterStats

  const inventorySlots = (inventory ?? []).map((item: any) => ({
    item_id: item.id,
    template_id: item.template_id,
    name: item.template_id, // TODO: lookup from content
    quantity: item.quantity,
    modifiers: item.modifiers ?? {},
  }))

  return {
    turn,
    character: {
      id: character.id,
      class: character.class,
      level: character.level,
      xp: character.xp,
      hp: { current: character.hp_current, max: character.hp_max },
      resource: {
        type: character.class === "knight" ? "stamina"
          : character.class === "mage" ? "mana"
          : character.class === "rogue" ? "energy"
          : "focus",
        current: character.resource_current,
        max: character.resource_max,
      },
      buffs: [],
      debuffs: [],
      cooldowns: {},
      base_stats: stats,
      effective_stats: stats,
    },
    inventory: inventorySlots,
    equipment: { weapon: null, armor: null, accessory: null, class_specific: null },
    gold: character.gold,
    position: {
      floor: realm.floor_reached,
      room_id: `f${realm.floor_reached}_r0_rest`,
      tile: { x: 3, y: 3 },
    },
    visible_tiles: [],
    known_map: { floors: {} },
    visible_entities: [],
    room_text: "You stand at the entrance of the realm.",
    recent_events: [],
    legal_actions: [
      { type: "move", direction: "up" },
      { type: "move", direction: "down" },
      { type: "move", direction: "left" },
      { type: "move", direction: "right" },
      { type: "wait" },
      { type: "use_portal" },
    ],
    realm_info: {
      template_name: realm.template_id,
      floor_count: 4,
      current_floor: realm.floor_reached,
      status: realm.status === "boss_cleared" ? "boss_cleared" : "active",
    },
  }
}

// ── Turn timer ────────────────────────────────────────────────────────────────

function startTurnTimer(ws: ServerWebSocket<GameSessionData>) {
  ws.data.turnTimer = setTimeout(() => {
    // Timeout → wait/defend action
    handleGameMessage(ws, JSON.stringify({ type: "action", data: { type: "wait" } }))
  }, TURN_TIMEOUT_MS)
}

function clearTurnTimer(ws: ServerWebSocket<GameSessionData>) {
  if (ws.data.turnTimer) {
    clearTimeout(ws.data.turnTimer)
    ws.data.turnTimer = undefined
  }
}
