-- Chat persistence: extend chat_log to record which room a message was posted to
-- (global lobby vs per-character spectate chat), preserve sender class/type, and
-- carry the spectate-context metadata we attach when mirroring spectate messages
-- into the global feed.
--
-- Existing behaviour was purely in-memory on the backend process. The LobbyLive-
-- Manager and SpectateChatManager each hold a 50-message ring buffer per room,
-- which is lost on restart and invisible to other backend instances. This
-- migration gives us durable storage so we can rehydrate those buffers on boot
-- and expose a longer backlog to late-joining clients.

-- ── Schema additions ─────────────────────────────────────────────────────────

ALTER TABLE public.chat_log
  ADD COLUMN IF NOT EXISTS room_type TEXT NOT NULL DEFAULT 'lobby'
    CHECK (room_type IN ('lobby', 'spectate')),
  ADD COLUMN IF NOT EXISTS room_key TEXT,
  ADD COLUMN IF NOT EXISTS character_class TEXT,
  ADD COLUMN IF NOT EXISTS player_type TEXT
    CHECK (player_type IN ('human', 'agent')),
  ADD COLUMN IF NOT EXISTS spectate_context JSONB;

-- Enforce the room_type ⇔ room_key relationship:
--   lobby   → room_key must be NULL
--   spectate → room_key must be set (the character_id being watched)
ALTER TABLE public.chat_log
  DROP CONSTRAINT IF EXISTS chat_log_room_key_matches_type;

ALTER TABLE public.chat_log
  ADD CONSTRAINT chat_log_room_key_matches_type CHECK (
    (room_type = 'lobby'    AND room_key IS NULL) OR
    (room_type = 'spectate' AND room_key IS NOT NULL)
  );

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Primary read pattern: "give me the last N messages in room X, newest first".
-- This index serves both the lobby query (room_key IS NULL, filtered by type)
-- and every per-character spectate room.
CREATE INDEX IF NOT EXISTS idx_chat_log_room_recent
  ON public.chat_log (room_type, room_key, created_at DESC);

-- Secondary: find a user's recent activity (for moderation tooling later).
CREATE INDEX IF NOT EXISTS idx_chat_log_account_recent
  ON public.chat_log (account_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

-- The table already has RLS enabled from migration 20260412000000. The backend
-- uses the service-role key so it bypasses RLS; we don't add client-facing
-- SELECT policies here because all chat reads go through the backend WebSocket
-- + REST endpoints and never directly from the browser.
