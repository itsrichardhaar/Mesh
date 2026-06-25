import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let dbInstance: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (dbInstance) return dbInstance

  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true })
  }
  const dbPath = join(userDataPath, 'mesh.db')

  dbInstance = new Database(dbPath)
  dbInstance.pragma('journal_mode = WAL')
  dbInstance.pragma('foreign_keys = ON')

  return dbInstance
}

export function getDatabase(): Database.Database {
  if (!dbInstance) throw new Error('Database not initialized; call initDatabase() first')
  return dbInstance
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
