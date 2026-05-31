import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import { SCHEMA_VERSION, migrations } from './schema'

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

export function initDb(): void {
  const dbPath = path.join(app.getPath('userData'), 'strata.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  runMigrations(db)
}

function runMigrations(db: Database.Database): void {
  const meta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'").get()
  const current = meta
    ? (db.prepare('SELECT version FROM schema_meta').get() as { version: number })?.version ?? 0
    : 0

  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    db.exec(migrations[v])
  }
}
