import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileReadError,
  MAX_READABLE_FILE_BYTES,
  readProjectFile
} from '@main/files/file-reader'

describe('file reader', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mesh-file-reader-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('reads a file under the project root', async () => {
    await writeFile(join(tmpRoot, 'README.md'), '# hello\n', 'utf-8')
    const result = await readProjectFile(tmpRoot, 'README.md')
    expect(result.relPath).toBe('README.md')
    expect(result.contents).toBe('# hello\n')
    expect(result.byteSize).toBe(8)
  })

  it('reads nested files', async () => {
    await mkdir(join(tmpRoot, 'src', 'nested'), { recursive: true })
    await writeFile(join(tmpRoot, 'src', 'nested', 'a.ts'), 'export const x = 1\n', 'utf-8')
    const result = await readProjectFile(tmpRoot, 'src/nested/a.ts')
    expect(result.contents).toBe('export const x = 1\n')
  })

  it('rejects paths that escape the root with FileReadError(escapes-root)', async () => {
    await writeFile(join(tmpRoot, '..', 'outside.txt'), 'no', 'utf-8').catch(() => undefined)
    await expect(readProjectFile(tmpRoot, '../outside.txt')).rejects.toMatchObject({
      name: 'FileReadError',
      code: 'escapes-root'
    })
  })

  it('rejects absolute paths injected into relPath', async () => {
    await expect(readProjectFile(tmpRoot, '/etc/hosts')).rejects.toMatchObject({
      code: 'escapes-root'
    })
  })

  it('rejects missing files with not-found', async () => {
    await expect(readProjectFile(tmpRoot, 'nope.ts')).rejects.toMatchObject({
      code: 'not-found'
    })
  })

  it('rejects directories with not-a-file', async () => {
    await mkdir(join(tmpRoot, 'subdir'))
    await expect(readProjectFile(tmpRoot, 'subdir')).rejects.toMatchObject({
      code: 'not-a-file'
    })
  })

  it('rejects oversized files with too-large', async () => {
    const big = 'x'.repeat(MAX_READABLE_FILE_BYTES + 1)
    await writeFile(join(tmpRoot, 'big.txt'), big, 'utf-8')
    await expect(readProjectFile(tmpRoot, 'big.txt')).rejects.toMatchObject({
      code: 'too-large'
    })
  })

  it('throws FileReadError instances (not plain Error)', async () => {
    try {
      await readProjectFile(tmpRoot, '../escape.txt')
      throw new Error('expected FileReadError to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(FileReadError)
    }
  })
})
