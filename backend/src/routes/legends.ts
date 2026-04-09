import { Hono } from "hono"
import type { EquipSlot, InventoryItem, LegendPage } from "@adventure-fun/schemas"
import { getItem } from "@adventure-fun/engine"
import { db } from "../db/client.js"

const legends = new Hono()

const EMPTY_EQUIPMENT: Record<EquipSlot, InventoryItem | null> = {
  weapon: null,
  armor: null,
  accessory: null,
  "class-specific": null,
}

function mapCorpseItem(row: Record<string, unknown>): InventoryItem {
  let name = String(row.template_id ?? "")
  try {
    name = getItem(name).name
  } catch {
    // Keep template id fallback if content is missing.
  }

  return {
    id: String(row.id ?? ""),
    template_id: String(row.template_id ?? ""),
    name,
    quantity: Number(row.quantity ?? 1),
    modifiers: (row.modifiers as Record<string, number>) ?? {},
    owner_type: (row.owner_type as InventoryItem["owner_type"]) ?? "corpse",
    owner_id: String(row.owner_id ?? ""),
    slot: (row.slot as EquipSlot | null) ?? null,
  }
}

function mapSkillTree(skillTree: Record<string, boolean> | null | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(skillTree ?? {})
      .filter(([, unlocked]) => unlocked === true)
      .map(([nodeId]) => [nodeId, "unlocked"]),
  )
}

// GET /legends/:characterId — public
legends.get("/:characterId", async (c) => {
  const { characterId } = c.req.param()

  const { data: character, error: characterError } = await db
    .from("characters")
    .select(
      "id, name, class, level, xp, stats, skill_tree, created_at, died_at, accounts(handle, player_type, wallet_address, x_handle, github_handle)",
    )
    .eq("id", characterId)
    .eq("status", "dead")
    .maybeSingle()

  if (characterError) return c.json({ error: characterError.message }, 500)
  if (!character) return c.json({ error: "Legend not found" }, 404)

  const [corpseRes, leaderboardRes, runLogsRes] = await Promise.all([
    db
      .from("corpse_containers")
      .select("*")
      .eq("character_id", characterId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("leaderboard_entries")
      .select("realms_completed, deepest_floor, cause_of_death")
      .eq("character_id", characterId)
      .maybeSingle(),
    db
      .from("run_logs")
      .select("total_turns, summary, end_reason, ended_at")
      .eq("character_id", characterId)
      .order("ended_at", { ascending: false }),
  ])

  if (corpseRes.error) return c.json({ error: corpseRes.error.message }, 500)
  if (leaderboardRes.error) return c.json({ error: leaderboardRes.error.message }, 500)
  if (runLogsRes.error) return c.json({ error: runLogsRes.error.message }, 500)

  const corpse = corpseRes.data as Record<string, unknown> | null
  const leaderboard = leaderboardRes.data as Record<string, unknown> | null
  const runLogs = (runLogsRes.data ?? []) as Array<Record<string, unknown>>

  let corpseItems: Array<Record<string, unknown>> = []
  if (corpse?.id) {
    const { data, error } = await db
      .from("inventory_items")
      .select("*")
      .eq("owner_type", "corpse")
      .eq("owner_id", corpse.id as string)

    if (error) return c.json({ error: error.message }, 500)
    corpseItems = (data ?? []) as Array<Record<string, unknown>>
  }

  const equipmentAtDeath = { ...EMPTY_EQUIPMENT }
  for (const row of corpseItems) {
    const item = mapCorpseItem(row)
    if (item.slot && item.slot in equipmentAtDeath) {
      equipmentAtDeath[item.slot] = item
    }
  }

  const totalEnemiesKilled = runLogs.reduce((sum, run) => {
    const summary = (run.summary as Record<string, unknown> | null) ?? {}
    return sum + Number(summary.enemies_killed ?? 0)
  }, 0)
  const totalTurnsSurvived = runLogs.reduce((sum, run) => sum + Number(run.total_turns ?? 0), 0)
  const latestRunSummary =
    ((runLogs[0]?.summary as Record<string, unknown> | undefined) ?? {})

  const owner = (character as Record<string, unknown>).accounts as Record<string, unknown> | null

  const response: LegendPage = {
    character: {
      id: String(character.id),
      name: String(character.name),
      class: character.class as LegendPage["character"]["class"],
      level: Number(character.level ?? 0),
      xp: Number(character.xp ?? 0),
      stats: (character.stats as LegendPage["character"]["stats"]) ?? {
        hp: 0,
        attack: 0,
        defense: 0,
        accuracy: 0,
        evasion: 0,
        speed: 0,
      },
      skill_tree: mapSkillTree((character.skill_tree as Record<string, boolean> | null) ?? {}),
      equipment_at_death: equipmentAtDeath,
      gold_at_death: Number(corpse?.gold_amount ?? 0),
    },
    owner: {
      handle: String(owner?.handle ?? ""),
      player_type: (owner?.player_type as LegendPage["owner"]["player_type"]) ?? "human",
      wallet: String(owner?.wallet_address ?? ""),
      x_handle: (owner?.x_handle as string | null) ?? null,
      github_handle: (owner?.github_handle as string | null) ?? null,
    },
    history: {
      realms_completed: Number(leaderboard?.realms_completed ?? 0),
      deepest_floor: Number(leaderboard?.deepest_floor ?? corpse?.floor ?? 0),
      enemies_killed: totalEnemiesKilled,
      turns_survived: totalTurnsSurvived,
      cause_of_death:
        String(
          latestRunSummary.cause_of_death
          ?? leaderboard?.cause_of_death
          ?? "Unknown",
        ),
      death_floor: Number(corpse?.floor ?? leaderboard?.deepest_floor ?? 0),
      death_room: String(corpse?.room_id ?? "Unknown"),
      created_at: String(character.created_at ?? ""),
      died_at: String(character.died_at ?? runLogs[0]?.ended_at ?? ""),
    },
  }

  return c.json(response)
})

export { legends as legendsRoutes }
