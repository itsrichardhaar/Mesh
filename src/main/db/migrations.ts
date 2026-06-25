import type Database from 'better-sqlite3'
import init0000 from './migrations/0000_init.sql?raw'
import projects0001 from './migrations/0001_projects.sql?raw'

export interface Migration {
  id: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  { id: '0000_init', sql: init0000 },
  { id: '0001_projects', sql: projects0001 }
]

const TRACKING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _applied_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`

export interface RunMigrationsResult {
  applied: string[]
}

export function runMigrations(
  db: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS
): RunMigrationsResult {
  db.exec(TRACKING_TABLE_SQL)

  const alreadyApplied = new Set(
    (db.prepare('SELECT id FROM _applied_migrations').all() as Array<{ id: string }>).map(
      (r) => r.id
    )
  )

  const newlyApplied: string[] = []
  for (const migration of migrations) {
    if (alreadyApplied.has(migration.id)) continue
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO _applied_migrations (id) VALUES (?)').run(migration.id)
    })
    apply()
    newlyApplied.push(migration.id)
  }

  return { applied: newlyApplied }
}
