import { app, BrowserWindow, ipcMain, nativeTheme, safeStorage } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FileReadResponse, FilesTreeRequest, FilesTreeResponse } from '@shared/files'
import type { SessionSummary, TranscriptEntry } from '@shared/sessions'
import type {
  Project,
  ProjectPatch,
  ProjectStats,
  ProviderId,
  StoredAnalysis
} from '@shared/types'
import { isProviderId, isThemePreference } from '@shared/types'
import { latestForProject } from './analyses/repository'
import { getDatabase, initDatabase } from './db'
import { runMigrations } from './db/migrations'
import { FileReadError, readProjectFile } from './files/file-reader'
import {
  closeAll as closeAllWatchers,
  listDirectory,
  watchProject
} from './files/file-tree-service'
import { buildApplicationMenu } from './menu'
import { listProjects } from './projects/enumerator'
import { detect } from './projects/metadata-detector'
import {
  getSourcePath,
  readAugmentation,
  updateProject,
  upsertDetectedMetadata,
  upsertDiscovered
} from './projects/repository'
import { compute as computeStats } from './projects/stats-computer'
import { listSessions, readTranscript } from './sessions/session-reader'
import {
  closeAllSessionWatchers,
  watchSessions
} from './sessions/session-watcher'
import {
  clearSecret,
  EncryptionBackend,
  getMaskedSecret,
  SecretsVaultUnavailableError,
  setSecret
} from './secrets/vault'
import { getSetting, setSetting } from './settings/repository'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null
let isQuitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Hide on close (macOS productivity-app idiom); ⌘Q triggers actual quit.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function smokeTestSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[mesh] safeStorage encryption not available on this system')
    return
  }
  try {
    const plaintext = 'mesh-smoke-test'
    const encrypted = safeStorage.encryptString(plaintext)
    const decrypted = safeStorage.decryptString(encrypted)
    if (decrypted !== plaintext) {
      console.error('[mesh] safeStorage round-trip mismatch')
    }
  } catch (err) {
    console.error('[mesh] safeStorage smoke test threw:', err)
  }
}

function registerIpc(): void {
  ipcMain.handle('ping', () => 'pong')

  // Renderer asks the window to close — same path the red-X uses, which
  // our `close` listener intercepts to hide the window on macOS.
  ipcMain.on('window:close', () => {
    mainWindow?.close()
  })

  ipcMain.handle('projects:list', async (): Promise<Project[]> => {
    const discovered = await listProjects(CLAUDE_PROJECTS_DIR)
    const db = getDatabase()
    upsertDiscovered(db, discovered)

    // Run detection for any Project missing cached metadata; Source-Missing
    // Projects are skipped because their canonical files are unreachable.
    const augBefore = readAugmentation(db)
    const needsDetection = discovered.filter(
      (p) => !p.sourceMissing && augBefore.get(p.encodedPath)?.lastMetadataDetectedAt == null
    )
    if (needsDetection.length > 0) {
      const detectedAt = new Date().toISOString()
      await Promise.all(
        needsDetection.map(async (p) => {
          try {
            const meta = await detect(p.sourcePath)
            upsertDetectedMetadata(db, p.encodedPath, meta, detectedAt)
          } catch (err) {
            console.warn(`[mesh] metadata detection failed for ${p.encodedPath}:`, err)
          }
        })
      )
    }

    const augmentation = readAugmentation(db)
    return discovered.map((p) => {
      const aug = augmentation.get(p.encodedPath)
      return {
        ...p,
        name: aug?.autoName ?? p.name,
        autoSubtitle: aug?.autoSubtitle ?? null,
        hidden: aug?.hidden ?? false
      }
    })
  })

  ipcMain.handle(
    'projects:update',
    (_event, encodedPath: unknown, patch: unknown): void => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('projects:update: encodedPath must be a non-empty string')
      }
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('projects:update: patch must be an object')
      }
      updateProject(getDatabase(), encodedPath, patch as ProjectPatch)
    }
  )

  ipcMain.handle(
    'projects:stats',
    async (_event, encodedPath: unknown): Promise<ProjectStats> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('projects:stats: encodedPath must be a non-empty string')
      }
      return computeStats(join(CLAUDE_PROJECTS_DIR, encodedPath))
    }
  )

  ipcMain.handle('settings:get', (_event, key: unknown): string | null => {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('settings:get: key must be a non-empty string')
    }
    return getSetting(getDatabase(), key)
  })

  ipcMain.handle(
    'settings:set',
    (_event, key: unknown, value: unknown): void => {
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('settings:set: key must be a non-empty string')
      }
      if (typeof value !== 'string') {
        throw new Error('settings:set: value must be a string')
      }
      setSetting(getDatabase(), key, value)
    }
  )

  // Renderer notifies main when the user's theme preference changes so
  // nativeTheme can update macOS chrome (title bar tint, vibrancy, etc.)
  // in lock-step with the in-app palette.
  ipcMain.on('theme:set-source', (_event, source: unknown) => {
    if (isThemePreference(source)) {
      nativeTheme.themeSource = source
    }
  })

  ipcMain.handle('secrets:available', (): boolean => {
    return safeStorage.isEncryptionAvailable()
  })

  ipcMain.handle(
    'secrets:set',
    (_event, provider: unknown, plaintext: unknown): void => {
      if (!isProviderId(provider)) {
        throw new Error('secrets:set: provider must be a known ProviderId')
      }
      if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new Error('secrets:set: plaintext must be a non-empty string')
      }
      try {
        setSecret(getDatabase(), encryptionBackend, secretKey(provider), plaintext)
      } catch (err) {
        if (err instanceof SecretsVaultUnavailableError) {
          throw new Error('Encryption is unavailable on this system; secret not saved')
        }
        throw err
      }
    }
  )

  ipcMain.handle(
    'secrets:get-mask',
    (_event, provider: unknown): string | null => {
      if (!isProviderId(provider)) {
        throw new Error('secrets:get-mask: provider must be a known ProviderId')
      }
      try {
        return getMaskedSecret(getDatabase(), encryptionBackend, secretKey(provider))
      } catch (err) {
        if (err instanceof SecretsVaultUnavailableError) {
          // A stored blob exists but we can't decrypt it — surface a
          // distinct, recoverable error rather than silently hiding it.
          throw new Error('Encryption is unavailable on this system; cannot read stored secret')
        }
        throw err
      }
    }
  )

  ipcMain.handle('secrets:clear', (_event, provider: unknown): void => {
    if (!isProviderId(provider)) {
      throw new Error('secrets:clear: provider must be a known ProviderId')
    }
    clearSecret(getDatabase(), secretKey(provider))
  })

  ipcMain.handle(
    'analyses:latest',
    (_event, encodedPath: unknown): StoredAnalysis | null => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('analyses:latest: encodedPath must be a non-empty string')
      }
      return latestForProject(getDatabase(), encodedPath)
    }
  )

  ipcMain.handle(
    'sessions:list',
    async (_event, encodedPath: unknown): Promise<SessionSummary[]> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('sessions:list: encodedPath must be a non-empty string')
      }
      const projectDir = join(CLAUDE_PROJECTS_DIR, encodedPath)
      // First touch subscribes the watcher so subsequent jsonl writes
      // surface in the renderer; idempotent under repeat.
      watchSessions(encodedPath, projectDir, () => {
        mainWindow?.webContents.send('sessions:changed', encodedPath)
      })
      return listSessions(projectDir)
    }
  )

  ipcMain.handle(
    'sessions:read-transcript',
    async (
      _event,
      encodedPath: unknown,
      sessionId: unknown
    ): Promise<TranscriptEntry[]> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('sessions:read-transcript: encodedPath must be a non-empty string')
      }
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('sessions:read-transcript: sessionId must be a non-empty string')
      }
      return readTranscript(join(CLAUDE_PROJECTS_DIR, encodedPath), sessionId)
    }
  )

  ipcMain.handle(
    'files:tree',
    async (
      _event,
      encodedPath: unknown,
      request: unknown
    ): Promise<FilesTreeResponse> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('files:tree: encodedPath must be a non-empty string')
      }
      const req = (request ?? {}) as FilesTreeRequest
      const relPath = typeof req.relPath === 'string' ? req.relPath : ''
      const showHidden = req.showHidden === true

      const sourcePath = getSourcePath(getDatabase(), encodedPath)
      if (!sourcePath) {
        throw new Error(`files:tree: unknown encodedPath ${encodedPath}`)
      }

      // Subscribe chokidar on first access so the renderer gets live
      // events without an explicit "open project" call; the existing-
      // watcher path inside watchProject is idempotent under repeat.
      watchProject(encodedPath, sourcePath, () => {
        mainWindow?.webContents.send('files:tree-changed', encodedPath)
      })

      const entries = await listDirectory(sourcePath, relPath, showHidden)
      return { sourcePath, relPath, entries }
    }
  )

  ipcMain.handle(
    'files:read',
    async (_event, encodedPath: unknown, relPath: unknown): Promise<FileReadResponse> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('files:read: encodedPath must be a non-empty string')
      }
      if (typeof relPath !== 'string' || relPath.length === 0) {
        throw new Error('files:read: relPath must be a non-empty string')
      }
      const sourcePath = getSourcePath(getDatabase(), encodedPath)
      if (!sourcePath) {
        throw new Error(`files:read: unknown encodedPath ${encodedPath}`)
      }
      try {
        const result = await readProjectFile(sourcePath, relPath)
        return { ok: true, ...result }
      } catch (err) {
        if (err instanceof FileReadError) {
          return { ok: false, code: err.code, message: err.message, relPath }
        }
        throw err
      }
    }
  )
}

/** Stable SQLite key shape for per-Provider secrets. */
function secretKey(provider: ProviderId): string {
  return `secret:${provider}`
}

const encryptionBackend: EncryptionBackend = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plaintext) => safeStorage.encryptString(plaintext),
  decryptString: (ciphertext) => safeStorage.decryptString(ciphertext)
}

/**
 * Apply the persisted theme to `nativeTheme` before any window opens so
 * the title bar paints in the right palette on first frame. Falls back
 * to `system` when no preference is recorded.
 */
function applyPersistedTheme(): void {
  const stored = getSetting(getDatabase(), 'theme')
  nativeTheme.themeSource = isThemePreference(stored) ? stored : 'system'
}

app.whenReady().then(() => {
  const db = initDatabase()
  runMigrations(db)
  smokeTestSafeStorage()
  registerIpc()
  applyPersistedTheme()
  buildApplicationMenu(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, the app stays alive in the dock when all windows close.
  // On other platforms, that gesture means "quit".
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  void closeAllWatchers()
  void closeAllSessionWatchers()
})
