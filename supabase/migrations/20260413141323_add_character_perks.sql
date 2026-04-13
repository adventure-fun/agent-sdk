-- Add perks column for the dual-track skill system.
-- See docs/ABILITIES_AND_SKILLS.md §4 for context.
--
-- Perks are a shared pool of stackable passive stat buffs. Every level-up
-- earns 1 perk point which can be spent on any perk (up to that perk's
-- max_stacks cap). Tier choices in the skill tree remain separate — they
-- unlock as milestone rewards at levels 3, 6, and 10 and do NOT consume
-- perk points.
--
-- Storage shape: Record<perk_id, stack_count>
--   e.g. { "perk-toughness": 3, "perk-sharpness": 1 }
-- Default '{}' means existing rows transparently have no perks.

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS perks JSONB NOT NULL DEFAULT '{}';
