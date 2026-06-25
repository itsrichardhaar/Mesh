// Shapes returned by the `files:tree` IPC. Both renderer and main
// import these — keep Electron-free.

export interface FileNode {
  /** Display name (basename). */
  name: string
  /** POSIX-style path relative to the Project's Source Path. '' is the root. */
  relPath: string
  type: 'file' | 'dir'
  /**
   * For directories: true if expanding will reveal at least one entry
   * under the current `showHidden` setting. Lets the tree render a
   * caret affordance without forcing an eager recurse.
   */
  hasChildren?: boolean
}

export interface FilesTreeRequest {
  /** Relative directory to list, '' for the project root. POSIX separators. */
  relPath?: string
  /** When true, gitignored / dotfile entries are included. */
  showHidden?: boolean
}

export interface FilesTreeResponse {
  /** Absolute path of the Project's Source Path. */
  sourcePath: string
  /** Echo of the requested relative path. */
  relPath: string
  entries: FileNode[]
}

/**
 * Reasons `files.read` may refuse to return content. The renderer
 * switches on these to choose a tailored banner (`too-large` →
 * "Too large to preview — open externally", etc.).
 */
export type FileReadErrorCode = 'too-large' | 'not-found' | 'not-a-file' | 'escapes-root'

/**
 * IPC response envelope for `files.read`. We use an explicit
 * `ok: true | false` discriminant rather than throwing from main —
 * Electron's IPC layer drops custom properties on rejected errors,
 * so a `code` field on a thrown Error wouldn't survive the bridge.
 * The envelope keeps the failure shape typed end-to-end.
 */
export type FileReadResponse =
  | {
      ok: true
      /** Echo of the requested relative path (POSIX-normalised). */
      relPath: string
      /** UTF-8 file contents. */
      contents: string
      /** Size in bytes from the file's `stat`. */
      byteSize: number
    }
  | {
      ok: false
      code: FileReadErrorCode
      message: string
      /** Echo of the requested path so the renderer can display it. */
      relPath: string
    }
