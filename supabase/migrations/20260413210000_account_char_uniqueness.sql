-- Unique constraints on account handles + character names (issue #4)
--
-- Two new invariants:
--
--   1. accounts.handle is unique, case-insensitively. "Jimmy" and "jimmy"
--      can't both exist as handles. Enforced with a functional unique index
--      on lower(handle) rather than a plain UNIQUE so case-differences are
--      caught.
--
--   2. characters.(account_id, name) is unique. A single account can never
--      have two characters with the same name — including dead ones —
--      because the character name is the display-friendly identity that
--      shows up on the leaderboard, spectate, and chat. A character name
--      that's already been used is not available for a reroll.
--
-- Legacy data note: the hosted DB has four (account_id, name) groups with
-- duplicates at the time this migration was written, all from one-user
-- test accounts that rerolled the same name multiple times. Rather than
-- destroying legend rows, this migration RENAMES the older entries in
-- each duplicate set to `{original}-2`, `{original}-3`, ... preserving
-- the newest character with its original name. The legend page URL for
-- the older rows continues to work (they're keyed by character_id).

-- ── Rename legacy duplicates so the new constraint can land ──────────────
--
-- row_number() partitioned by (account_id, name) ordered by created_at
-- descending — the *newest* character in each group gets rn=1 and keeps
-- its original name. Everyone else gets a numeric suffix.

WITH ranked AS (
  SELECT
    id,
    name,
    account_id,
    row_number() OVER (
      PARTITION BY account_id, name
      ORDER BY created_at DESC, id
    ) AS rn
  FROM public.characters
),
to_rename AS (
  SELECT id, name || '-' || rn::text AS new_name
  FROM ranked
  WHERE rn > 1
)
UPDATE public.characters c
SET name = to_rename.new_name
FROM to_rename
WHERE c.id = to_rename.id;

-- ── The constraints themselves ───────────────────────────────────────────

-- Case-insensitive unique handle.
-- Existing schema (initial_schema.sql line 11) already has `UNIQUE` on
-- handle, but that's case-sensitive. Drop it and replace with a functional
-- index on lower(handle).
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_handle_key;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_handle_lower_key
  ON public.accounts (LOWER(handle))
  WHERE handle IS NOT NULL;

-- (account_id, name) unique on characters.
ALTER TABLE public.characters
  DROP CONSTRAINT IF EXISTS characters_account_name_key;

ALTER TABLE public.characters
  ADD CONSTRAINT characters_account_name_key UNIQUE (account_id, name);

-- ── chat_log.character_id (issue #7) ─────────────────────────────────────
--
-- Chat messages need to carry the sender's character_id so the frontend
-- can render each name as a link to /character/[id] (ticket #7 — chat
-- enhancements). Historical rows obviously can't be retroactively
-- assigned, so the column is NULLABLE and the frontend renders a plain
-- span when it's missing. New messages inserted by persistChatMessage
-- will populate it going forward.
--
-- Not a foreign key because we want chat history to survive even if a
-- character is later deleted (unlikely today, but the audit-trail use
-- case calls for it). Character existence is validated at the POST
-- endpoint.

ALTER TABLE public.chat_log
  ADD COLUMN IF NOT EXISTS character_id TEXT;

-- Index for future moderation tooling that wants "all messages from
-- this character" in chronological order.
CREATE INDEX IF NOT EXISTS idx_chat_log_character_recent
  ON public.chat_log (character_id, created_at DESC)
  WHERE character_id IS NOT NULL;
