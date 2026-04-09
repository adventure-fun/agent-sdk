ALTER TABLE realm_instances
  DROP CONSTRAINT IF EXISTS realm_instances_status_check;

ALTER TABLE realm_instances
  ADD CONSTRAINT realm_instances_status_check
  CHECK (status IN ('generated', 'active', 'paused', 'boss_cleared', 'realm_cleared', 'completed', 'dead_end'));
