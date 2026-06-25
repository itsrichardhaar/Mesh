import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'
import { listDirectory } from '@main/files/file-tree-service'

describe('FileTreeService.listDirectory', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mesh-files-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists root entries with dirs before files, alphabetized', async () => {
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# x\n', 'utf-8')
    await writeFile(join(root, 'package.json'), '{}', 'utf-8')

    const entries = await listDirectory(root, '', /* showHidden */ false)
    expect(entries.map((e) => `${e.type}:${e.name}`)).toEqual([
      'dir:dist',
      'dir:src',
      // case-insensitive sort puts package.json before README.md
      'file:package.json',
      'file:README.md'
    ])
  })

  it('respects .gitignore (root-level)', async () => {
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# x\n', 'utf-8')
    await writeFile(join(root, 'build.log'), 'noise', 'utf-8')
    await writeFile(join(root, '.gitignore'), 'node_modules\n*.log\n', 'utf-8')

    const entries = await listDirectory(root, '', false)
    const names = entries.map((e) => e.name).sort()
    expect(names).toEqual(['.gitignore', 'README.md', 'src'])
  })

  it('honors showHidden=true to expose gitignored and dotfile entries', async () => {
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, '.gitignore'), 'node_modules\n', 'utf-8')
    await writeFile(join(root, '.env'), 'SECRET=1', 'utf-8')
    await writeFile(join(root, 'README.md'), '# x', 'utf-8')

    const entries = await listDirectory(root, '', /* showHidden */ true)
    const names = entries.map((e) => e.name).sort()
    expect(names).toEqual(['.env', '.gitignore', 'README.md', 'node_modules', 'src'])
  })

  it('always hides .git/ even with no .gitignore', async () => {
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# x', 'utf-8')

    const entries = await listDirectory(root, '', false)
    expect(entries.map((e) => e.name)).toEqual(['README.md'])
  })

  it('skips symlinks entirely (never follows out-of-tree targets)', async () => {
    if (platform() === 'win32') return // creating symlinks on Windows requires admin
    const outside = await mkdtemp(join(tmpdir(), 'mesh-outside-'))
    try {
      await writeFile(join(outside, 'secret.txt'), 'should not appear', 'utf-8')
      await symlink(outside, join(root, 'sneaky'))
      await writeFile(join(root, 'real.txt'), 'ok', 'utf-8')

      const entries = await listDirectory(root, '', false)
      expect(entries.map((e) => e.name)).toEqual(['real.txt'])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('marks directories with hasChildren reflecting visible content', async () => {
    await mkdir(join(root, 'empty'), { recursive: true })
    await mkdir(join(root, 'full'), { recursive: true })
    await writeFile(join(root, 'full', 'a.ts'), 'x', 'utf-8')

    const entries = await listDirectory(root, '', false)
    const empty = entries.find((e) => e.name === 'empty')
    const full = entries.find((e) => e.name === 'full')
    expect(empty?.hasChildren).toBe(false)
    expect(full?.hasChildren).toBe(true)
  })

  it('lists a subdirectory by relPath', async () => {
    await mkdir(join(root, 'src', 'lib'), { recursive: true })
    await writeFile(join(root, 'src', 'lib', 'a.ts'), 'x', 'utf-8')
    await writeFile(join(root, 'src', 'b.ts'), 'y', 'utf-8')

    const entries = await listDirectory(root, 'src', false)
    expect(entries.map((e) => e.name)).toEqual(['lib', 'b.ts'])
  })

  it('refuses to list a path that escapes the project root', async () => {
    await expect(listDirectory(root, '../escape', false)).rejects.toThrow(/escapes the project root/)
  })

  it('returns empty array for a missing relPath rather than throwing', async () => {
    const entries = await listDirectory(root, 'does-not-exist', false)
    expect(entries).toEqual([])
  })

  it('returns POSIX-style relPath strings even on platforms that use backslashes', async () => {
    await mkdir(join(root, 'src', 'lib'), { recursive: true })
    await writeFile(join(root, 'src', 'lib', 'a.ts'), 'x', 'utf-8')
    const entries = await listDirectory(root, 'src', false)
    const lib = entries.find((e) => e.name === 'lib')
    expect(lib?.relPath).toBe('src/lib')
  })
})
