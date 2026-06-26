/**
 * Replace the user's home-directory prefix with `~` for display.
 *
 * Heuristic, not exhaustive: matches the macOS `/Users/<name>` and Linux
 * `/home/<name>` conventions. Paths outside those roots are returned
 * unchanged. Mesh's v1 is macOS-only, so this covers our case; the
 * Linux fallback is for future-proofing when we add Linux installers.
 *
 * Examples:
 *   /Users/richardhaar/Desktop/Mesh  →  ~/Desktop/Mesh
 *   /Users/richardhaar                →  ~
 *   /opt/projects/foo                 →  /opt/projects/foo (unchanged)
 */
export function tildify(absPath: string): string {
  const match = absPath.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(\/.*)?$/)
  if (!match) return absPath
  const rest = match[2] ?? ''
  return rest === '' ? '~' : `~${rest}`
}
