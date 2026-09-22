/**
 * Git-plumbing detector for **live, generic Worktree Runs** (ADR-0014) — the
 * complement to the disk-independent path detector in `recognize.ts`. A
 * still-on-disk Source Path that isn't a Gate Run may nonetheless be a linked
 * git worktree of some other repo; if so, that repo's main worktree is its
 * Parent Project.
 *
 * Everything here is best-effort: a missing `git`, a non-repo directory, or any
 * subprocess failure resolves to `null` (not a worktree), never a throw.
 */
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Cap so a hung `git` can never stall a sidebar refresh. */
const GIT_TIMEOUT_MS = 2_000

/**
 * Canonicalize a path for equality comparison — resolves symlinks (e.g. macOS
 * `/var` → `/private/var`, common in temp dirs) so a worktree's recorded parent
 * matches the discovered Project's Source Path. Falls back to the input when the
 * path can't be resolved (e.g. the dir is gone).
 */
export function canonicalizePath(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return p
  }
}

/**
 * If `dir` is a **linked** git worktree, return the absolute path of its main
 * worktree (the Parent). Returns `null` for an ordinary repo, a non-repo, or on
 * any failure.
 *
 * Fast path: a linked worktree's `.git` is a *file* (a `gitdir:` pointer), never
 * a directory — so we cheaply reject the overwhelmingly common case (ordinary
 * repos and plain folders) with a single `stat` before spending a subprocess.
 */
export async function resolveMainWorktree(dir: string): Promise<string | null> {
  try {
    const gitPath = join(dir, '.git')
    const gitStat = await stat(gitPath).catch(() => null)
    if (!gitStat || !gitStat.isFile()) return null

    // `--git-common-dir` is the shared git dir (the main worktree's `.git`),
    // identical across all worktrees; `--git-dir` is this worktree's own git dir
    // (`<main>/.git/worktrees/<name>`). They differ iff we're in a linked
    // worktree. The main worktree top-level is the parent of the common dir.
    const { stdout } = await execFileAsync(
      'git',
      ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--git-dir'],
      { timeout: GIT_TIMEOUT_MS }
    )
    const [commonDir, gitDir] = stdout.trim().split('\n')
    if (!commonDir || !gitDir) return null
    if (canonicalizePath(commonDir) === canonicalizePath(gitDir)) return null // main worktree

    const mainWorktree = dirname(commonDir)
    if (canonicalizePath(mainWorktree) === canonicalizePath(dir)) return null
    return mainWorktree
  } catch {
    return null
  }
}
