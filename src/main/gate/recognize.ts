/**
 * Recognizes whether a Project's Source Path is actually a **Worktree Run** —
 * a git worktree Claude Code ran in, rather than a directory the user opened
 * directly (see CONTEXT.md, ADR-0014).
 *
 * Slice A ships the disk-independent detector for the `no-mistakes` **Gate Run**
 * subtype: it keys purely on the path, so it recognizes a run even after its
 * worktree has been merged and deleted (the common end state). The git-plumbing
 * detector for still-live generic worktrees lands in Slice B.
 */

/** A `no-mistakes` gate worktree path segment: `.no-mistakes/worktrees/<repoId>/<runId>`.
 *
 * - The prefix is matched *anywhere* in the path (preceded by `/` or the start),
 *   not `$HOME`-anchored, so it survives no-mistakes' `store_in_repo` layout and
 *   any relocated home.
 * - `<repoId>` is validated as hex, `<runId>` as a Crockford-base32 ULID (26 chars,
 *   excluding I/L/O/U), and the ULID must be the *final* path segment — so a path
 *   that merely contains the segment mid-way (e.g. a file inside the worktree) does
 *   not match.
 */
const GATE_WORKTREE_RE =
  /(?:^|\/)\.no-mistakes\/worktrees\/([0-9a-f]{6,})\/([0-9A-HJKMNP-TV-Z]{26})\/?$/

export interface WorktreeRunRecognition {
  /** The Worktree Run subtype. Only `'gate'` is recognized in Slice A. */
  kind: 'gate'
  /** no-mistakes repo id (the stable per-repo identifier). */
  repoId: string
  /** no-mistakes run id (the worktree ULID; equals `runs.id` in state.sqlite). */
  runId: string
}

/**
 * Classify a decoded Source Path. Returns a recognition when the path is a
 * no-mistakes Gate Run worktree, or `null` for an ordinary Project.
 */
export function recognizeWorktreeRun(sourcePath: string): WorktreeRunRecognition | null {
  const match = GATE_WORKTREE_RE.exec(sourcePath)
  if (!match) return null
  return { kind: 'gate', repoId: match[1], runId: match[2] }
}
