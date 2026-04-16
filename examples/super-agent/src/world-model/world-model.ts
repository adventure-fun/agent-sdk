import { Database } from "bun:sqlite"
import type {
  CharacterClass,
  Observation,
  ShopCatalogItem,
} from "../../../../src/index.js"
import { openWorldDatabase } from "./db.js"

export type RunOutcome = "extracted" | "death" | "stopped"

export interface RealmRunSummary {
  outcome: RunOutcome
  floorReached: number
  turnsPlayed: number
  goldEarned: number
  xpEarned: number
  realmCompleted: boolean
  causeOfDeath?: string | undefined
}

export interface EnemyProfile {
  templateId: string
  enemyName: string
  characterClass: CharacterClass
  sightings: number
  kills: number
  deathsTo: number
  lastSeenAt: number
}

export interface ShopPriceRecord {
  templateId: string
  name: string | null
  type: string | null
  rarity: string | null
  equipSlot: string | null
  classRestriction: string | null
  buyPrice: number | null
  sellPrice: number | null
  stats: Record<string, number> | null
  lastSeenAt: number
}

export interface BlockedDoorRecord {
  templateId: string
  targetId: string
  floor: number
  roomId: string
  x: number
  y: number
  requiredKeyTemplateId: string | null
  name: string | null
  firstSeenAt: number
  lastSeenAt: number
}

type RealmRunRow = {
  id: number | bigint
  template_id: string
  template_name: string
  character_class: string
  character_level: number
  outcome: string | null
  floor_reached: number | null
  turns_played: number | null
  gold_earned: number | null
  xp_earned: number | null
  realm_completed: number | null
  cause_of_death: string | null
}

type EnemyStatsRow = {
  template_id: string
  enemy_name: string
  character_class: string
  sightings: number
  kills: number
  deaths_to: number
  last_seen_at: number
}

type ShopPriceRow = {
  template_id: string
  name: string | null
  type: string | null
  rarity: string | null
  equip_slot: string | null
  class_restriction: string | null
  buy_price: number | null
  sell_price: number | null
  stats_json: string | null
  last_seen_at: number
}

type BlockedDoorRow = {
  template_id: string
  target_id: string
  floor: number
  room_id: string
  x: number
  y: number
  required_key_template_id: string | null
  name: string | null
  first_seen_at: number
  last_seen_at: number
}

/**
 * Cross-run knowledge store. Writes lightly on every turn via `ingestObservation`, flushes
 * run boundaries on `endRun`. Thread-safe for a single agent process (SQLite's WAL mode handles
 * the DB-level locking).
 */
export class WorldModel {
  private readonly db: Database
  // Per-run caches — flushed and cleared on endRun().
  private currentRunId: number | null = null
  private currentTemplateId: string | null = null
  private currentClass: CharacterClass | null = null
  private currentTemplateName: string | null = null
  // id -> {hp_current, name} snapshot from the previous observation.
  private readonly previousEnemies = new Map<string, { hp: number; name: string }>()
  private readonly seenEnemyThisRun = new Set<string>()
  private previousHp = 0
  private previousTurn = 0

  constructor(db: Database) {
    this.db = db
  }

  static open(path: string): WorldModel {
    return new WorldModel(openWorldDatabase(path))
  }

  close(): void {
    this.db.close()
  }

  /**
   * Opens a new realm_runs row. Returns the run id that callers should pass to endRun().
   */
  startRun(
    templateId: string,
    templateName: string,
    klass: CharacterClass,
    characterLevel: number,
  ): number {
    const stmt = this.db.prepare(
      `INSERT INTO realm_runs (template_id, template_name, character_class, character_level, started_at)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
    )
    const row = stmt.get(
      templateId,
      templateName,
      klass,
      characterLevel,
      Date.now(),
    ) as { id: number | bigint } | null
    if (!row) {
      throw new Error("WorldModel.startRun: insert returned no row")
    }
    this.currentRunId = Number(row.id)
    this.currentTemplateId = templateId
    this.currentTemplateName = templateName
    this.currentClass = klass
    this.previousEnemies.clear()
    this.seenEnemyThisRun.clear()
    this.previousHp = 0
    this.previousTurn = 0
    return this.currentRunId
  }

  endRun(runId: number, summary: RealmRunSummary): void {
    this.db
      .prepare(
        `UPDATE realm_runs
         SET ended_at = ?, outcome = ?, floor_reached = ?, turns_played = ?,
             gold_earned = ?, xp_earned = ?, realm_completed = ?, cause_of_death = ?
         WHERE id = ?`,
      )
      .run(
        Date.now(),
        summary.outcome,
        summary.floorReached,
        summary.turnsPlayed,
        summary.goldEarned,
        summary.xpEarned,
        summary.realmCompleted ? 1 : 0,
        summary.causeOfDeath ?? null,
        runId,
      )
    if (this.currentRunId === runId) {
      this.currentRunId = null
      this.currentTemplateId = null
      this.currentClass = null
      this.currentTemplateName = null
      this.previousEnemies.clear()
      this.seenEnemyThisRun.clear()
    }
  }

  /**
   * Ingests a single live observation. Tracks sightings and kill deltas (by comparing the
   * prior turn's visible-enemy HP snapshot to this turn's) and bumps last_seen_at. Safe to
   * call on every turn.
   */
  ingestObservation(obs: Observation): void {
    if (this.currentTemplateId === null || this.currentClass === null) return

    const templateId = this.currentTemplateId
    const klass = this.currentClass

    const nowEnemies = new Map<string, { hp: number; name: string }>()
    for (const entity of obs.visible_entities) {
      if (entity.type !== "enemy") continue
      nowEnemies.set(entity.id, { hp: entity.hp_current ?? 0, name: entity.name })
      const key = entity.name
      if (!this.seenEnemyThisRun.has(key)) {
        this.seenEnemyThisRun.add(key)
        this.db
          .prepare(
            `INSERT INTO enemy_stats (template_id, enemy_name, character_class, sightings, last_seen_at)
             VALUES (?, ?, ?, 1, ?)
             ON CONFLICT(template_id, enemy_name, character_class) DO UPDATE SET
               sightings = sightings + 1,
               last_seen_at = excluded.last_seen_at`,
          )
          .run(templateId, key, klass, Date.now())
      }
    }

    // Kill detection: any id present last turn but now gone whose HP was > 0 counts as a kill.
    // We use the cached name from the previous-turn snapshot, not the current observation,
    // because the entity is no longer visible now.
    if (this.previousEnemies.size > 0 && obs.turn === this.previousTurn + 1) {
      for (const [id, prev] of this.previousEnemies.entries()) {
        if (nowEnemies.has(id)) continue
        if (prev.hp <= 0) continue
        this.db
          .prepare(
            `UPDATE enemy_stats
             SET kills = kills + 1, last_seen_at = ?
             WHERE template_id = ? AND enemy_name = ? AND character_class = ?`,
          )
          .run(Date.now(), templateId, prev.name, klass)
      }
    }

    this.previousEnemies.clear()
    for (const [id, snap] of nowEnemies.entries()) {
      this.previousEnemies.set(id, snap)
    }
    this.previousTurn = obs.turn
    this.previousHp = obs.character.hp.current
  }

  /**
   * Records that a specific enemy killed the character. Call from the `death` event.
   */
  recordDeath(causeName: string): void {
    if (this.currentTemplateId === null || this.currentClass === null) return
    this.db
      .prepare(
        `INSERT INTO enemy_stats (template_id, enemy_name, character_class, deaths_to, last_seen_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(template_id, enemy_name, character_class) DO UPDATE SET
           deaths_to = deaths_to + 1,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(this.currentTemplateId, causeName, this.currentClass, Date.now())
  }

  upsertShopPrices(items: ReadonlyArray<ShopCatalogItem>): void {
    const now = Date.now()
    const stmt = this.db.prepare(
      `INSERT INTO shop_prices (template_id, name, type, rarity, equip_slot, class_restriction, buy_price, sell_price, stats_json, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(template_id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         rarity = excluded.rarity,
         equip_slot = excluded.equip_slot,
         class_restriction = excluded.class_restriction,
         buy_price = excluded.buy_price,
         sell_price = excluded.sell_price,
         stats_json = excluded.stats_json,
         last_seen_at = excluded.last_seen_at`,
    )
    for (const item of items) {
      stmt.run(
        item.id,
        item.name ?? null,
        item.type ?? null,
        item.rarity ?? null,
        item.equip_slot ?? null,
        item.class_restriction ?? null,
        item.buy_price ?? null,
        item.sell_price ?? null,
        item.stats ? JSON.stringify(item.stats) : null,
        now,
      )
    }
  }

  getShopPrice(templateId: string): ShopPriceRecord | null {
    const row = this.db
      .prepare(
        `SELECT template_id, name, type, rarity, equip_slot, class_restriction,
                buy_price, sell_price, stats_json, last_seen_at
         FROM shop_prices WHERE template_id = ?`,
      )
      .get(templateId) as ShopPriceRow | null
    if (!row) return null
    return {
      templateId: row.template_id,
      name: row.name,
      type: row.type,
      rarity: row.rarity,
      equipSlot: row.equip_slot,
      classRestriction: row.class_restriction,
      buyPrice: row.buy_price,
      sellPrice: row.sell_price,
      stats: row.stats_json ? (JSON.parse(row.stats_json) as Record<string, number>) : null,
      lastSeenAt: row.last_seen_at,
    }
  }

  getEnemyProfile(
    templateId: string,
    enemyName: string,
    klass: CharacterClass,
  ): EnemyProfile | null {
    const row = this.db
      .prepare(
        `SELECT template_id, enemy_name, character_class, sightings, kills, deaths_to, last_seen_at
         FROM enemy_stats
         WHERE template_id = ? AND enemy_name = ? AND character_class = ?`,
      )
      .get(templateId, enemyName, klass) as EnemyStatsRow | null
    if (!row) return null
    return {
      templateId: row.template_id,
      enemyName: row.enemy_name,
      characterClass: row.character_class as CharacterClass,
      sightings: row.sightings,
      kills: row.kills,
      deathsTo: row.deaths_to,
      lastSeenAt: row.last_seen_at,
    }
  }

  addRealmTip(templateId: string, klass: CharacterClass, note: string): void {
    this.db
      .prepare(
        `INSERT INTO realm_tips (template_id, character_class, note, added_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(templateId, klass, note, Date.now())
  }

  /**
   * Builds a short natural-language summary of prior runs for this template + class. Returns
   * the empty string when nothing is known, so callers can safely prepend it to prompts.
   */
  summarizeForLLM(templateId: string, klass: CharacterClass, maxChars = 800): string {
    const runsRow = this.db
      .prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN outcome = 'extracted' THEN 1 ELSE 0 END) as extracted,
                SUM(CASE WHEN outcome = 'death' THEN 1 ELSE 0 END) as died,
                MAX(floor_reached) as max_floor,
                AVG(turns_played) as avg_turns,
                SUM(gold_earned) as total_gold
         FROM realm_runs WHERE template_id = ? AND character_class = ?`,
      )
      .get(templateId, klass) as {
        total: number | null
        extracted: number | null
        died: number | null
        max_floor: number | null
        avg_turns: number | null
        total_gold: number | null
      } | null

    const lines: string[] = []
    if (runsRow && runsRow.total && runsRow.total > 0) {
      const avgTurns = runsRow.avg_turns != null ? Math.round(runsRow.avg_turns) : "?"
      lines.push(
        `Realm "${templateId}" (${klass}): ${runsRow.extracted ?? 0} clears / ${runsRow.died ?? 0} deaths in ${runsRow.total} runs. Best floor reached: ${runsRow.max_floor ?? "?"}. Avg turns/run: ${avgTurns}. Lifetime gold: ${runsRow.total_gold ?? 0}.`,
      )
    }

    const topEnemies = this.db
      .prepare(
        `SELECT enemy_name, kills, deaths_to FROM enemy_stats
         WHERE template_id = ? AND character_class = ?
         ORDER BY (kills + deaths_to * 4) DESC
         LIMIT 5`,
      )
      .all(templateId, klass) as Array<{
        enemy_name: string
        kills: number
        deaths_to: number
      }>
    if (topEnemies.length > 0) {
      const formatted = topEnemies
        .map((e) => `${e.enemy_name} (${e.kills}K/${e.deaths_to}D)`)
        .join(", ")
      lines.push(`Threat log: ${formatted}.`)
    }

    const tips = this.db
      .prepare(
        `SELECT note FROM realm_tips
         WHERE template_id = ? AND character_class = ?
         ORDER BY added_at DESC LIMIT 5`,
      )
      .all(templateId, klass) as Array<{ note: string }>
    if (tips.length > 0) {
      lines.push("Field notes: " + tips.map((t) => t.note).join(" | "))
    }

    const result = lines.join("\n")
    return result.length > maxChars ? result.slice(0, maxChars - 1) + "…" : result
  }

  /**
   * Persists a blocked door observed this run. Keyed by (template_id, target_id) so the
   * agent's mapMemory.encounteredDoors can be hydrated on subsequent sessions of the same
   * realm template and the agent starts already knowing where locked doors are.
   */
  upsertBlockedDoor(record: {
    templateId: string
    targetId: string
    floor: number
    roomId: string
    x: number
    y: number
    requiredKeyTemplateId?: string | null
    name?: string | null
  }): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO blocked_doors (
           template_id, target_id, floor, room_id, x, y, required_key_template_id, name, first_seen_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(template_id, target_id) DO UPDATE SET
           floor = excluded.floor,
           room_id = excluded.room_id,
           x = excluded.x,
           y = excluded.y,
           required_key_template_id = COALESCE(excluded.required_key_template_id, blocked_doors.required_key_template_id),
           name = COALESCE(excluded.name, blocked_doors.name),
           last_seen_at = excluded.last_seen_at`,
      )
      .run(
        record.templateId,
        record.targetId,
        record.floor,
        record.roomId,
        record.x,
        record.y,
        record.requiredKeyTemplateId ?? null,
        record.name ?? null,
        now,
        now,
      )
  }

  /** Returns every blocked door known for a realm template. Used to hydrate mapMemory. */
  getBlockedDoorsForTemplate(templateId: string): BlockedDoorRecord[] {
    const rows = this.db
      .prepare(
        `SELECT template_id, target_id, floor, room_id, x, y, required_key_template_id, name, first_seen_at, last_seen_at
         FROM blocked_doors WHERE template_id = ?`,
      )
      .all(templateId) as BlockedDoorRow[]
    return rows.map((row) => ({
      templateId: row.template_id,
      targetId: row.target_id,
      floor: row.floor,
      roomId: row.room_id,
      x: row.x,
      y: row.y,
      requiredKeyTemplateId: row.required_key_template_id,
      name: row.name,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    }))
  }

  /** Removes a blocked door once the agent successfully opens it. */
  deleteBlockedDoor(templateId: string, targetId: string): void {
    this.db
      .prepare(`DELETE FROM blocked_doors WHERE template_id = ? AND target_id = ?`)
      .run(templateId, targetId)
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value)
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | null
    return row ? row.value : null
  }

  countRuns(): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM realm_runs").get() as { c: number }
    return row.c
  }
}
