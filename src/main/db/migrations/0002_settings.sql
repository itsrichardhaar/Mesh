-- 0002_settings.sql
-- Single key/value store for Mesh's app-level preferences. Strings go in
-- `value`; encrypted secrets (Slice 7) will go in `value_blob`. Exactly
-- one of `value` / `value_blob` is populated per row.

CREATE TABLE settings (
  key         TEXT    PRIMARY KEY NOT NULL,
  value       TEXT,
  value_blob  BLOB,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
