-- 0004_notifications.sql
-- Persistent records of moments that may need user attention in a
-- Project's Pty Tab (v5 / Slice 41). Created by the main-process idle
-- detector when a live Pty Tab transitions from active to idle while
-- the user is not currently foregrounding that tab. Surfaced as a
-- top-right toast on creation (Slice 42) and as a row in the bell-
-- icon dropdown until read or cleared. 7-day retention sweep runs on
-- app boot.
--
-- `pty_id` is nullable: the row outlives its underlying PTY process,
-- so a user opening the dropdown an hour later may click a row whose
-- ptyId has long since exited. `kind` is plain TEXT (not CHECK-
-- constrained) so future subtypes (`approval`, `complete`, etc.) are
-- code changes, not migrations — the renderer treats unknown kinds
-- as `'idle'` for graceful degradation.

CREATE TABLE notifications (
  id            TEXT NOT NULL PRIMARY KEY,
  created_at    TEXT NOT NULL,
  encoded_path  TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  pty_id        TEXT,
  kind          TEXT NOT NULL,
  label_text    TEXT NOT NULL,
  read_at       TEXT
);

-- Newest-first lookup — covers `listNotifications` ordering.
CREATE INDEX idx_notifications_recent ON notifications (created_at DESC);

-- Partial index over unread rows only — keeps the unread-badge query
-- and the "unread-first within same day" sort fast without indexing
-- the full table by read state.
CREATE INDEX idx_notifications_unread ON notifications (read_at) WHERE read_at IS NULL;
