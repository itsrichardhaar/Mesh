import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compute } from '@main/projects/stats-computer'

describe('stats computer', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mesh-stats-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('returns zeros for a non-existent directory', async () => {
    const stats = await compute(join(tmpRoot, 'nope'))
    expect(stats).toEqual({ sessionCount: 0, filesTouchedCount: 0, lastActivityAt: null })
  })

  it('returns zeros when the directory has no .jsonl files', async () => {
    const dir = await mkProjectDir('empty')
    await writeFile(join(dir, 'memory.md'), 'notes\n', 'utf-8')
    const stats = await compute(dir)
    expect(stats).toEqual({ sessionCount: 0, filesTouchedCount: 0, lastActivityAt: null })
  })

  it('counts Sessions as the number of .jsonl files', async () => {
    const dir = await mkProjectDir('multi-sessions')
    await writeFile(join(dir, 's1.jsonl'), '', 'utf-8')
    await writeFile(join(dir, 's2.jsonl'), '', 'utf-8')
    await writeFile(join(dir, 's3.jsonl'), '', 'utf-8')
    await writeFile(join(dir, 'memory.md'), 'ignored\n', 'utf-8')
    const stats = await compute(dir)
    expect(stats.sessionCount).toBe(3)
  })

  it('counts unique Edit/Write/Read file paths across all Sessions', async () => {
    const dir = await mkProjectDir('files-touched')
    await writeFile(
      join(dir, 's1.jsonl'),
      [
        toolUseLine('Edit', '/repo/a.ts'),
        toolUseLine('Read', '/repo/b.ts'),
        toolUseLine('Edit', '/repo/a.ts') // dedup
      ].join('\n') + '\n',
      'utf-8'
    )
    await writeFile(
      join(dir, 's2.jsonl'),
      [
        toolUseLine('Write', '/repo/c.ts'),
        toolUseLine('Read', '/repo/a.ts') // already counted
      ].join('\n') + '\n',
      'utf-8'
    )
    const stats = await compute(dir)
    expect(stats.filesTouchedCount).toBe(3)
  })

  it('ignores non-file tool calls (Bash, Grep, etc.)', async () => {
    const dir = await mkProjectDir('non-file-tools')
    await writeFile(
      join(dir, 's.jsonl'),
      [
        toolUseLine('Bash', undefined, { command: 'ls' }),
        toolUseLine('Grep', undefined, { pattern: 'foo' }),
        toolUseLine('Edit', '/repo/x.ts')
      ].join('\n') + '\n',
      'utf-8'
    )
    const stats = await compute(dir)
    expect(stats.filesTouchedCount).toBe(1)
  })

  it('uses the newest event timestamp across all lines as lastActivityAt', async () => {
    const dir = await mkProjectDir('timestamps')
    await writeFile(
      join(dir, 's1.jsonl'),
      [
        timestampLine('2026-06-01T10:00:00.000Z'),
        timestampLine('2026-06-01T10:05:00.000Z')
      ].join('\n') + '\n',
      'utf-8'
    )
    await writeFile(
      join(dir, 's2.jsonl'),
      [timestampLine('2026-06-15T12:00:00.000Z')].join('\n') + '\n',
      'utf-8'
    )
    const stats = await compute(dir)
    expect(stats.lastActivityAt).toBe('2026-06-15T12:00:00.000Z')
  })

  it('returns null lastActivityAt when no line carries a timestamp', async () => {
    const dir = await mkProjectDir('no-timestamps')
    await writeFile(
      join(dir, 's.jsonl'),
      '{"type":"mode","mode":"normal"}\n{"type":"permission-mode"}\n',
      'utf-8'
    )
    const stats = await compute(dir)
    expect(stats.lastActivityAt).toBeNull()
  })

  it('tolerates malformed JSON lines without aborting the file', async () => {
    const dir = await mkProjectDir('malformed')
    await writeFile(
      join(dir, 's.jsonl'),
      [
        'not json at all',
        '{ broken',
        toolUseLine('Edit', '/repo/ok.ts'),
        timestampLine('2026-06-20T00:00:00.000Z')
      ].join('\n') + '\n',
      'utf-8'
    )
    const stats = await compute(dir)
    expect(stats.filesTouchedCount).toBe(1)
    expect(stats.lastActivityAt).toBe('2026-06-20T00:00:00.000Z')
  })

  it('skips tool_use blocks missing a file_path', async () => {
    const dir = await mkProjectDir('missing-file-path')
    await writeFile(
      join(dir, 's.jsonl'),
      [toolUseLine('Edit', undefined, { foo: 'bar' })].join('\n') + '\n',
      'utf-8'
    )
    const stats = await compute(dir)
    expect(stats.filesTouchedCount).toBe(0)
  })

  it('returns sessionCount=1 with zero file activity for an empty .jsonl', async () => {
    const dir = await mkProjectDir('empty-session')
    await writeFile(join(dir, 's.jsonl'), '', 'utf-8')
    const stats = await compute(dir)
    expect(stats).toEqual({ sessionCount: 1, filesTouchedCount: 0, lastActivityAt: null })
  })

  // --- helpers --------------------------------------------------------------

  async function mkProjectDir(name: string): Promise<string> {
    const dir = join(tmpRoot, name)
    await mkdir(dir, { recursive: true })
    return dir
  }
})

function toolUseLine(
  name: string,
  filePath: string | undefined,
  extraInput: Record<string, unknown> = {}
): string {
  const input = filePath !== undefined ? { file_path: filePath, ...extraInput } : { ...extraInput }
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name, input }]
    }
  })
}

function timestampLine(ts: string): string {
  return JSON.stringify({ type: 'user', timestamp: ts })
}
