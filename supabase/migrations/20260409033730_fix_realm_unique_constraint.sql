-- Fix: realm_instances UNIQUE (character_id, template_id) blocks re-generation
-- after terminal states (completed / dead_end).
--
-- Replace the absolute UNIQUE with a partial unique index that only constrains
-- non-terminal rows, preserving history for run_logs and legend data.

ALTER TABLE realm_instances
  DROP CONSTRAINT realm_instances_character_id_template_id_key;

CREATE UNIQUE INDEX unique_active_realm_per_template
  ON realm_instances (character_id, template_id)
  WHERE status NOT IN ('completed', 'dead_end');
