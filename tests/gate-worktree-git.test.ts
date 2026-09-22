import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveMainWorktree } from '@main/gate/worktree-git'

const execFileAsync = promisify(execFile)

/**
 * Exercises the real git plumbing against a real linked worktree (ADR-0014,
 * Slice B) — the one detector we can't fake, so we build an actual repo.
 */
describe('resolveMainWorktree (real git)', () => {
  let root: string
  let mainRepo: string
  let worktree: string
  let plainDir: string

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'mesh-wt-')))
    mainRepo = join(root, 'repo')
    worktree = join(root, 'wt-feature')
    plainDir = join(root, 'plain')

    const git = (cwd: string, args: string[]): Promise<unknown> =>
      execFileAsync('git', ['-C', cwd, ...args], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'T',
          GIT_AUTHOR_EMAIL: 't@e',
          GIT_COMMITTER_NAME: 'T',
          GIT_COMMITTER_EMAIL: 't@e'
        }
      })

    await execFileAsync('git', ['init', '-b', 'main', mainRepo])
    await git(mainRepo, ['commit', '--allow-empty', '-m', 'root'])
    await git(mainRepo, ['worktree', 'add', worktree, '-b', 'feature'])

    await execFileAsync('mkdir', ['-p', plainDir])
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('resolves a linked worktree to its main worktree', async () => {
    const parent = await resolveMainWorktree(worktree)
    expect(parent).not.toBeNull()
    expect(realpathSync(parent as string)).toBe(realpathSync(mainRepo))
  })

  it('returns null for the main worktree itself', async () => {
    expect(await resolveMainWorktree(mainRepo)).toBeNull()
  })

  it('returns null for a non-repo directory', async () => {
    expect(await resolveMainWorktree(plainDir)).toBeNull()
  })

  it('returns null for a path that does not exist', async () => {
    expect(await resolveMainWorktree(join(root, 'ghost'))).toBeNull()
  })
})
