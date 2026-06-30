-- 0005_project_mute_notifications.sql
-- Adds a per-Project mute flag (Slice 43, v5). When set, notifications
-- for that Project still persist to the `notifications` table but the
-- `notifications:created` toast event is suppressed. Matches macOS DND
-- behavior — silencing the toast, not the record — so the user can
-- review what they missed in the dropdown when they unmute.
--
-- The existing projects table is augmentation-only (the canonical
-- Project list is sourced from `~/.claude/projects/` per ADR-0002),
-- so adding a column here keeps the data-loss exposure to zero.

ALTER TABLE projects ADD COLUMN mute_notifications INTEGER NOT NULL DEFAULT 0;
