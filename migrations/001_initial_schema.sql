-- Adventure.fun — Initial Schema
-- Run against Supabase PostgreSQL
-- Matches BACKEND.md spec exactly

-- ── Accounts ─────────────────────────────────────────────────────────────────

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  player_type TEXT NOT NULL CHECK (player_type IN ('human', 'agent')),
  handle TEXT UNIQUE,
  x_handle TEXT,
  github_handle TEXT,
  free_realm_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Characters ───────────────────────────────────────────────────────────────

CREATE TABLE characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) NOT NULL,
  name TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('knight', 'mage', 'rogue', 'archer')),
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  gold INTEGER DEFAULT 0,
  hp_current INTEGER NOT NULL,
  hp_max INTEGER NOT NULL,
  resource_current INTEGER NOT NULL,
  resource_max INTEGER NOT NULL,
  stats JSONB NOT NULL,           -- { attack, defense, accuracy, evasion, speed }
  skill_tree JSONB DEFAULT '{}',
  status TEXT DEFAULT 'alive' CHECK (status IN ('alive', 'dead')),
  stat_rerolled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  died_at TIMESTAMPTZ
);

-- Enforce one alive character per account
CREATE UNIQUE INDEX one_alive_per_account
  ON characters (account_id) WHERE status = 'alive';

-- ── Realm Instances ───────────────────────────────────────────────────────────

CREATE TABLE realm_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID REFERENCES characters(id) NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  seed BIGINT NOT NULL,
  status TEXT DEFAULT 'generated'
    CHECK (status IN ('generated', 'active', 'paused', 'boss_cleared', 'completed', 'dead_end')),
  floor_reached INTEGER DEFAULT 1,
  is_free BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (character_id, template_id)
);

-- ── Realm Mutations (seed + delta model) ──────────────────────────────────────

CREATE TABLE realm_mutations (
  id BIGSERIAL PRIMARY KEY,
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  entity_id TEXT NOT NULL,       -- f{floor}_r{room}_{type}_{index}
  mutation TEXT NOT NULL,        -- killed, opened, triggered, looted, unlocked, etc.
  turn INTEGER NOT NULL,
  floor INTEGER NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mutations_instance ON realm_mutations(realm_instance_id);

-- ── Discovered Map ────────────────────────────────────────────────────────────

CREATE TABLE realm_discovered_map (
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  floor INTEGER NOT NULL,
  discovered_tiles JSONB NOT NULL,  -- set of {x, y} coordinates
  PRIMARY KEY (realm_instance_id, floor)
);

-- ── Inventory Items (polymorphic owner model) ─────────────────────────────────

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID REFERENCES characters(id) NOT NULL,  -- original owner (for audit)
  owner_type TEXT NOT NULL DEFAULT 'character'
    CHECK (owner_type IN ('character', 'escrow', 'corpse')),
  owner_id UUID NOT NULL,            -- character_id, listing_id, or corpse_container_id
  template_id TEXT NOT NULL,
  slot TEXT,                         -- null = unequipped, 'weapon'/'armor'/etc = equipped
  quantity INTEGER DEFAULT 1,
  modifiers JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inventory_owner ON inventory_items(owner_type, owner_id);

-- ── Corpse Containers ─────────────────────────────────────────────────────────

CREATE TABLE corpse_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  character_id UUID REFERENCES characters(id) NOT NULL,
  floor INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  gold_amount INTEGER DEFAULT 0,    -- gold snapshot (lost on death, stored for legend)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Corpse items: inventory_items WHERE owner_type='corpse' AND owner_id=corpse_container.id

-- ── Run Events (append-only, enables future replay) ──────────────────────────

CREATE TABLE run_events (
  id BIGSERIAL PRIMARY KEY,
  realm_instance_id UUID REFERENCES realm_instances(id) NOT NULL,
  turn INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_instance ON run_events(realm_instance_id);

-- ── Leaderboard (denormalized snapshot) ──────────────────────────────────────

CREATE TABLE leaderboard_entries (
  character_id UUID PRIMARY KEY REFERENCES characters(id),
  character_name TEXT NOT NULL,
  class TEXT NOT NULL,
  player_type TEXT NOT NULL,
  level INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  deepest_floor INTEGER NOT NULL,
  realms_completed INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  cause_of_death TEXT,
  owner_handle TEXT,
  owner_wallet TEXT,
  x_handle TEXT,
  github_handle TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  died_at TIMESTAMPTZ
);

-- ── Lore Discovered ───────────────────────────────────────────────────────────

CREATE TABLE lore_discovered (
  character_id UUID REFERENCES characters(id) NOT NULL,
  lore_entry_id TEXT NOT NULL,
  discovered_at_turn INTEGER NOT NULL,
  PRIMARY KEY (character_id, lore_entry_id)
);

-- ── Payment Log ───────────────────────────────────────────────────────────────

CREATE TABLE payment_log (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID REFERENCES accounts(id) NOT NULL,
  action TEXT NOT NULL,             -- realm_unlock, inn_rest, stat_reroll, realm_regen, marketplace_buy
  amount_usd NUMERIC(10,4) NOT NULL,
  chain TEXT NOT NULL,
  tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Marketplace Listings ──────────────────────────────────────────────────────

CREATE TABLE marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID REFERENCES accounts(id) NOT NULL,
  seller_character_id UUID REFERENCES characters(id) NOT NULL,
  seller_wallet TEXT NOT NULL,
  item_id UUID REFERENCES inventory_items(id) NOT NULL,
  item_snapshot JSONB NOT NULL,     -- frozen item details at list time
  price_usd NUMERIC(10,4) NOT NULL,
  listing_fee_gold INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'sold', 'cancelled')),
  is_orphaned BOOLEAN DEFAULT FALSE,
  buyer_account_id UUID REFERENCES accounts(id),
  buyer_character_id UUID REFERENCES characters(id),
  payment_tx_hash TEXT,
  payment_recipient TEXT,           -- seller wallet or platform wallet
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sold_at TIMESTAMPTZ
);

CREATE INDEX idx_listings_active ON marketplace_listings(status) WHERE status = 'active';
CREATE INDEX idx_listings_seller ON marketplace_listings(seller_character_id);

-- ── Hall of Fame ──────────────────────────────────────────────────────────────

CREATE TABLE hall_of_fame (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  character_id UUID REFERENCES characters(id),
  detail JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Chat Log ──────────────────────────────────────────────────────────────────

CREATE TABLE chat_log (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID REFERENCES accounts(id) NOT NULL,
  character_name TEXT,
  raw_message TEXT NOT NULL,
  filtered_message TEXT,
  was_blocked BOOLEAN DEFAULT FALSE,
  block_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Death trigger: orphan marketplace listings ────────────────────────────────

CREATE OR REPLACE FUNCTION orphan_marketplace_listings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'dead' AND OLD.status = 'alive' THEN
    UPDATE marketplace_listings
    SET is_orphaned = TRUE
    WHERE seller_character_id = NEW.id
      AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orphan_listings
  AFTER UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION orphan_marketplace_listings();
