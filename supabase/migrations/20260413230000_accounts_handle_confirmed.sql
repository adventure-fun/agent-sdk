-- Add `handle_confirmed` flag to accounts — issue/ask "leaderboard gating
-- for anon handles".
--
-- Problem: /auth/connect auto-assigns a fun anon handle like
-- `anon-silly-smelly-rat` to every new account so the leaderboard,
-- chat, and profile header never render a bare wallet fragment. That's
-- a nice default but it means brand-new users immediately appear on the
-- public leaderboard under a randomly-generated name they may not
-- have seen yet. The design direction from product was:
--
--   1. Unconfirmed anon-handle users should NOT appear on the
--      leaderboard.
--   2. They SHOULD still appear in spectate + chat + character pages
--      (their runs are still watchable, they can still socialize).
--   3. A user becomes "confirmed" either by editing their handle to
--      something custom (via PATCH /auth/profile) or by explicitly
--      clicking "Keep this handle" on their own profile page.
--   4. The unconfirmed state is PRIVATE to the viewer — other users
--      should never know someone is on an unconfirmed anon handle.
--      Only the user themselves sees the nudge indicator.
--
-- New column: `accounts.handle_confirmed BOOLEAN DEFAULT FALSE`.
-- Indexed alongside the filter the leaderboard query will use.
--
-- Backfill: any existing account whose handle is set AND doesn't start
-- with `anon-` is marked confirmed. These are users who picked a
-- handle deliberately (either via a pre-generator code path or via
-- the PATCH endpoint) and shouldn't suddenly drop off the leaderboard
-- because of this change. The two accounts the backfill-anon-handles
-- script assigned fresh anon handles to (anon-clumsy-bouncy-imp and
-- anon-twitchy-pudgy-ghost) stay `confirmed=false` until they log in
-- and pick an action.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS handle_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: non-anon handles are already "confirmed" by virtue of
-- being custom-set. Anything starting with "anon-" needs an explicit
-- user action to become confirmed.
UPDATE public.accounts
SET handle_confirmed = TRUE
WHERE handle IS NOT NULL
  AND handle NOT LIKE 'anon-%';

-- Partial index to accelerate the leaderboard filter. We only need to
-- scan confirmed accounts for the filtered query, so a partial index
-- on that subset is cheaper than a full-table index.
CREATE INDEX IF NOT EXISTS idx_accounts_handle_confirmed_true
  ON public.accounts (id)
  WHERE handle_confirmed = TRUE;
