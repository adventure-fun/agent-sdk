
-- Identify IDs to delete (duplicates — NOT the most recent per character+template)
-- Using a CTE for clarity and reuse
WITH keepers AS (
  SELECT DISTINCT ON (character_id, template_id) id
  FROM realm_instances
  ORDER BY character_id, template_id, created_at DESC
),
to_delete AS (
  SELECT id FROM realm_instances WHERE id NOT IN (SELECT id FROM keepers)
)

-- Step 1: Clean up all FK-referencing tables for duplicates
DELETE FROM realm_mutations WHERE realm_instance_id IN (SELECT id FROM to_delete);

-- Re-declare CTE for each statement (Postgres requires it)
WITH keepers AS (
  SELECT DISTINCT ON (character_id, template_id) id
  FROM realm_instances
  ORDER BY character_id, template_id, created_at DESC
),
to_delete AS (
  SELECT id FROM realm_instances WHERE id NOT IN (SELECT id FROM keepers)
)
DELETE FROM realm_discovered_map WHERE realm_instance_id IN (SELECT id FROM to_delete);

WITH keepers AS (
  SELECT DISTINCT ON (character_id, template_id) id
  FROM realm_instances
  ORDER BY character_id, template_id, created_at DESC
),
to_delete AS (
  SELECT id FROM realm_instances WHERE id NOT IN (SELECT id FROM keepers)
)
DELETE FROM corpse_containers WHERE realm_instance_id IN (SELECT id FROM to_delete);

WITH keepers AS (
  SELECT DISTINCT ON (character_id, template_id) id
  FROM realm_instances
  ORDER BY character_id, template_id, created_at DESC
),
to_delete AS (
  SELECT id FROM realm_instances WHERE id NOT IN (SELECT id FROM keepers)
)
DELETE FROM run_logs WHERE realm_instance_id IN (SELECT id FROM to_delete);

-- Step 2: Now delete the duplicate realm_instances
WITH keepers AS (
  SELECT DISTINCT ON (character_id, template_id) id
  FROM realm_instances
  ORDER BY character_id, template_id, created_at DESC
)
DELETE FROM realm_instances WHERE id NOT IN (SELECT id FROM keepers);

-- Step 3: Add UNIQUE constraint
ALTER TABLE realm_instances ADD CONSTRAINT realm_instances_character_template_unique
  UNIQUE (character_id, template_id);

-- Step 4: Add completions tracking column
ALTER TABLE realm_instances ADD COLUMN completions INTEGER NOT NULL DEFAULT 0;

-- Step 5: Set completions to 1 for all currently completed realms
UPDATE realm_instances SET completions = 1 WHERE status = 'completed';
