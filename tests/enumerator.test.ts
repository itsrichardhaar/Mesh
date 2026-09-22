import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjects } from '@main/projects/enumerator'

/**
 * Each test runs against an isolated temp directory; nothing touches
 * the user's real `~/.claude/projects/`.
 */
describe('listProjects', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mesh-enumerator-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('returns an empty array when the root directory does not exist', async () => {
    const projects = await listProjects(join(tmpRoot, 'does-not-exist'))
    expect(projects).toEqual([])
  })

  it('returns an empty array when the root directory is empty', async () => {
    const projects = await listProjects(tmpRoot)
    expect(projects).toEqual([])
  })

  it('returns one Project per subdirectory containing a .jsonl file', async () => {
    await createProject(tmpRoot, '-Users-test-Desktop-Alpha', '/Users/test/Desktop/Alpha', 1000)
    await createProject(tmpRoot, '-Users-test-Desktop-Beta', '/Users/test/Desktop/Beta', 2000)
    const projects = await listProjects(tmpRoot)
    expect(projects).toHaveLength(2)
    const names = projects.map((p) => p.name).sort()
    expect(names).toEqual(['Alpha', 'Beta'])
  })

  it('uses the cwd field from a JSONL line as the Source Path', async () => {
    await createProject(
      tmpRoot,
      '-Users-test-Desktop-JTA-Tool',
      '/Users/test/Desktop/JTA Tool',
      5000
    )
    const projects = await listProjects(tmpRoot)
    expect(projects).toHaveLength(1)
    expect(projects[0]?.sourcePath).toBe('/Users/test/Desktop/JTA Tool')
    expect(projects[0]?.name).toBe('JTA Tool')
  })

  it('falls back to lossy decode when no JSONL line contains a cwd', async () => {
    const encoded = '-Users-test-Desktop-NoCwd'
    const dir = join(tmpRoot, encoded)
    await mkdir(dir, { recursive: true })
    const jsonlPath = join(dir, 'a.jsonl')
    await writeFile(jsonlPath, '{"type":"mode","mode":"normal"}\n', 'utf-8')
    await utimes(jsonlPath, new Date(), new Date())

    const projects = await listProjects(tmpRoot)
    expect(projects).toHaveLength(1)
    expect(projects[0]?.sourcePath).toBe('/Users/test/Desktop/NoCwd')
  })

  it('skips subdirectories that contain no .jsonl files', async () => {
    const dir = join(tmpRoot, '-Users-test-no-sessions')
    await mkdir(dir, { recursive: true })
    // No JSONL at all; just other files.
    await writeFile(join(dir, 'memory.md'), 'notes\n', 'utf-8')
    const projects = await listProjects(tmpRoot)
    expect(projects).toEqual([])
  })

  it('skips non-directory entries inside the root', async () => {
    await writeFile(join(tmpRoot, 'random-file.txt'), 'hello\n', 'utf-8')
    await createProject(tmpRoot, '-Users-test-Desktop-Real', '/Users/test/Desktop/Real', 10_000)
    const projects = await listProjects(tmpRoot)
    expect(projects).toHaveLength(1)
    expect(projects[0]?.name).toBe('Real')
  })

  it('sets Activity from the newest JSONL mtime in the Project directory', async () => {
    const encoded = '-Users-test-Desktop-Multi'
    const dir = join(tmpRoot, encoded)
    await mkdir(dir, { recursive: true })

    const oldJsonl = join(dir, 'old.jsonl')
    const newJsonl = join(dir, 'new.jsonl')
    await writeFile(oldJsonl, line({ cwd: '/Users/test/Desktop/Multi' }), 'utf-8')
    await writeFile(newJsonl, line({ cwd: '/Users/test/Desktop/Multi' }), 'utf-8')

    const oldTime = new Date(2026, 0, 1)
    const newTime = new Date(2026, 5, 15)
    await utimes(oldJsonl, oldTime, oldTime)
    await utimes(newJsonl, newTime, newTime)

    const projects = await listProjects(tmpRoot)
    expect(projects).toHaveLength(1)
    expect(new Date(projects[0]!.activity).getTime()).toBe(newTime.getTime())
  })

  it('sorts Projects by Activity descending', async () => {
    await createProject(tmpRoot, '-old-project', '/old/project', new Date('2026-01-01').getTime())
    await createProject(tmpRoot, '-new-project', '/new/project', new Date('2026-06-01').getTime())
    await createProject(tmpRoot, '-mid-project', '/mid/project', new Date('2026-03-01').getTime())

    const projects = await listProjects(tmpRoot)
    expect(projects.map((p) => p.name)).toEqual(['project', 'project', 'project'])
    expect(projects.map((p) => new Date(p.activity).getTime())).toEqual([
      new Date('2026-06-01').getTime(),
      new Date('2026-03-01').getTime(),
      new Date('2026-01-01').getTime()
    ])
  })

  it('marks Source-Missing when the resolved Source Path does not exist', async () => {
    await createProject(tmpRoot, '-Users-test-Gone', '/Users/test/Gone', 1000)
    const projects = await listProjects(tmpRoot)
    expect(projects).toHaveLength(1)
    expect(projects[0]?.sourceMissing).toBe(true)
  })

  it('marks Source-Missing as false when the resolved Source Path exists and is a directory', async () => {
    // Use tmpRoot itself as a path we know exists during the test.
    const realDir = join(tmpRoot, 'real-source')
    await mkdir(realDir, { recursive: true })
    await createProject(tmpRoot, '-real-encoded', realDir, 2000)
    const projects = await listProjects(tmpRoot)
    const real = projects.find((p) => p.encodedPath === '-real-encoded')
    expect(real).toBeDefined()
    expect(real?.sourceMissing).toBe(false)
  })

  it('marks Source-Missing when the path exists but is a file rather than a directory', async () => {
    const filePath = join(tmpRoot, 'not-a-directory.txt')
    await writeFile(filePath, 'hello\n', 'utf-8')
    await createProject(tmpRoot, '-encoded-file', filePath, 3000)
    const projects = await listProjects(tmpRoot)
    const p = projects.find((x) => x.encodedPath === '-encoded-file')
    expect(p).toBeDefined()
    expect(p?.sourceMissing).toBe(true)
  })

  it('classifies an ordinary Project as kind="project" with no run metadata', async () => {
    await createProject(tmpRoot, '-Users-test-Desktop-Plain', '/Users/test/Desktop/Plain', 1000)
    const projects = await listProjects(tmpRoot)
    const p = projects.find((x) => x.encodedPath === '-Users-test-Desktop-Plain')
    expect(p?.kind).toBe('project')
    expect(p?.subtype).toBeNull()
    expect(p?.gate).toBeNull()
  })

  it('recognizes a no-mistakes gate-run worktree (ADR-0014), carrying the repo/run ids', async () => {
    // Encoded dir whose recorded cwd is a no-mistakes worktree path. The worktree
    // itself is deleted (source-missing), which is the normal merged-run state.
    await createProject(
      tmpRoot,
      '-Users-test--no-mistakes-worktrees-018d9e76994c-01M320PARHRXZETXMJX80Z382A',
      '/Users/test/.no-mistakes/worktrees/018d9e76994c/01M320PARHRXZETXMJX80Z382A',
      4000
    )
    const projects = await listProjects(tmpRoot)
    const run = projects.find((x) => x.kind === 'worktreeRun')
    expect(run).toBeDefined()
    expect(run?.subtype).toBe('gate')
    expect(run?.gate).toEqual({
      repoId: '018d9e76994c',
      runId: '01M320PARHRXZETXMJX80Z382A',
      status: null,
      prUrl: null,
      prState: null,
      branch: null,
      intent: null
    })
    // Slice A recognizes but does not yet attribute a parent.
    expect(run?.sourceMissing).toBe(true)
  })
})

// --- Test helpers -----------------------------------------------------------

/** Create a fully-formed Project directory with one JSONL containing `cwd`. */
async function createProject(
  root: string,
  encodedPath: string,
  cwd: string,
  mtimeMs: number
): Promise<void> {
  const dir = join(root, encodedPath)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${encodedPath}.jsonl`)
  await writeFile(file, line({ cwd }), 'utf-8')
  const when = new Date(mtimeMs)
  await utimes(file, when, when)
}

function line(obj: Record<string, unknown>): string {
  return JSON.stringify({ type: 'user', ...obj }) + '\n'
}
