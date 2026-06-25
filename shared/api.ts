// IPC contract surface exposed to the renderer via the preload bridge.
// Every method here corresponds to a registered `ipcMain.handle` in src/main.

import type { Project, ProjectPatch, ProjectStats, ThemePreference } from './types'

export interface MeshApi {
  /** Round-trip ping for verifying the IPC bridge is working. */
  ping(): Promise<string>

  projects: {
    /** Enumerate every Project from `~/.claude/projects/`, sorted by Activity descending. */
    list(): Promise<Project[]>

    /** Apply a typed patch to a Project's augmentation columns (hidden, etc.). */
    update(encodedPath: string, patch: ProjectPatch): Promise<void>

    /** Compute the Stats Row counters for one Project on demand. */
    stats(encodedPath: string): Promise<ProjectStats>
  }

  /**
   * Application-menu signals. Main fires these when the user triggers a
   * menu item (or its accelerator); the renderer decides what to do with
   * each based on the active screen. Each subscribe returns an unsubscribe.
   */
  menu: {
    onOpenSettings(cb: () => void): () => void
    onCloseRequested(cb: () => void): () => void
  }

  window: {
    /** Ask main to close the BrowserWindow — main intercepts to hide on macOS. */
    close(): void
  }

  /**
   * Persistent key/value store backed by the SQLite `settings` table.
   * Strings only here — encrypted secrets (Slice 7) use a separate API.
   */
  settings: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }

  /**
   * Native-theme integration. Setting the source updates Electron's
   * `nativeTheme.themeSource`, which controls macOS chrome (title bar,
   * vibrancy, native dialogs) in lock-step with the in-app palette.
   */
  theme: {
    setSource(source: ThemePreference): void
  }
}
