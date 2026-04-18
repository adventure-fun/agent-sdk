-- Hybrid-agent schema. Layered ON TOP of the super-agent schema (opened via
-- openWorldDatabase). All statements use IF NOT EXISTS so the layer is safe to
-- re-apply against an existing super-agent database.

CREATE TABLE IF NOT EXISTS arena_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  bracket TEXT NOT NULL,               -- 'rookie' | 'veteran' | 'champion'
  match_id TEXT NOT NULL,
  placement INTEGER,                   -- 1..4; NULL on timeout / abandoned
  gold_awarded INTEGER NOT NULL DEFAULT 0,
  ended_reason TEXT NOT NULL,          -- 'last_standing' | 'sudden_death' | 'tie_break' | 'abandoned' | 'timeout'
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
  matched_at INTEGER,                  -- NULL while still queueing / on timeout
  dropped_at INTEGER,                  -- populated on cancel / timeout
  match_id TEXT                        -- populated on matched_at
);

CREATE INDEX IF NOT EXISTS idx_arena_queue_history_character_queued
  ON arena_queue_history(character_id, queued_at DESC);

CREATE TABLE IF NOT EXISTS gold_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  gold INTEGER NOT NULL,
  source TEXT NOT NULL                 -- 'dungeon_extracted' | 'dungeon_death' | 'arena_payout' | 'boot' | 'manual'
);

CREATE INDEX IF NOT EXISTS idx_gold_history_character_recorded
  ON gold_history(character_id, recorded_at DESC);
