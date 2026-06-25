// Cross-process domain types shared between main, preload, and renderer.
// Keep this file Electron-free so the renderer can import it without
// pulling Node-only modules into the browser bundle.

export interface Project {
  /** Claude Code's encoded directory name, e.g. `-Users-richardhaar-Desktop-Mesh`. Primary key. */
  encodedPath: string
  /** The Project's absolute Source Path on disk, e.g. `/Users/richardhaar/Desktop/Mesh`. */
  sourcePath: string
  /** Display name — typically `basename(sourcePath)`, overridable by the user (Slice 4+). */
  name: string
  /** Auto-detected stack subtitle (e.g., `Next.js`, `Rust`). `null` until detection runs or when no canonical files match. */
  autoSubtitle: string | null
  /** ISO 8601 timestamp of the newest event across the Project's Sessions. */
  activity: string
  /** True when the resolved Source Path no longer exists (or isn't a directory) on disk. */
  sourceMissing: boolean
  /** True when the user has flagged this Project as hidden in the sidebar. */
  hidden: boolean
}

/**
 * Deterministic Stats Row counters. `lastActivityAt` is the precise event
 * timestamp from the newest JSONL line — distinct from `Project.activity`
 * which mirrors the newest JSONL file's mtime for sort purposes.
 */
export interface ProjectStats {
  sessionCount: number
  filesTouchedCount: number
  lastActivityAt: string | null
}

/**
 * Theme preference. `system` follows the OS `prefers-color-scheme` and
 * re-evaluates live; `light` and `dark` are explicit user choices that
 * override the system signal.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

/**
 * Patch shape accepted by the `projects.update` IPC. Each key maps to a
 * single column on the `projects` table. Slice 3 exposes `hidden`; later
 * slices add more updatable fields here.
 */
export interface ProjectPatch {
  hidden?: boolean
}
