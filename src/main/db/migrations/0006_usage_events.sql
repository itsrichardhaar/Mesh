-- 0006_usage_events.sql
-- The Usage Events cache (v7 / Slice 52). Unlike every table before it,
-- this is NOT authored augmentation — it is a *rebuildable derived
-- cache* over the Session JSONL (ADR-0009). Every column is a pure
-- function of the source file; dropping the table and re-sweeping the
-- JSONL reproduces it exactly. Provenance columns (source_file,
-- source_line) trace each row to its origin, and event_id (the
-- assistant message uuid) makes re-ingest idempotent.
--
-- Nothing authored may ever be written here. The moment it is, ADR-0009
-- is violated and the "drop-and-rebuild is a no-op" invariant breaks.

CREATE TABLE usage_events (
  event_id           TEXT NOT NULL PRIMARY KEY,
  encoded_path       TEXT NOT NULL,
  session_id         TEXT NOT NULL,
  timestamp          TEXT NOT NULL,
  model              TEXT,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  service_tier       TEXT,
  git_branch         TEXT,
  cwd                TEXT,
  source_file        TEXT NOT NULL,
  source_line        INTEGER NOT NULL
);

-- by-project breakdown + per-Project Usage strip (Slices 54–56).
CREATE INDEX idx_usage_events_project ON usage_events (encoded_path);
-- usage trend + activity ordering (Slice 54).
CREATE INDEX idx_usage_events_time ON usage_events (timestamp);
-- session explorer drill-down (Slice 55).
CREATE INDEX idx_usage_events_session ON usage_events (session_id);

-- Per-file ingest cursor so the watcher tail-ingests only appended lines
-- rather than re-parsing whole files. A rebuildable companion to the
-- cache above — wiped alongside it on a manual Rebuild.
CREATE TABLE usage_ingest_state (
  source_file  TEXT NOT NULL PRIMARY KEY,
  byte_offset  INTEGER NOT NULL,
  line_count   INTEGER NOT NULL,
  updated_at   TEXT NOT NULL
);
