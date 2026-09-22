import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { GateRunMeta, WorktreeRunSubtype } from '@shared/types'
import { recognizeWorktreeRun } from '../gate/recognize'

/**
 * The raw filesystem-discovered view of a Project — what the enumerator
 * can determine from `~/.claude/projects/` alone. Augmentation fields
 * like `hidden` and `name_override` live in SQLite and are joined on
 * top of this in the projects repository.
 */
export interface DiscoveredProject {
  encodedPath: string
  sourcePath: string
  name: string
  activity: string
  sourceMissing: boolean
  /** `'worktreeRun'` when the Source Path is a recognized git worktree (ADR-0014). */
  kind: 'project' | 'worktreeRun'
  /** Worktree Run subtype (`'gate'` in Slice A), or `null` for ordinary Projects. */
  subtype: WorktreeRunSubtype | null
  /** Gate Run ids from path recognition; enrichment fields stay `null` until Slice C. */
  gate: GateRunMeta | null
}

/**
 * Read `~/.claude/projects/` and return a Project per subdirectory,
 * sorted by Activity (newest event timestamp) descending.
 *
 * The Source Path is resolved by reading the `cwd` field from the
 * newest session JSONL — Claude Code's encoded directory name is
 * lossy (it collapses `/`, ` `, and literal `-` all into `-`), so
 * round-tripping the string isn't reliable. We fall back to a lossy
 * decode only if no JSONL records a `cwd`.
 *
 * Returns `[]` if `rootDir` doesn't exist. Subdirectories that can't
 * be read, or that contain no `.jsonl` files, are skipped.
 */
export async function listProjects(rootDir: string): Promise<DiscoveredProject[]> {
  let entries: string[]
  try {
    entries = await readdir(rootDir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const projects: DiscoveredProject[] = []

  for (const encodedPath of entries) {
    const projectDir = join(rootDir, encodedPath)

    let dirStat
    try {
      dirStat = await stat(projectDir)
    } catch {
      continue
    }
    if (!dirStat.isDirectory()) continue

    const newest = await findNewestJsonl(projectDir)
    if (!newest) continue

    const sourcePath =
      (await readCwdFromJsonl(newest.path)) ?? lossyDecode(encodedPath)
    const name = basename(sourcePath)
    const sourceMissing = await isSourceMissing(sourcePath)

    // ADR-0014: recognize a Worktree Run from its path (disk-independent, so it
    // works even after a merged run's worktree is deleted). Slice A carries the
    // gate ids only; attribution + enrichment come in Slices B/C.
    const recognition = recognizeWorktreeRun(sourcePath)
    const gate: GateRunMeta | null = recognition
      ? {
          repoId: recognition.repoId,
          runId: recognition.runId,
          status: null,
          prUrl: null,
          prState: null,
          branch: null,
          intent: null
        }
      : null

    projects.push({
      encodedPath,
      sourcePath,
      name,
      activity: new Date(newest.mtimeMs).toISOString(),
      sourceMissing,
      kind: recognition ? 'worktreeRun' : 'project',
      subtype: recognition ? recognition.kind : null,
      gate
    })
  }

  projects.sort((a, b) => (a.activity < b.activity ? 1 : a.activity > b.activity ? -1 : 0))
  return projects
}

async function isSourceMissing(sourcePath: string): Promise<boolean> {
  try {
    const s = await stat(sourcePath)
    return !s.isDirectory()
  } catch {
    return true
  }
}

interface NewestJsonl {
  path: string
  mtimeMs: number
}

async function findNewestJsonl(projectDir: string): Promise<NewestJsonl | null> {
  let files: string[]
  try {
    files = await readdir(projectDir)
  } catch {
    return null
  }

  let newest: NewestJsonl | null = null
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue
    const filePath = join(projectDir, file)
    try {
      const s = await stat(filePath)
      if (!s.isFile()) continue
      if (!newest || s.mtimeMs > newest.mtimeMs) {
        newest = { path: filePath, mtimeMs: s.mtimeMs }
      }
    } catch {
      // skip unreadable
    }
  }
  return newest
}

async function readCwdFromJsonl(jsonlPath: string): Promise<string | null> {
  const stream = createReadStream(jsonlPath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const obj = JSON.parse(trimmed) as { cwd?: unknown }
        if (typeof obj.cwd === 'string' && obj.cwd.length > 0) {
          return obj.cwd
        }
      } catch {
        // malformed JSON line; skip
      }
    }
  } finally {
    rl.close()
    stream.close()
  }
  return null
}

/**
 * Last-resort decode when no JSONL records a `cwd`. Replaces dashes
 * with slashes, which is correct for the path-separator dashes but
 * wrong for any dash inside an original directory or file name.
 * Use sparingly; the `cwd` path is always preferred when available.
 */
function lossyDecode(encodedPath: string): string {
  return encodedPath.replace(/-/g, '/')
}
