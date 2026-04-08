-- Adventure.fun — Session Architecture Migration
-- Adds session management columns to realm_instances,
-- creates run_logs table (replaces run_events).
-- See DATABASE_WRITES.md for full design.

-- ── Add session management columns to realm_instances ──────────────────────────

ALTER TABLE realm_instances ADD COLUMN IF NOT EXISTS last_turn INTEGER DEFAULT 0;
ALTER TABLE realm_instances ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE realm_instances ADD COLUMN IF NOT EXISTS current_room_id TEXT;
ALTER TABLE realm_instances ADD COLUMN IF NOT EXISTS tile_x INTEGER;
ALTER TABLE realm_instances ADD COLUMN IF NOT EXISTS tile_y INTEGER;

-- ── Run logs — one row per dungeon session (replaces per-turn run_events) ──────

CREATE TABLE IF NOT EXISTS run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  character_id UUID REFERENCES characters(id) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  end_reason TEXT NOT NULL CHECK (end_reason IN ('death', 'extraction', 'disconnect')),
  total_turns INTEGER NOT NULL,
  events JSONB NOT NULL,              -- full action log as array
  summary JSONB NOT NULL,             -- aggregated stats for quick queries
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_run_logs_character ON run_logs(character_id);
CREATE INDEX IF NOT EXISTS idx_run_logs_realm ON run_logs(realm_instance_id);

-- ── Backfill last_turn from existing realm_mutations ───────────────────────────

UPDATE realm_instances ri
SET last_turn = COALESCE(
  (SELECT MAX(turn) FROM realm_mutations rm WHERE rm.realm_instance_id = ri.id),
  0
);

-- ── Drop run_events (replaced by run_logs + in-memory event buffer) ────────────
-- Kept as a separate step so it can be deferred if anything still reads from it.

DROP TABLE IF EXISTS run_events;
