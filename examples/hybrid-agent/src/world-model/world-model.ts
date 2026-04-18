import type { Database } from "bun:sqlite"
import type { ArenaBracket } from "../../../../src/index.js"
import { openWorldDatabase } from "../../../super-agent/src/world-model/db.js"
import { WorldModel } from "../../../super-agent/src/world-model/world-model.js"

/**
 * Hybrid-agent persistence layer.
 *
 * Composes the super-agent {@link WorldModel} (untouched) with three additional
 * tables for arena match memory, queue audit, and gold-history fatigue. Both
 * schemas are re-applied on every open via `CREATE TABLE IF NOT EXISTS`, so
 * pointing this class at an existing super-agent database is safe — the only
 * observable effect is three new empty tables appearing in the file.
 */

const HYBRID_SCHEMA = `
CREATE TABLE IF NOT EXISTS arena_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  bracket TEXT NOT NULL,
  match_id TEXT NOT NULL,
  placement INTEGER,
  gold_awarded INTEGER NOT NULL DEFAULT 0,
  ended_reason TEXT NOT NULL,
  matched_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arena_results_character_ended
  ON arena_results(character_id, ended_at DESC);

CREATE INDEX IF NOT EXISTS idx_arena_results_bracket_ended
  ON arena_results(bracket, ended_at DESC);

CREATE TABLE IF NOT EXISTS arena_queue_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  bracket TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  matched_at INTEGER,
  dropped_at INTEGER,
  match_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_arena_queue_history_character_queued
  ON arena_queue_history(character_id, queued_at DESC);

CREATE TABLE IF NOT EXISTS gold_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  gold INTEGER NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gold_history_character_recorded
  ON gold_history(character_id, recorded_at DESC);
`

export type GoldHistorySource =
  | "dungeon_extracted"
  | "dungeon_death"
  | "arena_payout"
  | "boot"
  | "manual"

export type ArenaResultEndedReason =
  | "last_standing"
  | "sudden_death"
  | "tie_break"
  | "abandoned"
  | "timeout"

export interface ArenaResultRow {
  characterId: string
  bracket: ArenaBracket
  matchId: string
  /** 1..4 on finished matches; null for abandoned / timeout entries. */
  placement: 1 | 2 | 3 | 4 | null
  goldAwarded: number
  endedReason: ArenaResultEndedReason
  matchedAt: number
  endedAt: number
}

export interface ArenaQueueHistoryRow {
  characterId: string
  bracket: ArenaBracket
  queuedAt: number
  matchedAt: number | null
  droppedAt: number | null
  matchId: string | null
}

export interface GoldHistoryRow {
  characterId: string
  recordedAt: number
  gold: number
  source: GoldHistorySource
}

type ArenaResultDbRow = {
  character_id: string
  bracket: string
  match_id: string
  placement: number | null
  gold_awarded: number
  ended_reason: string
  matched_at: number
  ended_at: number
}

type ArenaQueueHistoryDbRow = {
  id: number | bigint
  character_id: string
  bracket: string
  queued_at: number
  matched_at: number | null
  dropped_at: number | null
  match_id: string | null
}

type GoldHistoryDbRow = {
  character_id: string
  recorded_at: number
  gold: number
  source: string
}

function assertBracket(raw: string): ArenaBracket {
  if (raw === "rookie" || raw === "veteran" || raw === "champion") return raw
  throw new Error(`HybridWorldModel: unexpected bracket value "${raw}"`)
}

function assertEndedReason(raw: string): ArenaResultEndedReason {
  if (
    raw === "last_standing"
    || raw === "sudden_death"
    || raw === "tie_break"
    || raw === "abandoned"
    || raw === "timeout"
  ) {
    return raw
  }
  throw new Error(`HybridWorldModel: unexpected ended_reason "${raw}"`)
}

export class HybridWorldModel {
  private readonly db: Database
  /** Super-agent WorldModel exposed so dungeon runs can reuse its API as-is. */
  readonly world: WorldModel

  constructor(db: Database) {
    this.db = db
    this.db.exec(HYBRID_SCHEMA)
    this.world = new WorldModel(db)
  }

  /**
   * Opens (or creates) the hybrid SQLite database at `path`. Applies both the
   * super-agent schema (via `openWorldDatabase`) and the hybrid schema. Use
   * `":memory:"` for tests.
   */
  static open(path: string): HybridWorldModel {
    return new HybridWorldModel(openWorldDatabase(path))
  }

  close(): void {
    this.db.close()
  }

  // ── arena_results ───────────────────────────────────────────────────────

  /** Records a finished (or timed-out) arena match result. */
  recordArenaResult(row: ArenaResultRow): void {
    this.db
      .prepare(
        `INSERT INTO arena_results
           (character_id, bracket, match_id, placement, gold_awarded, ended_reason, matched_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.characterId,
        row.bracket,
        row.matchId,
        row.placement,
        row.goldAwarded,
        row.endedReason,
        row.matchedAt,
        row.endedAt,
      )
  }

  /** Most recent arena results for a character, newest first. */
  getRecentArenaResults(characterId: string, limit = 10): ArenaResultRow[] {
    const rows = this.db
      .prepare(
        `SELECT character_id, bracket, match_id, placement, gold_awarded,
                ended_reason, matched_at, ended_at
         FROM arena_results
         WHERE character_id = ?
         ORDER BY ended_at DESC
         LIMIT ?`,
      )
      .all(characterId, limit) as ArenaResultDbRow[]
    return rows.map((r) => ({
      characterId: r.character_id,
      bracket: assertBracket(r.bracket),
      matchId: r.match_id,
      placement: r.placement as 1 | 2 | 3 | 4 | null,
      goldAwarded: r.gold_awarded,
      endedReason: assertEndedReason(r.ended_reason),
      matchedAt: r.matched_at,
      endedAt: r.ended_at,
    }))
  }

  /**
   * Counts consecutive non-wins (`placement != 1`) starting from the most
   * recent result for the given character + bracket. Returns 0 when the most
   * recent result is a win or there are no results. Null-placement entries
   * (timeouts) are ignored — they represent a queue failure, not a loss.
   */
  getArenaLossStreak(characterId: string, bracket: ArenaBracket): number {
    const rows = this.db
      .prepare(
        `SELECT placement FROM arena_results
         WHERE character_id = ? AND bracket = ? AND placement IS NOT NULL
         ORDER BY ended_at DESC
         LIMIT 50`,
      )
      .all(characterId, bracket) as Array<{ placement: number | null }>
    let streak = 0
    for (const r of rows) {
      if (r.placement === 1) break
      streak += 1
    }
    return streak
  }

  // ── arena_queue_history ─────────────────────────────────────────────────

  /** Records that the character entered the queue. Returns the inserted id. */
  markQueueStart(characterId: string, bracket: ArenaBracket, queuedAt: number): number {
    const row = this.db
      .prepare(
        `INSERT INTO arena_queue_history (character_id, bracket, queued_at)
         VALUES (?, ?, ?)
         RETURNING id`,
      )
      .get(characterId, bracket, queuedAt) as { id: number | bigint } | null
    if (!row) {
      throw new Error("HybridWorldModel.markQueueStart: insert returned no row")
    }
    return Number(row.id)
  }

  markQueueMatched(id: number, matchId: string, matchedAt: number): void {
    this.db
      .prepare(
        `UPDATE arena_queue_history
           SET matched_at = ?, match_id = ?
         WHERE id = ?`,
      )
      .run(matchedAt, matchId, id)
  }

  markQueueDropped(id: number, droppedAt: number): void {
    this.db
      .prepare(`UPDATE arena_queue_history SET dropped_at = ? WHERE id = ?`)
      .run(droppedAt, id)
  }

  getRecentQueueHistory(
    characterId: string,
    limit = 10,
  ): ArenaQueueHistoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, character_id, bracket, queued_at, matched_at, dropped_at, match_id
         FROM arena_queue_history
         WHERE character_id = ?
         ORDER BY queued_at DESC
         LIMIT ?`,
      )
      .all(characterId, limit) as ArenaQueueHistoryDbRow[]
    return rows.map((r) => ({
      characterId: r.character_id,
      bracket: assertBracket(r.bracket),
      queuedAt: r.queued_at,
      matchedAt: r.matched_at,
      droppedAt: r.dropped_at,
      matchId: r.match_id,
    }))
  }

  // ── gold_history ────────────────────────────────────────────────────────

  recordGold(
    characterId: string,
    gold: number,
    source: GoldHistorySource,
    recordedAt: number = Date.now(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO gold_history (character_id, recorded_at, gold, source)
         VALUES (?, ?, ?, ?)`,
      )
      .run(characterId, recordedAt, gold, source)
  }

  getRecentGoldHistory(characterId: string, limit = 20): GoldHistoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT character_id, recorded_at, gold, source
         FROM gold_history
         WHERE character_id = ?
         ORDER BY recorded_at DESC
         LIMIT ?`,
      )
      .all(characterId, limit) as GoldHistoryDbRow[]
    return rows.map((r) => ({
      characterId: r.character_id,
      recordedAt: r.recorded_at,
      gold: r.gold,
      source: r.source as GoldHistorySource,
    }))
  }
}
