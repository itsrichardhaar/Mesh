import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import ignore, { type Ignore } from 'ignore'
import type { FileNode } from '@shared/files'

const GITIGNORE_FILENAME = '.gitignore'

/**
 * Heavy directories that virtually every project ignores. We tell
 * chokidar to skip them at watcher setup so the recursive scan
 * doesn't crawl through `node_modules` (thousands of files) before
 * the renderer even gets its first paint.
 */
const HEAVY_WATCH_IGNORES = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])dist([\\/]|$)/,
  /(^|[\\/])out([\\/]|$)/,
  /(^|[\\/])\.next([\\/]|$)/,
  /(^|[\\/])\.turbo([\\/]|$)/,
  /(^|[\\/])target([\\/]|$)/,
  /(^|[\\/])\.venv([\\/]|$)/,
  /(^|[\\/])__pycache__([\\/]|$)/
]

const watchers = new Map<string, FSWatcher>()

/**
 * List immediate children of `relPath` under `sourcePath`. Returns
 * directories first, then files, each alphabetized. Entries that
 * match the project's `.gitignore` (root-level only in Slice 13) or
 * are dotfiles are hidden unless `showHidden` is true. Symlinks are
 * skipped entirely so we never traverse off-root.
 *
 * Throws when `relPath` would escape `sourcePath` (e.g. via `..`),
 * so a compromised renderer can't trick main into reading outside
 * the Project root.
 */
export async function listDirectory(
  sourcePath: string,
  relPath: string,
  showHidden: boolean
): Promise<FileNode[]> {
  const resolvedRoot = resolve(sourcePath)
  const targetDir = resolve(resolvedRoot, relPath)
  if (!isWithin(resolvedRoot, targetDir)) {
    throw new Error('FileTreeService: relPath escapes the project root')
  }

  const matcher = showHidden ? null : await loadGitignore(resolvedRoot)

  let dirents
  try {
    dirents = await readdir(targetDir, { withFileTypes: true })
  } catch {
    return []
  }

  const out: FileNode[] = []
  for (const dirent of dirents) {
    const name = dirent.name
    if (!showHidden && name.startsWith('.') && name !== '.gitignore') continue
    if (dirent.isSymbolicLink()) continue

    const isDir = dirent.isDirectory()
    const abs = join(targetDir, name)
    const rel = posixRel(resolvedRoot, abs)

    if (matcher) {
      const probe = isDir ? `${rel}/` : rel
      if (matcher.ignores(probe)) continue
    }

    const node: FileNode = {
      name,
      relPath: rel,
      type: isDir ? 'dir' : 'file'
    }
    if (isDir) {
      node.hasChildren = await directoryHasVisibleChildren(abs, resolvedRoot, matcher, showHidden)
    }
    out.push(node)
  }

  out.sort(byTypeThenName)
  return out
}

/**
 * Attach (or re-attach) a chokidar watcher for the Project root.
 * `onChange` fires for any add/unlink/change/addDir/unlinkDir event;
 * the renderer is expected to re-fetch whichever directories it
 * currently has expanded. Repeated calls for the same encodedPath
 * close the prior watcher first so callers can't accidentally double-
 * subscribe.
 */
export function watchProject(
  encodedPath: string,
  sourcePath: string,
  onChange: () => void
): void {
  closeProject(encodedPath)
  const watcher = chokidar.watch(sourcePath, {
    ignored: HEAVY_WATCH_IGNORES,
    ignoreInitial: true,
    followSymlinks: false,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })
  watcher.on('all', () => onChange())
  watchers.set(encodedPath, watcher)
}

export function closeProject(encodedPath: string): void {
  const existing = watchers.get(encodedPath)
  if (existing) {
    void existing.close()
    watchers.delete(encodedPath)
  }
}

export async function closeAll(): Promise<void> {
  for (const [, watcher] of watchers) {
    await watcher.close()
  }
  watchers.clear()
}

async function loadGitignore(rootDir: string): Promise<Ignore | null> {
  try {
    const raw = await readFile(join(rootDir, GITIGNORE_FILENAME), 'utf-8')
    const ig = ignore().add(raw)
    ig.add('.git')
    return ig
  } catch {
    const ig = ignore().add('.git')
    return ig
  }
}

async function directoryHasVisibleChildren(
  absDir: string,
  rootDir: string,
  matcher: Ignore | null,
  showHidden: boolean
): Promise<boolean> {
  let dirents
  try {
    dirents = await readdir(absDir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const dirent of dirents) {
    const name = dirent.name
    if (!showHidden && name.startsWith('.') && name !== '.gitignore') continue
    if (dirent.isSymbolicLink()) continue
    const isDir = dirent.isDirectory()
    const rel = posixRel(rootDir, join(absDir, name))
    if (matcher) {
      const probe = isDir ? `${rel}/` : rel
      if (matcher.ignores(probe)) continue
    }
    return true
  }
  return false
}

function posixRel(rootDir: string, abs: string): string {
  const rel = relative(rootDir, abs)
  if (rel === '') return ''
  return sep === posix.sep ? rel : rel.split(sep).join(posix.sep)
}

function isWithin(rootDir: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const rel = relative(rootDir, candidate)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  return !isAbsolute(rel)
}

function byTypeThenName(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name)
}
