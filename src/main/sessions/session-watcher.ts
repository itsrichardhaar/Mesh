import chokidar, { type FSWatcher } from 'chokidar'

/**
 * Per-Project chokidar watcher rooted at `~/.claude/projects/<encoded>/`.
 * Fires `onChange` when any `.jsonl` file is added, removed, or
 * modified — the renderer is expected to re-fetch the Sessions list
 * and (if a session is open) the active transcript. The watcher is
 * non-recursive: the Claude Projects folder is flat at the JSONL
 * level, and sub-directories like `<uuid>/` carry tool-result blobs
 * that don't affect the Sessions list. Repeated calls for the same
 * `encodedPath` close the prior watcher first so callers can't
 * accidentally double-subscribe.
 */

const watchers = new Map<string, FSWatcher>()

export function watchSessions(
  encodedPath: string,
  projectDir: string,
  onChange: () => void
): void {
  closeSessionWatcher(encodedPath)
  const watcher = chokidar.watch(projectDir, {
    ignoreInitial: true,
    followSymlinks: false,
    persistent: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })
  watcher.on('all', (_event, path) => {
    if (typeof path === 'string' && !path.endsWith('.jsonl')) return
    onChange()
  })
  watchers.set(encodedPath, watcher)
}

export function closeSessionWatcher(encodedPath: string): void {
  const existing = watchers.get(encodedPath)
  if (existing) {
    void existing.close()
    watchers.delete(encodedPath)
  }
}

export async function closeAllSessionWatchers(): Promise<void> {
  for (const [, watcher] of watchers) {
    await watcher.close()
  }
  watchers.clear()
}
