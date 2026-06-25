-- 0001_projects.sql
-- The projects table is the augmentation store for Mesh-owned data
-- about each Project. The Project list itself is sourced from
-- ~/.claude/projects/ at runtime (ADR-0002); this table only holds
-- what Mesh adds: state (hidden, pinned, source_missing), user
-- overrides (name_override, subtitle_descriptor, accent_color),
-- auto-detected metadata (auto_name, auto_subtitle), and pointers
-- to the latest Analysis (filled in by later slices).

CREATE TABLE projects (
  encoded_path  TEXT    PRIMARY KEY NOT NULL,
  source_path   TEXT    NOT NULL,
  source_missing INTEGER NOT NULL DEFAULT 0,

  name_override        TEXT,
  subtitle_descriptor  TEXT,
  auto_name            TEXT NOT NULL,
  auto_subtitle        TEXT,
  accent_color         TEXT,

  pinned  INTEGER NOT NULL DEFAULT 0,
  hidden  INTEGER NOT NULL DEFAULT 0,
  last_metadata_detected_at TEXT,

  last_analyzed_at           TEXT,
  last_analyzed_sha          TEXT,
  last_analyzed_session_uuid TEXT
);

CREATE INDEX idx_projects_hidden ON projects(hidden);
