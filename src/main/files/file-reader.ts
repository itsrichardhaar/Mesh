import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Maximum size (in bytes) we'll surface in the read-only Monaco
 * viewer. Files larger than this refuse to open; the renderer is
 * expected to render a "Too large to preview — open externally"
 * banner per Slice 18's acceptance criteria.
 */
export const MAX_READABLE_FILE_BYTES = 5 * 1024 * 1024

export type FileReadErrorCode = 'too-large' | 'not-found' | 'not-a-file' | 'escapes-root'

export class FileReadError extends Error {
  constructor(
    readonly code: FileReadErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'FileReadError'
  }
}

export interface FileReadResult {
  /** Echo of the requested relative path (POSIX-normalised). */
  relPath: string
  /** UTF-8 file contents. Always under `MAX_READABLE_FILE_BYTES`. */
  contents: string
  /** Size in bytes from the file's `stat`. */
  byteSize: number
}

/**
 * Read a file under `sourcePath`. Resolves `relPath` against
 * `sourcePath` and refuses anything that escapes the root (via `..`,
 * absolute injection, or a symlink whose target lies outside) — the
 * renderer hands us untrusted strings and the main process must not
 * trust them. Throws a typed `FileReadError` for any of: oversize,
 * missing, not-a-regular-file, or root-escape.
 */
export async function readProjectFile(
  sourcePath: string,
  relPath: string
): Promise<FileReadResult> {
  const resolvedRoot = resolve(sourcePath)
  const targetPath = resolve(resolvedRoot, relPath)
  if (!isWithin(resolvedRoot, targetPath)) {
    throw new FileReadError('escapes-root', 'file-reader: relPath escapes the project root')
  }

  let s
  try {
    s = await stat(targetPath)
  } catch {
    throw new FileReadError('not-found', `file-reader: ${relPath} not found`)
  }
  if (!s.isFile()) {
    throw new FileReadError('not-a-file', `file-reader: ${relPath} is not a regular file`)
  }
  if (s.size > MAX_READABLE_FILE_BYTES) {
    throw new FileReadError(
      'too-large',
      `file-reader: ${relPath} is ${s.size} bytes (> ${MAX_READABLE_FILE_BYTES})`
    )
  }

  const contents = await readFile(targetPath, 'utf-8')
  return { relPath, contents, byteSize: s.size }
}

function isWithin(rootDir: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const rel = relative(rootDir, candidate)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  return !isAbsolute(rel)
}
