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
