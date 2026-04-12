-- =============================================================================
-- Enable Row Level Security on all 14 public tables with appropriate policies
-- =============================================================================
--
-- Context:
--   The backend connects via SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
--   These policies are defense-in-depth: they lock out the anon key from
--   private data and prepare for future Supabase Auth / client-side usage.
--
-- Policy model:
--   - service_role: bypasses RLS (no policies needed)
--   - anon: read-only on genuinely public tables, denied everywhere else
--   - authenticated: scoped to own data via auth.uid() = account_id
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Supporting indexes for RLS subquery performance
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_characters_account_id
  ON public.characters (account_id);

CREATE INDEX IF NOT EXISTS idx_inventory_items_character_id
  ON public.inventory_items (character_id);

CREATE INDEX IF NOT EXISTS idx_corpse_containers_character_id
  ON public.corpse_containers (character_id);

CREATE INDEX IF NOT EXISTS idx_realm_instances_character_id
  ON public.realm_instances (character_id);

-- ---------------------------------------------------------------------------
-- 2. Enable RLS on every public table
-- ---------------------------------------------------------------------------

ALTER TABLE public.accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realm_instances       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realm_mutations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realm_discovered_map  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpse_containers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lore_discovered       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_listings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_of_fame          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_log              ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Public read-only tables (anon + authenticated can SELECT)
-- ---------------------------------------------------------------------------

CREATE POLICY "leaderboard_entries_select_public"
  ON public.leaderboard_entries FOR SELECT
  USING (true);

CREATE POLICY "hall_of_fame_select_public"
  ON public.hall_of_fame FOR SELECT
  USING (true);

CREATE POLICY "corpse_containers_select_public"
  ON public.corpse_containers FOR SELECT
  USING (true);

CREATE POLICY "marketplace_listings_select_active"
  ON public.marketplace_listings FOR SELECT
  TO anon
  USING (status = 'active');

-- ---------------------------------------------------------------------------
-- 4. accounts — own row only
-- ---------------------------------------------------------------------------

CREATE POLICY "accounts_select_own"
  ON public.accounts FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "accounts_update_own"
  ON public.accounts FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. characters — own account's characters
-- ---------------------------------------------------------------------------

CREATE POLICY "characters_select_own"
  ON public.characters FOR SELECT
  TO authenticated
  USING (account_id = auth.uid());

CREATE POLICY "characters_insert_own"
  ON public.characters FOR INSERT
  TO authenticated
  WITH CHECK (account_id = auth.uid());

CREATE POLICY "characters_update_own"
  ON public.characters FOR UPDATE
  TO authenticated
  USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. realm_instances — realms belonging to own characters
-- ---------------------------------------------------------------------------

CREATE POLICY "realm_instances_select_own"
  ON public.realm_instances FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = realm_instances.character_id
      AND characters.account_id = auth.uid()
  ));

CREATE POLICY "realm_instances_insert_own"
  ON public.realm_instances FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = realm_instances.character_id
      AND characters.account_id = auth.uid()
  ));

CREATE POLICY "realm_instances_update_own"
  ON public.realm_instances FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = realm_instances.character_id
      AND characters.account_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = realm_instances.character_id
      AND characters.account_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 7. realm_mutations — mutations for own realms
-- ---------------------------------------------------------------------------

CREATE POLICY "realm_mutations_select_own"
  ON public.realm_mutations FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.realm_instances ri
    JOIN public.characters c ON c.id = ri.character_id
    WHERE ri.id = realm_mutations.realm_instance_id
      AND c.account_id = auth.uid()
  ));

CREATE POLICY "realm_mutations_insert_own"
  ON public.realm_mutations FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.realm_instances ri
    JOIN public.characters c ON c.id = ri.character_id
    WHERE ri.id = realm_mutations.realm_instance_id
      AND c.account_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 8. realm_discovered_map — discovered map data for own realms
-- ---------------------------------------------------------------------------

CREATE POLICY "realm_discovered_map_select_own"
  ON public.realm_discovered_map FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.realm_instances ri
    JOIN public.characters c ON c.id = ri.character_id
    WHERE ri.id = realm_discovered_map.realm_instance_id
      AND c.account_id = auth.uid()
  ));

CREATE POLICY "realm_discovered_map_insert_own"
  ON public.realm_discovered_map FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.realm_instances ri
    JOIN public.characters c ON c.id = ri.character_id
    WHERE ri.id = realm_discovered_map.realm_instance_id
      AND c.account_id = auth.uid()
  ));

CREATE POLICY "realm_discovered_map_update_own"
  ON public.realm_discovered_map FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.realm_instances ri
    JOIN public.characters c ON c.id = ri.character_id
    WHERE ri.id = realm_discovered_map.realm_instance_id
      AND c.account_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.realm_instances ri
    JOIN public.characters c ON c.id = ri.character_id
    WHERE ri.id = realm_discovered_map.realm_instance_id
      AND c.account_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 9. inventory_items — items belonging to own characters
--    (corpse-owned items are publicly readable via corpse_containers)
-- ---------------------------------------------------------------------------

CREATE POLICY "inventory_items_select_own"
  ON public.inventory_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = inventory_items.character_id
      AND characters.account_id = auth.uid()
  ));

CREATE POLICY "inventory_items_insert_own"
  ON public.inventory_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = inventory_items.character_id
      AND characters.account_id = auth.uid()
  ));

CREATE POLICY "inventory_items_update_own"
  ON public.inventory_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = inventory_items.character_id
      AND characters.account_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = inventory_items.character_id
      AND characters.account_id = auth.uid()
  ));

CREATE POLICY "inventory_items_delete_own"
  ON public.inventory_items FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = inventory_items.character_id
      AND characters.account_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 10. run_logs — own character run history (read-only for client)
-- ---------------------------------------------------------------------------

CREATE POLICY "run_logs_select_own"
  ON public.run_logs FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = run_logs.character_id
      AND characters.account_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 11. lore_discovered — own character lore
-- ---------------------------------------------------------------------------

CREATE POLICY "lore_discovered_select_own"
  ON public.lore_discovered FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = lore_discovered.character_id
      AND characters.account_id = auth.uid()
  ));

CREATE POLICY "lore_discovered_insert_own"
  ON public.lore_discovered FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.characters
    WHERE characters.id = lore_discovered.character_id
      AND characters.account_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 12. payment_log — own payment history (read-only for client)
-- ---------------------------------------------------------------------------

CREATE POLICY "payment_log_select_own"
  ON public.payment_log FOR SELECT
  TO authenticated
  USING (account_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 13. marketplace_listings — authenticated users see own + active; manage own
-- ---------------------------------------------------------------------------

CREATE POLICY "marketplace_listings_select_own_or_active"
  ON public.marketplace_listings FOR SELECT
  TO authenticated
  USING (
    seller_account_id = auth.uid()
    OR buyer_account_id = auth.uid()
    OR status = 'active'
  );

CREATE POLICY "marketplace_listings_insert_own"
  ON public.marketplace_listings FOR INSERT
  TO authenticated
  WITH CHECK (seller_account_id = auth.uid());

CREATE POLICY "marketplace_listings_update_own"
  ON public.marketplace_listings FOR UPDATE
  TO authenticated
  USING (seller_account_id = auth.uid())
  WITH CHECK (seller_account_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 14. chat_log — own messages only
-- ---------------------------------------------------------------------------

CREATE POLICY "chat_log_select_own"
  ON public.chat_log FOR SELECT
  TO authenticated
  USING (account_id = auth.uid());

CREATE POLICY "chat_log_insert_own"
  ON public.chat_log FOR INSERT
  TO authenticated
  WITH CHECK (account_id = auth.uid());
