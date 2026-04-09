-- Group 8: Session and Persistence Improvements
-- Adds session_state (enemy positions, HP, effects on disconnect) and rng_state
-- (deterministic RNG offset for exact replay fidelity across reconnects).

ALTER TABLE realm_instances ADD COLUMN IF NOT EXISTS session_state JSONB;
ALTER TABLE realm_instances ADD COLUMN IF NOT EXISTS rng_state INTEGER;
