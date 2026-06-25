import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Project, ProjectPatch, ProjectStats } from '@shared/types'
import { getDatabase, initDatabase } from './db'
import { runMigrations } from './db/migrations'
import { listProjects } from './projects/enumerator'
import { detect } from './projects/metadata-detector'
import {
  readAugmentation,
  updateProject,
  upsertDetectedMetadata,
  upsertDiscovered
} from './projects/repository'
import { compute as computeStats } from './projects/stats-computer'

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
}

app.whenReady().then(() => {
  const db = initDatabase()
  runMigrations(db)
  smokeTestSafeStorage()
  registerIpc()
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
})
