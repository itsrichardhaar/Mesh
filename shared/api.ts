// IPC contract surface exposed to the renderer via the preload bridge.
// Every method here corresponds to a registered `ipcMain.handle` in src/main.

import type { Project, ProjectPatch } from './types'

export interface MeshApi {
  /** Round-trip ping for verifying the IPC bridge is working. */
  ping(): Promise<string>

  projects: {
    /** Enumerate every Project from `~/.claude/projects/`, sorted by Activity descending. */
    list(): Promise<Project[]>

    /** Apply a typed patch to a Project's augmentation columns (hidden, etc.). */
    update(encodedPath: string, patch: ProjectPatch): Promise<void>
  }
}
