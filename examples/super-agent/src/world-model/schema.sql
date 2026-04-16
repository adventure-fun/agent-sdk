-- WorldModel schema. Re-applied idempotently on every open via db.ts.
-- All tables use IF NOT EXISTS and are safe to migrate into.

CREATE TABLE IF NOT EXISTS realm_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  character_class TEXT NOT NULL,
  character_level INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT,                -- 'extracted' | 'death' | 'stopped'
  floor_reached INTEGER,
  turns_played INTEGER,
  gold_earned INTEGER,
  xp_earned INTEGER,
  realm_completed INTEGER,     -- 0/1
  cause_of_death TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_template_class
  ON realm_runs(template_id, character_class);

CREATE TABLE IF NOT EXISTS enemy_stats (
  template_id TEXT NOT NULL,
  enemy_name TEXT NOT NULL,
  character_class TEXT NOT NULL,
  sightings INTEGER DEFAULT 0,
  kills INTEGER DEFAULT 0,
  deaths_to INTEGER DEFAULT 0,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (template_id, enemy_name, character_class)
);

CREATE TABLE IF NOT EXISTS shop_prices (
  template_id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  rarity TEXT,
  equip_slot TEXT,
  class_restriction TEXT,
  buy_price INTEGER,
  sell_price INTEGER,
  stats_json TEXT,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS realm_tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL,
  character_class TEXT NOT NULL,
  note TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tips_template_class
  ON realm_tips(template_id, character_class);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS blocked_doors (
  template_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  floor INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  required_key_template_id TEXT,
  name TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (template_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_doors_template
  ON blocked_doors(template_id);
