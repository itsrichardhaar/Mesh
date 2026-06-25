-- 0000_init.sql
-- Initial migration: app-level metadata table.
-- Domain schema (projects, sessions_meta, analyses, settings) starts at 0001 in Slice 2.

CREATE TABLE meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

INSERT INTO meta (key, value) VALUES ('schema_version', '0000');
