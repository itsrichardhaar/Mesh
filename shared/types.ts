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
  /** ISO 8601 timestamp of the newest event across the Project's Sessions. */
  activity: string
  /** True when the resolved Source Path no longer exists (or isn't a directory) on disk. */
  sourceMissing: boolean
  /** True when the user has flagged this Project as hidden in the sidebar. */
  hidden: boolean
}

/**
 * Patch shape accepted by the `projects.update` IPC. Each key maps to a
 * single column on the `projects` table. Slice 3 exposes `hidden`; later
 * slices add more updatable fields here.
 */
export interface ProjectPatch {
  hidden?: boolean
}
