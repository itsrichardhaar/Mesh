// Cross-process domain types shared between main, preload, and renderer.
// Keep this file Electron-free so the renderer can import it without
// pulling Node-only modules into the browser bundle.

export interface Project {
  /** Claude Code's encoded directory name, e.g. `-Users-richardhaar-Desktop-Mesh`. Primary key. */
  encodedPath: string
  /** The Project's absolute Source Path on disk, e.g. `/Users/richardhaar/Desktop/Mesh`. */
  sourcePath: string
  /** Display name — typically `basename(sourcePath)`. */
  name: string
  /** ISO 8601 timestamp of the newest event across the Project's Sessions. */
  activity: string
}
